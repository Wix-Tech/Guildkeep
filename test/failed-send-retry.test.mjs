import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('failed sends queue a retry and drain through connectivity recovery', async () => {
  const app = await readSource('../src/live-app.mjs');

  assert.match(app, /failedSends: \[\],/);
  assert.match(app, /async function retryFailedSends/);
  assert.match(app, /state\.failedSends\.push\(\{ chatId, body, replyToId \}\)/);
  assert.match(app, /state\.failedSends = state\.failedSends\.filter/);
  assert.match(app, /window\.addEventListener\('online'/);
  assert.match(app, /void retryFailedSends\(\)/);
});
