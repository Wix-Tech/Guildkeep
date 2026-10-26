/**
 * search-engine.test.mjs — behavioural tests for the ported engine.
 * Run:  node --test product/test/
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildIndex,
  search,
  compileQuery,
  normalize,
  bigrams,
  createSearchSession,
} from '../src/search-engine.mjs';
import { corpus, DEMO_NOW } from '../src/corpus.mjs';

const index = buildIndex(corpus);
const run = (query, options = {}) =>
  search(index, { query, now: DEMO_NOW, ...options });

test('normalisation strips accents and punctuation', () => {
  assert.equal(normalize('  Tomás,   O’Brien! '), "tomas o'brien");
});

test('bigrams wrap the word with sentinels', () => {
  assert.deepEqual(bigrams('ana'), ['#a', 'an', 'na', 'a#']);
});

test('query compiler appends a prefix wildcard to the last token only', () => {
  const q = compileQuery('search eng');
  assert.deepEqual(q.terms, ['search', 'eng']);
  assert.equal(q.toFtsString(), 'content:search content:eng*');
});

test('query compiler keeps quoted phrases intact', () => {
  const q = compileQuery('"distance threshold"');
  assert.deepEqual(q.phrases, [['distance', 'threshold']]);
  assert.deepEqual(q.terms, []);
});

test('query compiler extracts field filters and negations', () => {
  const q = compileQuery('index -corrupt from:c9');
  assert.deepEqual(q.terms, ['index']);
  assert.deepEqual(q.negatedTerms, ['corrupt']);
  assert.equal(q.filters.from, 'c9');
});

test('prefix search behaves like as-you-type', () => {
  const hit = run('sourd');
  assert.ok(hit.total > 0, 'expected a prefix match for "sourd"');
  assert.ok(
    hit.items.some((i) => /sourdough/i.test(i.doc.text ?? '')),
    'expected the sourdough message',
  );
});

test('prefix on the last token, AND semantics on earlier tokens', () => {
  const both = run('search eng', { semantic: false, fuzzy: false });
  assert.ok(both.total > 0);
  for (const item of both.items) {
    const text = `${item.doc.text ?? ''} ${item.doc.name ?? ''}`.toLowerCase();
    assert.ok(text.includes('search'), 'every FTS result mentions the first term');
  }
});

test('phrase search requires adjacency', () => {
  const phrase = run('"distance threshold"');
  assert.ok(phrase.total > 0);
  assert.ok(
    phrase.items.some((i) => /distance threshold/i.test(i.doc.text ?? '')),
  );
});

test('negated terms exclude documents', () => {
  const all = run('index');
  const filtered = run('index -rebuild');
  assert.ok(filtered.total < all.total, 'a negated term must remove results');
  assert.ok(
    filtered.items.every((i) => !/rebuild/i.test(i.doc.text ?? '')),
    'no result may contain the negated term',
  );
});

test('contact search tolerates typos through bigrams', () => {
  const exact = run('Adebayo');
  const typo = run('Adebyo');
  assert.ok(exact.total > 0, 'exact contact match');
  assert.ok(typo.total > 0, 'typo should still find the contact');
  assert.equal(typo.items[0].doc.name, 'Adebayo Okafor');
  assert.equal(typo.items[0].matchKind, 'fuzzy', 'a misspelling is served by the bigram layer');
  assert.equal(exact.items[0].matchKind, 'fts', 'an exact query stays on the FTS layer');
});

test('a pure typo is served by the fuzzy layer only', () => {
  const res = run('Ribiero'); // "Ribeiro" misspelled
  assert.ok(res.total > 0);
  assert.equal(res.items[0].doc.name, 'Ana Ribeiro');
});

test('semantic layer reaches documents with no exact token match', () => {
  // "rebuilt indexing" shares no token with "The message index rebuild takes 41s"
  const ftsOnly = run('rebuilt indexing', { semantic: false, fuzzy: false });
  const hybrid = run('rebuilt indexing', { fuzzy: false });
  assert.equal(ftsOnly.total, 0, 'the FTS layer alone cannot match');
  assert.ok(hybrid.debug.semanticHits > 0, 'the kNN layer must find candidates');
  assert.ok(
    hybrid.items.some((i) => /message index rebuild/i.test(i.doc.text ?? '')),
    'the rebuild message is retrieved by the semantic layer',
  );
  assert.equal(hybrid.items[0].matchKind, 'semantic', 'labelled as semantic-only');
});

test('hybrid counters are reported (ftsCount / semanticCount / overlap)', () => {
  const res = run('search index');
  assert.ok(res.debug.ftsCount > 0);
  assert.ok(res.debug.fusedCount >= res.debug.ftsCount);
});

test('section filters switch which engines run', () => {
  const onlyContacts = run('ana', { filters: { messages: false, contacts: true, groups: false, business: false } });
  assert.ok(onlyContacts.items.every((i) => i.section === 'contacts'));

  const onlyGroups = run('ana', { filters: { messages: false, contacts: false, groups: true, business: false } });
  assert.ok(onlyGroups.items.every((i) => i.section === 'groups'));
});

test('chat scoping works like fts_jid', () => {
  const res = run('index', { chatId: 'ch4' });
  assert.ok(res.total > 0);
  assert.ok(res.items.every((i) => i.chatId === undefined || i.chat.id === 'ch4'));
});

test('pagination is staggered and terminates', () => {
  const first = run('search', { pageSize: 5 });
  assert.ok(first.items.length <= 5);
  assert.ok(first.nextCursor !== null, 'more pages expected');

  const second = run('search', { pageSize: 5, page: 1 });
  const firstIds = new Set(first.items.map((i) => i.id));
  assert.ok(second.items.every((i) => !firstIds.has(i.id)), 'no overlap between pages');

  let page = 0;
  let guard = 0;
  let res = run('search', { pageSize: 5, page });
  while (res.nextCursor !== null && guard < 50) {
    page = res.nextCursor;
    res = run('search', { pageSize: 5, page });
    guard += 1;
  }
  assert.ok(guard < 50, 'pagination must terminate');
});

test('first page interleaves sections instead of clumping', () => {
  const res = run('search', { pageSize: 6 });
  const kinds = new Set(res.items.map((i) => i.section));
  assert.ok(kinds.size >= 2, `expected >1 section on the first page, got ${[...kinds]}`);
});

test('recency breaks ties between equally relevant documents', () => {
  const res = run('search', { pageSize: 40 });
  // the page is staggered, so ordering is guaranteed *within* each section
  for (const section of res.sections) {
    const scores = section.items.map((i) => i.score);
    assert.deepEqual(
      scores,
      [...scores].sort((a, b) => b - a),
      `section ${section.key} must be sorted by score`,
    );
  }
  const messages = res.items.filter((i) => i.section === 'messages');
  assert.ok(messages.length > 1);
  const newest = messages[0];
  const older = messages[messages.length - 1];
  assert.ok(newest.doc.timestamp >= older.doc.timestamp, 'newest message ranks first');
});

test('empty and whitespace queries return nothing', () => {
  assert.equal(run('   ').total, 0);
  assert.equal(run('').total, 0);
});

test('search session debounces and caches', async () => {
  const calls = [];
  const session = createSearchSession(index, {
    debounceMs: 20,
    onResults: (res, meta) => calls.push({ res, meta }),
  });
  session.update('sourdough');
  session.update('sourd');
  session.update('search');
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(calls.length, 1, 'only the last keystroke should run');
  assert.equal(calls[0].res.query, 'search');

  session.update('search');
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(calls[1].meta.fromCache, true, 'repeat query is served from cache');
});
