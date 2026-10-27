import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('chat rows can be marked unread through a membership-checked RPC', async () => {
  const [app, api, styles, migration] = await Promise.all([
    readSource('../src/live-app.mjs'),
    readSource('../src/supabase-chat.mjs'),
    readSource('../src/live-styles.css'),
    readSource('../db/supabase/012_mark_chat_unread.sql'),
  ]);

  assert.match(app, /data-mark-unread-id/);
  assert.match(app, /await markChatUnread\(markUnread\.dataset\.markUnreadId\)/);
  assert.match(app, /Chat marked as unread/);
  assert.match(api, /rpc\('mark_chat_unread'/);
  assert.match(styles, /\.chat-mark-unread/);
  assert.match(migration, /member\.user_id = current_user_id/);
  assert.match(migration, /message\.sender_id <> current_user_id/);
  assert.match(migration, /incoming_message_at - interval '1 microsecond'/);
  assert.match(migration, /No received messages to mark unread/);
});
