import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('read acknowledgements update only the affected message meta instead of rebuilding the list', async () => {
  const app = await readSource('../src/live-app.mjs');

  assert.match(app, /function renderMessageMeta/);
  assert.match(app, /function updateMessageMeta/);
  assert.match(app, /meta\.innerHTML = renderMessageMeta\(message\)/);
  assert.match(app, /updateMessageMeta\(latestMessage\.id\)/);
  assert.doesNotMatch(app, /markChatReadIfAtBottom[\s\S]{0,400}renderMessages\(\)/);
});
