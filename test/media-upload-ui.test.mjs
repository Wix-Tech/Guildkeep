import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('chat attachments support batch selection, drag-and-drop, previews, progress, and retry', async () => {
  const [app, html, styles] = await Promise.all([
    readSource('../src/live-app.mjs'),
    readSource('../index.html'),
    readSource('../src/live-styles.css'),
  ]);

  assert.match(html, /id="chat-media-input"[^>]*multiple/);
  assert.match(app, /function queueChatMediaFiles\(files\)/);
  assert.match(app, /function renderPendingChatMedia\(\)/);
  assert.match(app, /function removeQueuedChatMedia\(/);
  assert.match(app, /data-retry-chat-media=/);
  assert.match(app, /data-remove-chat-media=/);
  assert.match(app, /addEventListener\('dragover'/);
  assert.match(app, /addEventListener\('drop'/);
  assert.match(app, /onProgress:\s*\(ratio\)/);
  assert.match(app, /status === 'failed'/);
  assert.match(app, /MAX_UPLOAD_BYTES = 25 \* 1024 \* 1024/);
  assert.match(styles, /\.chat-media-queue-item/);
  assert.match(styles, /\.chat-media-drop-hint/);
});
