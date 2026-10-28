import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('composer paste routes image and file clipboard items into the send queue', async () => {
  const app = await readSource('../src/live-app.mjs');

  assert.match(app, /addEventListener\('paste'/);
  assert.match(app, /querySelector\('textarea\[name="body"\]'\)/);
  assert.match(app, /Array\.from\(event\.clipboardData\?\.files \?\? \[\]\)/);
  assert.match(app, /queueChatMediaFiles\(files\)/);
});
