import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('message replies support quote navigation, mobile swipe, desktop shortcuts, and reduced motion', async () => {
  const [app, styles, chat] = await Promise.all([
    readSource('../src/live-app.mjs'),
    readSource('../src/live-styles.css'),
    readSource('../src/supabase-chat.mjs'),
  ]);

  assert.match(app, /id="reply-strip"/);
  assert.match(app, /data-cancel-reply/);
  assert.match(app, /data-message-reply=/);
  assert.match(app, /data-message-action="reply"/);
  assert.match(app, /data-scroll-to-message=/);
  assert.match(app, /Message deleted/);
  assert.match(app, /event\.clientX - origin\.x >= 72/);
  assert.match(app, /event\.key\.toLowerCase\(\) === 'r'/);
  assert.match(app, /scrollIntoView\(\{ behavior: reducedMotion \? 'auto' : 'smooth'/);
  assert.match(chat, /async function attachReplyTargets\(messages, chatId\)/);
  assert.match(chat, /\.in\('id', replyIds\)/);
  assert.doesNotMatch(chat, /reply_to:messages!messages_reply_to_id_fkey/);
  assert.match(chat, /reply_to_id: replyToId/);
  assert.match(styles, /\.message-reply-shortcut/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*?\.message-reply-shortcut \{ display: none; \}/);
  assert.match(styles, /\.reply-strip/);
  assert.match(styles, /prefers-reduced-motion: reduce[\s\S]*?\.message-flash \{ animation: none;/);
  assert.match(app, /data-quick-reaction/);
  assert.match(app, /addEventListener\('dblclick'/);
});
