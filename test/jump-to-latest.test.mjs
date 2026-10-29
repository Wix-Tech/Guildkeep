import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('conversation exposes a jump-to-latest affordance while scrolled up', async () => {
  const [app, styles] = await Promise.all([
    readSource('../src/live-app.mjs'),
    readSource('../src/live-styles.css'),
  ]);

  assert.match(app, /id="jump-to-latest"/);
  assert.match(app, /function updateJumpToLatest/);
  assert.match(app, /closest\('#jump-to-latest'\)/);
  assert.match(app, /jumpButton\.hidden = true/);
  assert.match(app, /list\.scrollTop = list\.scrollHeight/);
  assert.match(styles, /\.jump-to-latest\s*\{/);
  assert.match(styles, /\.jump-to-latest\[hidden\]\s*\{/);
});
