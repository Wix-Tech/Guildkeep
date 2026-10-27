import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('message reactions expose quick toggles, who-reacted details, and reduced-motion heart feedback', async () => {
  const [app, styles, html, chat] = await Promise.all([
    readSource('../src/live-app.mjs'),
    readSource('../src/live-styles.css'),
    readSource('../index.html'),
    readSource('../src/supabase-chat.mjs'),
  ]);

  assert.match(app, /data-quick-reaction/);
  assert.match(app, /data-toggle-reaction/);
  assert.match(app, /data-reaction-details/);
  assert.match(app, /getProfilePreview\(userId\)/);
  assert.match(app, /addEventListener\('dblclick'/);
  assert.match(app, /event\.pointerType !== 'touch'/);
  assert.match(app, /subscribeToReactions\(chatId,/);
  assert.match(chat, /filter: `chat_id=eq\.\$\{chatId\}`/);
  assert.match(html, /id="reaction-details"/);
  assert.match(styles, /\.message:hover \.message-quick-reactions/);
  assert.match(styles, /prefers-reduced-motion: reduce[\s\S]*?\.message\.heart-pop::after \{ content: none;/);
});
