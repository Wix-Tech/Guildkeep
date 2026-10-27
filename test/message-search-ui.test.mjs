import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('message search scopes results server-side and supports accessible jump-to navigation', async () => {
  const [app, api, html, styles, migration] = await Promise.all([
    readSource('../src/live-app.mjs'),
    readSource('../src/supabase-chat.mjs'),
    readSource('../index.html'),
    readSource('../src/live-styles.css'),
    readSource('../db/supabase/010_message_search.sql'),
  ]);

  assert.match(html, /data-open-message-search="global"/);
  assert.match(app, /data-open-message-search="chat"/);
  assert.match(html, /role="dialog" aria-modal="true" aria-labelledby="message-search-title"/);
  assert.match(html, /id="message-search-query" type="search" maxlength="100"/);
  assert.match(app, /setTimeout\(\(\) => void loadMessageSearchResults\(\), 250\)/);
  assert.match(app, /search\.scope === 'chat' \? state\.activeChatId : null/);
  assert.match(api, /rpc\('search_messages'/);
  assert.match(app, /function renderSearchSnippet\(snippet\)/);
  assert.match(app, /node\.nodeName === 'MARK'/);
  assert.match(app, /listMessagesAround\(result\.chat_id, result\.created_at, 240\)/);
  assert.match(app, /setTimeout\(\(\) => target\.classList\.remove\('message-flash'\), 2000\)/);
  assert.match(app, /data-message-search-step/);
  assert.match(app, /event\.key === 'Escape' && searchOpen/);
  assert.match(app, /event\.key === 'Tab' && searchOpen/);
  assert.match(styles, /\.message-search-overlay\s*\{[\s\S]*?position: fixed/);
  assert.match(styles, /@media \(max-width: 380px\)/);
  assert.match(migration, /generated always as \(to_tsvector/);
  assert.match(migration, /using gin \(search_vector\)/i);
  assert.match(migration, /message\.search_vector @@ search_query/);
  assert.doesNotMatch(migration, /ilike\s+'%/i);
});
