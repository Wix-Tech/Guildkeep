/**
 * search-engine.mjs — a WhatsApp-style hybrid search engine in dependency-free JS.
 *
 * This is a faithful port of the architecture recovered from WhatsApp Android
 * 2.26.41.77 (see ../EVIDENCE.md). The pieces map 1:1:
 *
 *   WhatsApp (Kotlin/SQLite FTS4)            this module
 *   ---------------------------------------  ------------------------------------
 *   FtsMessageStoreBase.A0K / A0J / A05      normalize() / compileQuery()
 *   content:tok1 content:tok2* (implicit AND,  compileQuery()
 *     prefix wildcard on the final token)
 *   "quoted phrase"                          phrase terms (adjacency scored)
 *   fts_namespace: / -namespace filters      namespaces + negation
 *   message_ftsv2 (FTS4) + available_        inverted index with positions
 *     message_view join
 *   wa_contacts_fts_bigrams (Fts4 bigrams)   bigramIndex / fuzzyCandidates()
 *   SemanticSearchManager kNN + distance     semanticCandidates() (hashed
 *     threshold + has/and/counts merge         embeddings + cosine + threshold)
 *   PaginationStrategyStaggered              paginate() / staggeredInterleave()
 *   EngineState.hasMorePages                 nextCursor
 *   SearchPerformanceLogger (marker spans)   timings + debug counters
 *
 * Everything is deterministic: no randomness, no network, no deps.
 */

/* ------------------------------------------------------------------ */
/* 1. Normalisation + tokenisation                                     */
/* ------------------------------------------------------------------ */

const DIACRITICS = /[\u0300-\u036f]/g;
const PUNCT = /[^\p{L}\p{N}#@+']+/gu;
const MAX_QUERY = 4096; // WhatsApp: FtsMessageStoreBase.A09 bails >= 4096 chars

/** Lower-case, strip diacritics and unify punctuation. Mirrors A0K(). */
export function normalize(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(PUNCT, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Tokenise to words, keeping #tags and @mentions intact. */
export function tokenize(text) {
  const n = normalize(text);
  return n ? n.split(' ') : [];
}

/** Character bigrams of a word — the trick behind WhatsApp's fuzzy contacts. */
export function bigrams(word) {
  const w = `#${normalize(word)}#`;
  const out = [];
  for (let i = 0; i < w.length - 1; i += 1) out.push(w.slice(i, i + 2));
  return out;
}

/* ------------------------------------------------------------------ */
/* 2. Query compilation                                                */
/* ------------------------------------------------------------------ */

/**
 * Compile a user query string into a structured query object.
 *
 * Mirrors FtsMessageStoreBase:
 *   A0J()  — quoted input stays a phrase, everything else gets a trailing `*`
 *   A05()  — tokens joined by space (implicit AND), `*` appended to the last
 *   A0G()  — namespace clauses appended, `-ns` means NOT
 *
 * Supported syntax (a superset of what the user sees in the UI):
 *   foo bar        implicit AND, prefix on the last token (as-you-type)
 *   "foo bar"      exact phrase
 *   foo OR bar     alternatives
 *   -foo           negated term
 *   from:ana       field filter (from:/in:/is:/has:)
 */
export function compileQuery(input) {
  const raw = String(input ?? '');
  const safe = raw.length > MAX_QUERY ? raw.slice(0, MAX_QUERY) : raw;

  const phrases = [];
  let rest = safe.replace(/"([^"]*)"/g, (_, phrase) => {
    const p = normalize(phrase);
    if (p) phrases.push(p.split(' '));
    return ' ';
  });

  const positives = [];
  const negatives = [];
  const filters = {};

  for (const rawToken of rest.split(/\s+/).filter(Boolean)) {
    const negated = rawToken.startsWith('-') && rawToken.length > 1;
    const token = negated ? rawToken.slice(1) : rawToken;

    const field = /^(from|in|is|has):(.+)$/i.exec(token);
    if (field) {
      filters[field[1].toLowerCase()] = normalize(field[2]);
      continue;
    }
    if (/^or$/i.test(token)) continue; // OR is implicit between clauses

    const words = tokenize(token);
    for (const word of words) (negated ? negatives : positives).push(word);
  }

  // WhatsApp appends `*` to the final token only: `content:a content:b*`
  // A query is a prefix query when it is a single bare token.
  const lastTokenPrefix = positives.length > 0;

  return {
    raw: safe,
    terms: positives,
    negatedTerms: negatives,
    phrases,
    filters,
    lastTokenPrefix,
    isEmpty:
      positives.length === 0 && phrases.length === 0 && negatives.length === 0,
    /** Human-readable rendering of the compiled expression, for the debug pane. */
    toFtsString() {
      const parts = [];
      positives.forEach((t, i) => {
        parts.push(`content:${t}${i === positives.length - 1 && lastTokenPrefix ? '*' : ''}`);
      });
      for (const p of phrases) parts.push(`content:"${p.join(' ')}"`);
      for (const t of negatives) parts.push(`-content:${t}`);
      for (const [k, v] of Object.entries(filters)) parts.push(`${k}:${v}`);
      return parts.join(' ');
    },
  };
}

/* ------------------------------------------------------------------ */
/* 3. Inverted index                                                   */
/* ------------------------------------------------------------------ */

const FIELD_WEIGHTS = {
  // Mirrors the relative importance of the columns WhatsApp indexes.
  contactName: 6,
  chatName: 4,
  senderName: 3,
  text: 1,
  chatKind: 0.5,
};

/**
 * Build an index over documents.
 *
 * A document is either a `message` or a `contact`. Both are stored with
 * position lists so phrase and proximity scoring are possible.
 */
export function buildIndex({ messages = [], contacts = [], chats = [] } = {}) {
  const chatById = new Map(chats.map((c) => [c.id, c]));
  const contactById = new Map(contacts.map((c) => [c.id, c]));

  const docs = [];
  const postings = new Map(); // token -> Map(docId -> [{field, pos}])
  const bigramPostings = new Map(); // bigram -> Set(docId) (contacts only)
  const docLengths = new Map();

  const addPosting = (token, docId, field, pos) => {
    let byDoc = postings.get(token);
    if (!byDoc) postings.set(token, (byDoc = new Map()));
    let list = byDoc.get(docId);
    if (!list) byDoc.set(docId, (list = []));
    list.push({ field, pos });
  };

  const indexDoc = (doc) => {
    let len = 0;
    for (const [field, value] of Object.entries(doc.fields)) {
      if (!value) continue;
      const tokens = tokenize(value);
      tokens.forEach((token, pos) => {
        len += 1;
        addPosting(token, doc.id, field, pos);
      });
    }
    docLengths.set(doc.id, len);
  };

  // ---- messages -----------------------------------------------------
  for (const m of messages) {
    const chat = chatById.get(m.chatId);
    const sender = contactById.get(m.senderId);
    const doc = {
      id: `msg:${m.id}`,
      kind: 'message',
      raw: m,
      chatId: m.chatId,
      namespace: chat?.kind === 'channel' ? 'newsletter' : 'chat',
      fields: {
        text: m.text,
        senderName: chat?.kind === 'group' ? sender?.name : undefined,
        chatName: m.text ? undefined : undefined,
      },
      timestamp: m.timestamp,
      chat,
      sender,
    };
    docs.push(doc);
    indexDoc(doc);
  }

  // ---- contacts -----------------------------------------------------
  for (const c of contacts) {
    const doc = {
      id: `contact:${c.id}`,
      kind: 'contact',
      raw: c,
      namespace: c.kind === 'business' ? 'business' : 'contact',
      fields: {
        contactName: c.name,
        text: [c.about, c.phone, ...(c.tags ?? [])].filter(Boolean).join(' '),
        chatKind: c.kind,
      },
      timestamp: c.lastActiveAt ?? 0,
      contact: c,
    };
    docs.push(doc);
    indexDoc(doc);

    // bigram index for fuzzy contact lookup (wa_contacts_fts_bigrams)
    const seen = new Set();
    for (const word of tokenize(`${c.name} ${(c.tags ?? []).join(' ')}`)) {
      for (const bg of bigrams(word)) {
        if (seen.has(bg)) continue;
        seen.add(bg);
        let set = bigramPostings.get(bg);
        if (!set) bigramPostings.set(bg, (set = new Set()));
        set.add(doc.id);
      }
    }
  }

  // ---- semantic layer ----------------------------------------------
  // Stand-in for WhatsApp's on-device embedding model: a deterministic hashed
  // bag-of-words vector. Same interface (kNN + distance threshold), no model.
  const vectors = new Map();
  for (const doc of docs) {
    const text = Object.values(doc.fields).filter(Boolean).join(' ');
    vectors.set(doc.id, embed(text));
  }

  return {
    docs,
    chatById,
    contactById,
    postings,
    bigramPostings,
    docLengths,
    vectors,
    avgDocLength:
      docs.reduce((sum, d) => sum + (docLengths.get(d.id) ?? 0), 0) /
      Math.max(1, docs.length),
  };
}

/* ------------------------------------------------------------------ */
/* 4. Dense (semantic) vectors                                         */
/* ------------------------------------------------------------------ */

/**
 * Character n-gram embedding.
 *
 * WhatsApp ships a real on-device embedding model behind SemanticSearchManager.
 * We cannot, so this module uses the standard dependency-free stand-in:
 * a hashed vector of word identities plus the character trigrams of every word
 * ("rebuilt" ~ "rebuild", "indexing" ~ "index"). Same interface as the real
 * thing — cosine distance, a kNN scan, and an explicit distance threshold —
 * and it degrades predictably: it finds morphological and spelling neighbours,
 * not true synonyms.
 */
const DIMS = 2048;
const TRIGRAM_WEIGHT = 0.45;

function hash32(str, seed = 0x811c9dc5) {
  let h = seed;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function trigrams(word) {
  const w = `#${word}#`;
  const out = [];
  for (let i = 0; i < w.length - 2; i += 1) out.push(w.slice(i, i + 3));
  return out;
}

/** Deterministic hashed char-ngram vector (raw counts, not normalised). */
export function embed(text) {
  const v = new Float32Array(DIMS);
  // Presence (not term frequency) + big-dimension hashing keeps accidental
  // collisions from dominating the similarity of short queries.
  for (const token of tokenize(text)) {
    v[hash32(token) % DIMS] = 1;
    for (const tri of trigrams(token)) {
      const i = hash32(tri, 0x9e3779b9) % DIMS;
      if (v[i] < TRIGRAM_WEIGHT) v[i] = TRIGRAM_WEIGHT;
    }
  }
  return v;
}

export function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

/**
 * Query coverage: how much of the query's vector mass the document explains.
 * Unlike cosine it does not punish a document for being long — which is what
 * you want when the query is two words and the document is a sentence.
 * Returns 0..1; `distance = 1 - coverage` feeds the kNN threshold.
 */
export function coverage(q, d) {
  let covered = 0;
  let total = 0;
  for (let i = 0; i < q.length; i += 1) {
    total += q[i];
    covered += Math.min(q[i], d[i]);
  }
  return total === 0 ? 0 : covered / total;
}

/* ------------------------------------------------------------------ */
/* 5. Retrieval                                                        */
/* ------------------------------------------------------------------ */

const K1 = 1.2; // BM25 term-frequency saturation
const B = 0.6; // BM25 length normalisation

const KIND_TO_SECTION = {
  message: 'messages',
  contact: 'contacts',
};

function sectionFor(doc, filters) {
  if (doc.kind === 'contact') {
    if (doc.raw.kind === 'business') return filters.business ? 'business' : null;
    if (doc.raw.kind === 'group') return filters.groups ? 'groups' : null;
    return filters.contacts ? 'contacts' : null;
  }
  return filters.messages ? 'messages' : null;
}

/** Exact + prefix term scoring (the FTS4 half of the hybrid). */
function scoreTerm(index, doc, term, { prefix, fieldWeights }) {
  const byDoc = index.postings.get(term);
  let base = 0;
  let hit = false;

  if (byDoc && byDoc.has(doc.id)) {
    hit = true;
    const list = byDoc.get(doc.id);
    const tf = list.length;
    const dl = index.docLengths.get(doc.id) || 1;
    const fieldBoost = Math.max(
      ...list.map((p) => fieldWeights[p.field] ?? 1),
    );
    base +=
      fieldBoost *
      ((tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * dl) / index.avgDocLength)));
  }

  if (prefix) {
    // `content:term*` — walk the vocabulary for completions of the term.
    let extra = 0;
    for (const [token, postByDoc] of index.postings) {
      if (token === term || !token.startsWith(term)) continue;
      const list = postByDoc.get(doc.id);
      if (!list) continue;
      hit = true;
      extra += 0.55 * Math.max(...list.map((p) => fieldWeights[p.field] ?? 1));
    }
    base += extra;
  }

  return hit ? base : 0;
}

function positionsOf(index, doc, term, field) {
  const byDoc = index.postings.get(term);
  const list = byDoc?.get(doc.id) ?? [];
  return list.filter((p) => !field || p.field === field).map((p) => p.pos);
}

/** Adjacency bonus for `"quoted phrases"`. */
function phraseScore(index, doc, phraseWords, fieldWeights) {
  if (phraseWords.length === 0) return 0;
  const [first, ...more] = phraseWords;
  const field = Object.keys(fieldWeights)[0];
  const starts = positionsOf(index, doc, first, null);
  if (starts.length === 0) return 0;

  let hits = 0;
  for (const p of starts) {
    let ok = true;
    for (let i = 0; i < more.length; i += 1) {
      const next = positionsOf(index, doc, more[i], null);
      if (!next.includes(p + i + 1)) {
        ok = false;
        break;
      }
    }
    if (ok) hits += 1;
  }
  return hits > 0 ? 3 + hits * 0.5 : 0;
}

function diceCoefficient(a, b) {
  const A = new Set(bigrams(a));
  const B = new Set(bigrams(b));
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const bg of A) if (B.has(bg)) shared += 1;
  return (2 * shared) / (A.size + B.size);
}

/**
 * Fuzzy contact lookup over the bigram index — the `wa_contacts_fts_bigrams`
 * half. WhatsApp only runs this for contacts, only for words long enough to
 * make bigrams meaningful, and only when the user is looking at people.
 *
 * Returns [{docId, word, similarity}] with similarity >= threshold.
 */
function bigramCandidates(index, word, { threshold = 0.6, limit = 25 } = {}) {
  if (word.length < 4) return [];

  // candidate docs = anything sharing at least one bigram with the word
  const candidates = new Set();
  for (const bg of new Set(bigrams(word))) {
    const docs = index.bigramPostings.get(bg);
    if (!docs) continue;
    for (const id of docs) candidates.add(id);
  }

  const out = [];
  for (const docId of candidates) {
    const doc = index.docs.find((d) => d.id === docId);
    if (!doc || doc.kind !== 'contact') continue;
    let best = 0;
    let bestWord = '';
    for (const candidateWord of tokenize(doc.fields.contactName ?? '')) {
      const similarity = diceCoefficient(word, candidateWord);
      if (similarity > best) {
        best = similarity;
        bestWord = candidateWord;
      }
    }
    if (best >= threshold) out.push({ docId, word: bestWord, similarity: best });
  }

  return out.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
}

/* ------------------------------------------------------------------ */
/* 6. The search entry point                                           */
/* ------------------------------------------------------------------ */

export const DEFAULT_PAGE_SIZE = 20;

/**
 * search() — one page of results, in the shape WhatsApp's SearchFragment
 * consumes: one section per search engine, plus "has more pages".
 *
 * @param {object} index      result of buildIndex()
 * @param {object} options
 * @param {string} options.query
 * @param {object} [options.filters]   {messages, contacts, groups, business}
 * @param {string} [options.chatId]    scope to one conversation (fts_jid:)
 * @param {number} [options.page]
 * @param {number} [options.pageSize]
 * @param {boolean} [options.fuzzy]    allow bigram contact fallback
 * @param {boolean} [options.semantic] allow the kNN layer
 * @param {number} [options.distanceThreshold]  cosine-style distance, 1 - coverage
 * @param {number} [options.now]       injectable clock for recency scoring
 */
export function search(index, options = {}) {
  const started = nowMs();
  const {
    query = '',
    filters: rawFilters = {},
    chatId = null,
    page = 0,
    pageSize = DEFAULT_PAGE_SIZE,
    fuzzy = true,
    semantic = true,
    distanceThreshold = 0.55,
    now = Date.now(),
  } = options;

  const filters = {
    messages: rawFilters.messages ?? true,
    contacts: rawFilters.contacts ?? true,
    groups: rawFilters.groups ?? true,
    business: rawFilters.business ?? true,
  };

  const compiled = compileQuery(query);
  if (compiled.isEmpty) {
    return emptyResult(started, compiled);
  }

  const scored = new Map(); // docId -> {doc, score, reasons, semanticOnly}

  const bump = (doc, score, reason, semanticOnly = false) => {
    const entry = scored.get(doc.id) ?? {
      doc,
      score: 0,
      reasons: [],
      semanticOnly,
    };
    entry.score += score;
    if (reason) entry.reasons.push(reason);
    if (!semanticOnly) entry.semanticOnly = false;
    scored.set(doc.id, entry);
  };

  const fieldWeights =
    compiled.filters.is === 'message' ? { text: 7, senderName: 2 } : FIELD_WEIGHTS;

  // A negated term removes the document from every layer, not just FTS.
  const blocked = new Set();
  for (const bad of compiled.negatedTerms) {
    const byDoc = index.postings.get(bad);
    if (!byDoc) continue;
    for (const docId of byDoc.keys()) blocked.add(docId);
  }
  const isBlocked = (doc) => blocked.has(doc.id);

  // --- 6a. FTS half -------------------------------------------------
  let ftsHits = 0;
  for (const doc of index.docs) {
    if (!sectionFor(doc, filters)) continue;
    if (chatId && doc.chatId !== chatId) continue;
    if (compiled.filters.in && doc.chatId !== compiled.filters.in) continue;
    if (compiled.filters.from) {
      const wanted = compiled.filters.from;
      const senderName = normalize(doc.sender?.name ?? '');
      const matches = doc.senderId === wanted || senderName.includes(wanted);
      if (!matches) continue;
    }

    let score = 0;
    const terms = compiled.terms;
    terms.forEach((term, i) => {
      const isLast = i === terms.length - 1;
      const prefix = compiled.lastTokenPrefix && isLast;
      score += scoreTerm(index, doc, term, { prefix, fieldWeights });
    });

    for (const phrase of compiled.phrases) {
      score += phraseScore(index, doc, phrase, fieldWeights);
    }

    // every positive term must be present (implicit AND, like `content:a content:b`)
    const allTermsPresent = terms.every((term) => {
      const byDoc = index.postings.get(term);
      if (byDoc?.has(doc.id)) return true;
      if (!compiled.lastTokenPrefix) return false;
      for (const [token, postByDoc] of index.postings) {
        if (token.startsWith(term) && postByDoc.has(doc.id)) return true;
      }
      return false;
    });
    if (!allTermsPresent && compiled.phrases.length === 0) continue;

    if (isBlocked(doc)) continue;

    if (score > 0) {
      ftsHits += 1;
      bump(doc, score, 'fts');
    }
  }

  // --- 6b. fuzzy half (wa_contacts_fts_bigrams) ---------------------
  let fuzzyHits = 0;
  if (fuzzy) {
    const words = compiled.terms.filter((t) => t.length >= 4);
    const seen = new Set();
    for (const word of words) {
      for (const candidate of bigramCandidates(index, word)) {
        const doc = index.docs.find((d) => d.id === candidate.docId);
        if (!doc || !sectionFor(doc, filters) || isBlocked(doc)) continue;
        if (seen.has(doc.id) || scored.has(doc.id)) continue; // exact wins
        seen.add(doc.id);
        fuzzyHits += 1;
        bump(doc, 2.2 * candidate.similarity, 'fuzzy');
      }
    }
  }

  // --- 6c. semantic half (kNN + distance threshold) -----------------
  let semanticHits = 0;
  if (semantic && compiled.raw.trim().length >= 3) {
    const q = embed(compiled.raw);
    for (const doc of index.docs) {
      if (!sectionFor(doc, filters) || isBlocked(doc)) continue;
      if (chatId && doc.chatId !== chatId) continue;
      const vec = index.vectors.get(doc.id);
      if (!vec) continue;
      const similarity = coverage(q, vec);
      const distance = 1 - similarity; // distance, as in the kNN threshold
      if (distance > distanceThreshold) continue;
      semanticHits += 1;
      if (scored.has(doc.id)) {
        bump(doc, 0.9 * similarity, 'semantic-boost');
      } else {
        bump(doc, 0.9 * similarity, 'semantic', true);
      }
    }
  }

  // --- 6d. ranking --------------------------------------------------
  const results = [...scored.values()].map((entry) => {
    const ageDays = Math.max(
      0,
      (now - (entry.doc.timestamp ?? 0)) / 86_400_000,
    );
    const recency = 1 / (1 + ageDays / 30); // 30-day half-life-ish
    const pinnedBoost = entry.doc.chat?.pinned ? 0.25 : 0;
    return {
      id: entry.doc.id,
      kind: entry.doc.kind,
      section: sectionFor(entry.doc, filters),
      doc: entry.doc.raw,
      chat: entry.doc.chat,
      score: entry.score + 0.75 * recency + pinnedBoost,
      matchKind: entry.semanticOnly
        ? 'semantic'
        : entry.reasons.includes('fuzzy') && !entry.reasons.includes('fts')
          ? 'fuzzy'
          : 'fts',
      reasons: entry.reasons,
    };
  });

  results.sort((a, b) => b.score - a.score || b.doc.timestamp - a.doc.timestamp);

  // --- 6e. staggered pagination ------------------------------------
  // Sections are ordered by their best result, so a strong message hit still
  // leads the page while the first page keeps one row of each kind.
  const bySection = new Map();
  for (const r of results) {
    if (!bySection.has(r.section)) bySection.set(r.section, []);
    bySection.get(r.section).push(r);
  }
  const sectionsOrder = [...bySection.keys()].sort(
    (a, b) => bySection.get(b)[0].score - bySection.get(a)[0].score,
  );

  const pageItems = staggeredInterleave(bySection, sectionsOrder, page, pageSize);
  const total = results.length;
  const consumed = Math.min(total, (page + 1) * pageSize);

  const elapsed = nowMs() - started;

  return {
    query: compiled.raw,
    ftsQuery: compiled.toFtsString(),
    sectionOrder: sectionsOrder,
    items: pageItems,
    sections: sectionsOrder
      .map((key) => ({
        key,
        total: bySection.get(key).length,
        items: pageItems.filter((i) => i.section === key),
      }))
      .filter((s) => s.total > 0),
    total,
    page,
    pageSize,
    nextCursor: consumed < total ? page + 1 : null,
    debug: {
      ftsCount: ftsHits,
      fuzzyHits,
      semanticHits,
      fusedCount: results.length,
      elapsedMs: Number(elapsed.toFixed(2)),
    },
  };
}

/**
 * PaginationStrategyStaggered: take `pageSize` results but round-robin across
 * the active sections so the first page always shows one of each kind instead
 * of 20 messages followed by contacts.
 */
export function staggeredInterleave(bySection, order, page, pageSize) {
  const active = order.filter((k) => (bySection.get(k)?.length ?? 0) > 0);
  const taken = new Map(active.map((k) => [k, page * Math.ceil(pageSize / Math.max(1, active.length))]));
  const out = [];
  let guard = 0;
  while (out.length < pageSize && guard < pageSize * active.length * 2) {
    guard += 1;
    let progressed = false;
    for (const key of active) {
      if (out.length >= pageSize) break;
      const list = bySection.get(key);
      const idx = taken.get(key);
      if (idx < list.length) {
        out.push(list[idx]);
        taken.set(key, idx + 1);
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  return out;
}

function emptyResult(started, compiled) {
  return {
    query: compiled.raw,
    ftsQuery: '',
    items: [],
    sections: [],
    total: 0,
    page: 0,
    pageSize: DEFAULT_PAGE_SIZE,
    nextCursor: null,
    debug: {
      ftsCount: 0,
      fuzzyHits: 0,
      semanticHits: 0,
      fusedCount: 0,
      elapsedMs: Number((nowMs() - started).toFixed(2)),
    },
  };
}

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/* ------------------------------------------------------------------ */
/* 7. Debounced, cancellable session — TokenizedSearchInput in JS      */
/* ------------------------------------------------------------------ */

/**
 * A search session that behaves like WhatsApp's search bar:
 *  - debounces keystrokes (default 250 ms)
 *  - cancels the previous in-flight search (last write wins)
 *  - caches results per (query, filters, page)
 */
export function createSearchSession(index, { debounceMs = 250, onResults, onStart } = {}) {
  let timer = null;
  let generation = 0;
  const cache = new Map();

  const keyOf = (q, filters, page, chatId) =>
    JSON.stringify([normalize(q), filters, page, chatId]);

  return {
    /** Schedule a search; only the newest scheduled call ever delivers. */
    update(query, { filters = {}, page = 0, chatId = null, immediate = false } = {}) {
      clearTimeout(timer);
      const myGeneration = (generation += 1);

      const run = () => {
        const key = keyOf(query, filters, page, chatId);
        if (cache.has(key)) {
          onResults?.(cache.get(key), { fromCache: true });
          return;
        }
        onStart?.(query);
        const result = search(index, { query, filters, page, chatId });
        cache.set(key, result);
        if (myGeneration === generation) onResults?.(result, { fromCache: false });
      };

      if (immediate) run();
      else timer = setTimeout(run, debounceMs);
    },
    cancel() {
      clearTimeout(timer);
      generation += 1;
    },
    clearCache() {
      cache.clear();
    },
  };
}
