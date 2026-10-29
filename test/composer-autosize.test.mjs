import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('composer auto-grows with input and gates send on empty drafts', async () => {
  const [app, styles] = await Promise.all([
    readSource('../src/live-app.mjs'),
    readSource('../src/live-styles.css'),
  ]);

  assert.match(app, /function autosizeComposerTextarea/);
  assert.match(app, /function updateComposerSendState/);
  assert.match(app, /autosizeComposerTextarea\(event\.target\)/);
  assert.match(app, /updateComposerSendState\(\);/);
  assert.match(app, /sendButton\.disabled = sending \|\| \(!hasBody && !queue\.length\)/);
  assert.match(styles, /\.conversation-footer textarea[\s\S]*?resize: none/);
});
