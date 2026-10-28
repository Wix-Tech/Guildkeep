import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('avatars render an online status ring and presence feeds it', async () => {
  const [app, styles] = await Promise.all([
    readSource('../src/live-app.mjs'),
    readSource('../src/live-styles.css'),
  ]);

  assert.match(app, /function avatar\(name, id, avatarPath = null, online = false\)/);
  assert.match(app, /class="avatar\$\{online \? ' is-online' : ''\}"/);
  assert.match(app, /state\.onlineUserIds\.has\(peer\.id\)/);
  assert.match(app, /state\.onlineUserIds\.has\(message\.sender_id\)/);
  assert.match(app, /state\.onlineUserIds\.has\(profile\.id\)/);
  assert.match(app, /state\.onlineUserIds\.has\(member\.id\)/);
  assert.match(styles, /\.avatar\.is-online\s*\{/);
  assert.match(styles, /box-shadow: 0 0 0 3px #e8873a/);
});
