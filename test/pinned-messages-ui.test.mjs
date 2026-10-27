import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('pinned messages expose secure pin actions, a realtime-updated list, and jump-to behavior', async () => {
  const [app, api, html, styles, migration] = await Promise.all([
    readSource('../src/live-app.mjs'),
    readSource('../src/supabase-chat.mjs'),
    readSource('../index.html'),
    readSource('../src/live-styles.css'),
    readSource('../db/supabase/011_pinned_messages.sql'),
  ]);

  assert.match(app, /data-message-action="pin"/);
  assert.match(app, /function mayManagePins/);
  assert.match(app, /subscribeToChatPins\(chatId/);
  assert.match(app, /data-open-pinned-messages/);
  assert.match(app, /data-pinned-message/);
  assert.match(app, /await scrollToMessage\(jumpButton\.dataset\.pinnedMessage\)/);
  assert.match(api, /from\('chat_pins'\)/);
  assert.match(api, /subscribeToChatPins/);
  assert.match(html, /id="pinned-messages-dialog"/);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /member\.role in \('owner', 'admin'\)/i);
  assert.match(migration, /message\.chat_id = new\.chat_id/i);
  assert.match(migration, /remove_deleted_message_pin/);
  assert.match(styles, /\.pinned-message-banner/);
  assert.match(styles, /\.pinned-messages-card/);
});
