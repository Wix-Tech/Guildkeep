/**
 * demo-bundle.test.mjs — smoke-test the bundled demo.html without a browser.
 *
 * Extracts the inline module from demo.html, runs it against a tiny DOM stub,
 * and asserts the UI rendered its empty state. This catches bundle regressions
 * (bad concatenation, syntax errors, missing globals) in CI.
 *
 * Run: node --test product/test/*.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

function makeElement(id) {
  const el = {
    id,
    innerHTML: '',
    textContent: '',
    hidden: true,
    dataset: {},
    style: {},
    value: '',
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(type, fn) {
      (this._listeners ??= {})[type] = fn;
    },
    focus() {},
    closest() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
  return el;
}

test('demo.html bundles cleanly and renders the empty state', async () => {
  const html = await readFile(new URL('../demo.html', import.meta.url), 'utf8');
  const match = /<script type="module">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(match, 'demo.html must contain an inline module script');

  const dir = await mkdtemp(join(tmpdir(), 'demo-'));
  const file = join(dir, 'bundle.mjs');
  await writeFile(file, match[1], 'utf8');

  const elements = new Map();
  const doc = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeElement(id));
      return elements.get(id);
    },
    querySelectorAll() {
      return [];
    },
    addEventListener() {},
    activeElement: null,
  };
  globalThis.document = doc;
  globalThis.window = globalThis;

  await import(pathToFileURL(file).href);

  const empty = elements.get('empty');
  assert.ok(empty, '#empty must exist');
  assert.match(empty.innerHTML, /Search messages, contacts and groups/);
  assert.match(empty.innerHTML, /search index rebuild/, 'recent searches render');

  // a real query through the bundled engine
  const { search, buildIndex } = await import('../src/search-engine.mjs');
  const { corpus, DEMO_NOW } = await import('../src/corpus.mjs');
  const index = buildIndex(corpus);
  const res = search(index, { query: 'sourd', now: DEMO_NOW });
  assert.ok(res.total > 0);
});
