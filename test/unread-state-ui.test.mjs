import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { firstUnreadMessageId, totalUnreadCount } from '../src/chat-live-state.mjs';

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

test('unread rendering includes a divider, muted-chat indicator, and total badge/title', async () => {
  const [app, api, styles, migration, downMigration] = await Promise.all([
    readSource('../src/live-app.mjs'),
    readSource('../src/supabase-chat.mjs'),
    readSource('../src/live-styles.css'),
    readSource('../db/supabase/015_unread_behavior.sql'),
    readSource('../db/supabase/015_unread_behavior.down.sql'),
  ]);

  assert.match(app, /firstUnreadMessageId\(/);
  assert.match(app, /new-messages-divider/);
  assert.match(app, /renderNavigationBadges\(\)/);
  assert.match(app, /document\.title = total/);
  assert.match(app, /data-mute-id/);
  assert.match(app, /chat-unread-dot/);
  assert.match(app, /await setChatMuted\(/);
  assert.match(api, /\.select\('chat_id, muted'\)/);
  assert.match(api, /\.update\(\{ muted \}\)/);
  assert.match(styles, /\.new-messages-divider/);
  assert.match(styles, /\.chat-unread-dot/);
  assert.match(migration, /add column if not exists muted boolean not null default false/i);
  assert.match(migration, /grant update \(muted\).*authenticated/i);
  assert.match(downMigration, /drop column if exists muted/i);
});

test('unread totals count messages and the divider starts at the first unread received message', () => {
  assert.equal(totalUnreadCount([
    { unread_count: 2 },
    { unread_count: '3' },
    { unread_count: null },
  ]), 5);

  const messages = [
    { id: 'old', sender_id: 'peer', created_at: '2026-03-01T10:00:00Z' },
    { id: 'own', sender_id: 'me', created_at: '2026-03-01T10:01:00Z' },
    { id: 'first-unread', sender_id: 'peer', created_at: '2026-03-01T10:02:00Z' },
    { id: 'next-unread', sender_id: 'peer', created_at: '2026-03-01T10:03:00Z' },
  ];
  assert.equal(
    firstUnreadMessageId(messages, 'me', '2026-03-01T10:01:00Z'),
    'first-unread',
  );
  assert.equal(firstUnreadMessageId(messages, 'me', 'invalid date'), null);
});
