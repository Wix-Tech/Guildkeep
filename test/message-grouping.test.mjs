import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('messages render date separators between days and styled dividers', async () => {
  const [app, styles] = await Promise.all([
    readSource('../src/live-app.mjs'),
    readSource('../src/live-styles.css'),
  ]);

  assert.match(app, /function formatMessageDate/);
  assert.match(app, /message-date-divider/);
  assert.match(app, /isNewDay/);
  assert.match(app, /formatMessageDate\(message\.created_at\)/);
  assert.match(app, /toDateString\(\) !== new Date\(previous/);
  assert.match(styles, /\.message-date-divider\s*\{/);
  assert.match(styles, /\.message-date-divider::before/);
});
