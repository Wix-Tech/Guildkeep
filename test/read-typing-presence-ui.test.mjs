import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('active chat read receipts, typing, and presence stay private and are cleaned up', async () => {
  const [app, chat, migration, down, styles] = await Promise.all([
    readSource('../src/live-app.mjs'),
    readSource('../src/supabase-chat.mjs'),
    readSource('../db/supabase/009_read_typing_presence.sql'),
    readSource('../db/supabase/009_read_typing_presence.down.sql'),
    readSource('../src/live-styles.css'),
  ]);

  const openChatStart = app.indexOf('async function openChat(chatId, chatOverride = null)');
  const openChatEnd = app.indexOf('async function refreshChatReadReceipts', openChatStart);
  const openChatSource = app.slice(openChatStart, openChatEnd);
  assert.ok(openChatStart >= 0 && openChatEnd > openChatStart);
  assert.doesNotMatch(openChatSource, /markChatRead\(/, 'opening a conversation must not mark it read');
  assert.match(app, /wasAtBottom && state\.readAckArmed/);
  assert.match(app, /function armReadAtBottom\(list\)/);
  assert.match(app, /Date\.now\(\) <= state\.scrollIntentUntil/);
  assert.match(app, /conversationIsVisible\(\)/);
  assert.match(app, /state\.readAckArmed[\s\S]*?isScrolledToBottom\(list\)/);
  assert.match(app, /data-read-count=/);
  assert.match(app, /message-sent-tick[\s\S]*?is-read/);
  assert.match(app, /!?\['direct', 'group'\]\.includes\(chatType\(\)\)/);
  assert.match(app, /shouldSendTyping\(state\.lastTypingSentAt, now\)/);
  assert.match(app, /clearTimeout\(state\.typingTimers\.get\(payload\.user_id\)\)/);
  assert.match(app, /state\.chatLive\?\.unsubscribe\(\)/);
  assert.match(app, /visibilitychange/);
  assert.match(chat, /rpc\('mark_chat_read'/);
  assert.match(chat, /channel\(`chat-live:\$\{chatId\}`, \{[\s\S]*?private: true[\s\S]*?presence: \{ key: userId \}/);
  assert.match(chat, /table: 'message_reads',[\s\S]*?filter: `chat_id=eq\.\$\{chatId\}`/);
  assert.match(migration, /create policy "Users can insert their own read receipt"/);
  assert.match(migration, /create policy "Users can update their own read receipt"/);
  assert.match(migration, /create policy "Chat members can receive private live events"/);
  assert.match(migration, /create policy "Chat members can send private live events"/);
  assert.match(migration, /order by message\.created_at desc, message\.id desc/);
  assert.match(down, /drop table if exists public\.message_reads/);
  assert.match(styles, /\.message-sent-tick\.is-read \{ color: #f08a45;/);
  assert.match(styles, /\.chat-presence\.is-online/);
});
