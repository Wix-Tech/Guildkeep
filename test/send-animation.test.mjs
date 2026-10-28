import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('outgoing sends animate once and clear the send marker', async () => {
  const [app, styles] = await Promise.all([
    readSource('../src/live-app.mjs'),
    readSource('../src/live-styles.css'),
  ]);

  assert.match(app, /lastSentMessageId: null/);
  assert.match(app, /message\.id === state\.lastSentMessageId/);
  assert.match(app, /state\.lastSentMessageId = message\.id/);
  assert.match(app, /state\.lastSentMessageId = null/);
  assert.match(styles, /\.message\.is-sending\s*\{/);
  assert.match(styles, /@keyframes message-send-in/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
});
