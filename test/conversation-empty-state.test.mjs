import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('conversation renders an accessible empty state when no messages exist', async () => {
  const [app, styles] = await Promise.all([
    readSource('../src/live-app.mjs'),
    readSource('../src/live-styles.css'),
  ]);

  assert.match(app, /class="conversation-empty"/);
  assert.match(app, /No messages yet/);
  assert.match(app, /Send the first message to start this conversation\./);
  assert.match(styles, /\.conversation-empty\s*\{/);
  assert.match(styles, /\.conversation-empty-icon\s*\{/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
});
