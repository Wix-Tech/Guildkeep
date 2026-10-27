import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('message mentions provide member suggestions and a realtime notification list', async () => {
  const [app, api, html, styles, migration, downMigration] = await Promise.all([
    readSource('../src/live-app.mjs'),
    readSource('../src/supabase-chat.mjs'),
    readSource('../index.html'),
    readSource('../src/live-styles.css'),
    readSource('../db/supabase/013_mentions_notifications.sql'),
    readSource('../db/supabase/013_mentions_notifications.down.sql'),
  ]);

  assert.match(app, /renderMentionSuggestions\(event\.target\)/);
  assert.match(app, /data-mention-id=/);
  assert.match(app, /data-mention-chat/);
  assert.match(app, /subscribeToMentions\(/);
  assert.match(app, /await scrollToMessage\(messageId\)/);
  assert.match(api, /rpc\('list_my_mentions'\)/);
  assert.match(api, /table: 'message_mentions'/);
  assert.match(html, /id="mention-notifications-toggle"/);
  assert.match(html, /id="mention-notification-list"/);
  assert.match(styles, /\.mention-notifications/);
  assert.match(migration, /user_id = \(select auth\.uid\(\)\)/i);
  assert.match(migration, /member\.chat_id = new\.chat_id/i);
  assert.match(migration, /message\.created_at > settings\.last_read_at/i);
  assert.match(migration, /alter publication supabase_realtime add table public\.message_mentions/i);
  assert.match(downMigration, /drop table if exists public\.message_mentions/i);
});
