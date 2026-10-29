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

test('consecutive same-sender messages render as grouped continuations', async () => {
  const [app, styles] = await Promise.all([
    readSource('../src/live-app.mjs'),
    readSource('../src/live-styles.css'),
  ]);

  assert.match(app, /const senderKey = \(item\) =>/);
  assert.match(app, /const groupStart = !previous/);
  assert.match(app, /const isGroupLast = !nextMessage/);
  assert.match(app, /!groupStart \? 'is-group-continuation '/);
  assert.match(app, /\$\{isGroupLast \? `<span class="message-meta">/);
  assert.match(styles, /\.message\.is-group-continuation \{/);
  assert.match(styles, /\.message\.outgoing\.is-group-continuation \{/);
});
