/**
 * corpus.mjs — a small, deterministic, WhatsApp-shaped dataset for the demo.
 *
 * Shape mirrors the WhatsApp tables the search code joins against:
 *   chats      ~ chat / available_message_view
 *   contacts   ~ wa_contacts (+ wa_contacts_fts search rows)
 *   messages   ~ message + message_ftsv2 (docid = sort_id)
 *
 * Replace this with your own loader: search-engine.mjs only needs
 * { chats: [{id, name, kind, pinned?, avatarHue?}], contacts: [...], messages: [...] }.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// Fixed clock so the demo is deterministic (recency scoring needs "now").
export const DEMO_NOW = Date.UTC(2026, 9, 26, 17, 0, 0);

const contact = (id, name, kind, extra = {}) => ({
  id,
  name,
  kind, // 'person' | 'group' | 'business'
  phone: extra.phone ?? `+234 80${(id.length * 37) % 10} ${100 + id.length * 7} ${2000 + id.length * 13}`,
  about: extra.about ?? '',
  tags: extra.tags ?? [],
  lastActiveAt: extra.lastActiveAt ?? DEMO_NOW - 3 * DAY,
});

export const contacts = [
  contact('c1', 'Ana Ribeiro', 'person', {
    about: 'Product designer, Lisbon. Sends too many voice notes.',
    tags: ['design', 'lisbon'],
  }),
  contact('c2', 'Adebayo Okafor', 'person', {
    about: 'Backend engineer. Postgres and SQLite performance nerd.',
    tags: ['engineering', 'lagos'],
  }),
  contact('c3', 'Priya Nair', 'person', {
    about: 'Data scientist. Works on embeddings and vector search.',
    tags: ['ml', 'embeddings', 'bangalore'],
  }),
  contact('c4', 'Tomás Silva', 'person', {
    about: 'Photographer. Fujifilm X100V.',
    tags: ['photography'],
  }),
  contact('c5', 'Chiamaka Eze', 'person', {
    about: 'Lawyer, Abuja. Always on a call.',
    tags: ['legal', 'abuja'],
  }),
  contact('c6', 'Lukas Meyer', 'person', {
    about: 'iOS engineer in Berlin. Maintains the offline cache layer.',
    tags: ['engineering', 'ios', 'berlin'],
  }),
  contact('c7', 'Sofia Marchetti', 'person', {
    about: 'Runs the Naples bakery account.',
    tags: ['bakery'],
  }),
  contact('c8', 'Kofi Mensah', 'person', {
    about: 'Growth marketing. Spreadsheets and dashboards.',
    tags: ['marketing', 'accra'],
  }),
  contact('c9', 'Chen Wei', 'person', {
    about: 'Android platform engineer. FTS and SQLite migrations.',
    tags: ['engineering', 'android', 'sqlite'],
  }),
  contact('c10', 'Nadia Haddad', 'person', {
    about: 'PM, search & discovery.',
    tags: ['product', 'search'],
  }),

  contact('g1', 'Design Guild', 'group', {
    about: 'Design critique, every Thursday.',
    tags: ['design', 'critique'],
  }),
  contact('g2', 'Backend Platform', 'group', {
    about: 'On-call rotation and database incidents.',
    tags: ['engineering', 'on-call'],
  }),
  contact('g3', 'Lagos Running Club', 'group', {
    about: 'Saturday 6am runs from Ikoyi.',
    tags: ['sport', 'lagos'],
  }),
  contact('g4', 'Search Quality Working Group', 'group', {
    about: 'Ranking evaluations, relevance judgements, query logs.',
    tags: ['search', 'ranking', 'relevance'],
  }),

  contact('b1', 'Naples Bakery', 'business', {
    about: 'Fresh sourdough, pastries. Order pickup in 15 minutes.',
    tags: ['bakery', 'food'],
  }),
  contact('b2', 'Ikoyi Pharmacy', 'business', {
    about: '24/7 pharmacy, delivery in Lagos.',
    tags: ['health', 'lagos'],
  }),
  contact('b3', 'Kite Wire', 'business', {
    about: 'Payments API for African businesses.',
    tags: ['fintech', 'payments'],
  }),
];

export const chats = [
  { id: 'ch1', name: 'Ana Ribeiro', kind: 'direct', pinned: true, avatarHue: 210 },
  { id: 'ch2', name: 'Adebayo Okafor', kind: 'direct', avatarHue: 150 },
  { id: 'ch3', name: 'Design Guild', kind: 'group', avatarHue: 280 },
  { id: 'ch4', name: 'Backend Platform', kind: 'group', pinned: true, avatarHue: 20 },
  { id: 'ch5', name: 'Priya Nair', kind: 'direct', avatarHue: 320 },
  { id: 'ch6', name: 'Lagos Running Club', kind: 'group', avatarHue: 90 },
  { id: 'ch7', name: 'Search Quality Working Group', kind: 'group', avatarHue: 200 },
  { id: 'ch8', name: 'Lukas Meyer', kind: 'direct', avatarHue: 40 },
  { id: 'ch9', name: 'Naples Bakery', kind: 'business', avatarHue: 12 },
  { id: 'ch10', name: 'Ikoyi Pharmacy', kind: 'business', avatarHue: 160 },
  { id: 'ch11', name: 'Chen Wei', kind: 'direct', avatarHue: 250 },
  { id: 'ch12', name: 'Kite Wire', kind: 'business', avatarHue: 190 },
  { id: 'ch13', name: 'Chiamaka Eze', kind: 'direct', avatarHue: 300 },
];

let seq = 1000;
const msg = (chatId, senderId, text, daysAgo, extra = {}) => ({
  id: `m${(seq += 1)}`,
  chatId,
  senderId,
  text,
  timestamp: DEMO_NOW - daysAgo * DAY,
  ...extra,
});

export const messages = [
  // --- search / engineering discussions -----------------------------
  msg('ch7', 'c10', 'Ranking evaluation for the new prefix matching is done: recall@10 jumped from 0.62 to 0.81.', 1),
  msg('ch7', 'c9', 'The FTS query compiler now appends a wildcard only to the last token, so "search eng" matches "search engine".', 2),
  msg('ch7', 'c3', 'Semantic recall is better on paraphrases but the distance threshold needs tuning. 0.42 is still too loose.', 3),
  msg('ch7', 'c10', 'Can we get the query logs for last week? I want to look at zero-result queries.', 4),
  msg('ch7', 'c2', 'Zero results are usually typos. Bigram matching on contacts fixed 30% of them.', 5),
  msg('ch4', 'c2', 'The message index rebuild takes 41 seconds on a 200k message database.', 1.2),
  msg('ch4', 'c9', 'FTS4 with an external content table keeps the index small. Full rebuild is only needed after a schema change.', 1.4),
  msg('ch4', 'c2', 'Careful: deleting rows does not shrink the FTS index, we need to run the optimize command.', 2.5),
  msg('ch4', 'c9', 'Added a repair path that rebuilds the search tables when the database comes back corrupt.', 6),
  msg('ch4', 'c6', 'The trigger on wa_contacts marks rows dirty and a background job drains them in batches of 975.', 7),
  msg('ch5', 'c3', 'I pushed the embedding pipeline. 96 dimensions, quantised, ~14 MB for 300k messages.', 1.6),
  msg('ch5', 'c3', 'kNN over the vector table returns message ids; we filter by cosine distance before joining back.', 2.2),
  msg('ch5', 'c10', 'Do we merge semantic and keyword results, or show them as separate sections?', 2.6),
  msg('ch5', 'c3', 'Merged, but we log ftsCount, semanticCount and the overlap so we can measure each half.', 2.8),
  msg('ch11', 'c9', 'Heads up: the tokenizer is applied at write time and at query time, so both sides must agree on locale rules.', 3.4),
  msg('ch11', 'c9', 'Turkish dotless i broke prefix search until we OR-expanded i with dotless i.', 3.6),
  msg('ch11', 'c6', 'Do we store the tokenizer version with each row? Otherwise a re-tokenize migration is unavoidable.', 4.2),

  // --- day to day ---------------------------------------------------
  msg('ch1', 'c1', 'Can you send me the Figma link for the new empty state?', 0.2),
  msg('ch1', 'me', 'Sent. The search empty state now shows recent queries instead of nothing.', 0.18),
  msg('ch1', 'c1', 'Perfect. Also the filter chips are too tall on small screens.', 0.1),
  msg('ch3', 'c1', 'Critique on Thursday: bring the search results screen and the filter sheet.', 0.6),
  msg('ch3', 'c8', 'I will walk through the empty state and the zero-result copy.', 0.5),
  msg('ch3', 'c1', 'Reminder: the results list needs a staggered first page, not 20 messages then contacts.', 1.1),
  msg('ch3', 'c10', 'Agreed. One of each section on the first page reads much better.', 1.05),
  msg('ch2', 'c2', 'Did the migration finish on staging?', 0.9),
  msg('ch2', 'me', 'It did. 12 minutes, no downtime, index rebuild ran afterwards.', 0.85),
  msg('ch2', 'c2', 'Nice. Let us schedule production for Sunday night.', 0.8),
  msg('ch6', 'c8', 'Saturday run: 6am from Ikoyi, 12km, slow pace.', 2.1),
  msg('ch6', 'me', 'In. Bringing the pharmacy order afterwards.', 2),
  msg('ch6', 'c5', 'I will be late, start without me.', 1.9),
  msg('ch8', 'c6', 'The offline cache now stores the last 500 messages per chat.', 3.1),
  msg('ch8', 'me', 'Does it also cache the search index, or do we re-index on launch?', 3),
  msg('ch8', 'c6', 'Re-index on launch, but incrementally from a cursor.', 2.95),
  msg('ch11', 'me', 'Left a comment on the SQLite migration PR.', 5),
  msg('ch11', 'c9', 'Thanks, addressed. The dirty-version column is now part of the primary index.', 4.8),
  msg('ch13', 'c5', 'Contract draft is ready, please review clause 4 on data retention.', 2.7),
  msg('ch13', 'me', 'Reading tonight. The retention window looks too short for audits.', 2.65),

  // --- business -----------------------------------------------------
  msg('ch9', 'b1', 'Your sourdough order is ready for pickup. Reply 1 to confirm.', 0.3),
  msg('ch9', 'me', '1', 0.28),
  msg('ch9', 'b1', 'Confirmed. Pickup until 7pm, 12 Via Toledo.', 0.27),
  msg('ch10', 'b2', 'Your prescription is ready. Delivery within 90 minutes in Lagos.', 0.4),
  msg('ch10', 'me', 'Please deliver to Lekki Phase 1.', 0.35),
  msg('ch12', 'b3', 'Kite Wire: your API keys were rotated. Update your integration before Friday.', 1.5),
  msg('ch12', 'me', 'Can you extend the grace period? Our release is Thursday.', 1.45),
  msg('ch12', 'b3', 'Extension granted until Monday 09:00 WAT.', 1.4),
  msg('ch9', 'b1', 'New: pistachio croissant on Saturdays only.', 9),
  msg('ch10', 'b2', 'We now deliver to Ajah and Sangotedo.', 11),

  // --- recency anchors for recency ranking --------------------------
  msg('ch1', 'c1', 'One more thing: search results should highlight the matched words.', 0.05),
  msg('ch4', 'c2', 'Incident closed: the search index was 2 versions behind after the upgrade.', 0.07),
  msg('ch7', 'c10', 'Zero-result rate is down to 6.4% this week.', 0.08),

  // --- messages that only semantic search will find -----------------
  msg('ch5', 'c3', 'The nearest-neighbour lookup returns 50 candidates and we keep the 20 closest.', 8),
  msg('ch7', 'c10', 'Users keep typing whole questions instead of keywords; keyword search fails on those.', 12),
  msg('ch4', 'c9', 'Text normalisation strips accents so "Tomas" finds "Tomás".', 15),
  msg('ch3', 'c1', 'The results screen should feel instant even with 300k messages.', 18),
  msg('ch8', 'c6', 'Voice notes are transcribed before indexing, otherwise they are invisible to search.', 21),
];

export const corpus = { chats, contacts, messages };

/** Ready-made recent queries for the empty state (RecentSearchItemsManager). */
export const recentSearches = [
  'search index rebuild',
  'Ana',
  'sourdough order',
  'on-call rotation',
];
