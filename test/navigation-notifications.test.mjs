import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('navigation carries unread badges, alerts, status reactions, and account sign-out', async () => {
  const [html, app, api, styles, migration, downMigration] = await Promise.all([
    readSource('../index.html'),
    readSource('../src/live-app.mjs'),
    readSource('../src/supabase-chat.mjs'),
    readSource('../src/live-styles.css'),
    readSource('../db/supabase/019_navigation_status_reactions.sql'),
    readSource('../db/supabase/019_navigation_status_reactions.down.sql'),
  ]);
  const topbar = html.split('<header class="app-topbar">')[1]?.split('</header>')[0];

  assert.ok(topbar);
  assert.doesNotMatch(topbar, /unread-total-toggle|mention-notifications-toggle|sign-out/);
  assert.match(html, /id="mention-notifications-toggle"[\s\S]*?<small>Alerts<\/small>/);
  assert.match(html, /id="nav-unread-chats"/);
  assert.match(html, /id="nav-unread-groups"/);
  assert.match(html, /id="nav-unread-channels"/);
  assert.match(html, /id="nav-status-reactions"/);
  assert.match(app, /getMyNavigationUnreadCounts\(\)/);
  assert.match(app, /renderNavigationBadges\(\)/);
  assert.match(app, /state\.statusReactionNotifications\.length/);
  assert.match(app, /data-status-reaction=/);
  assert.match(app, /toggleStatusReaction\(/);
  assert.match(app, /markMyStatusReactionNotificationsRead\(\)/);
  assert.match(app, /id="settings-sign-out"/);
  assert.doesNotMatch(app, /\$\('sign-out'\)\.addEventListener/);
  assert.match(api, /rpc\('get_my_navigation_unread_counts'\)/);
  assert.match(api, /rpc\('toggle_status_reaction'/);
  assert.match(api, /rpc\('list_my_status_reaction_notifications'\)/);
  assert.match(api, /table: 'status_reactions'/);
  assert.match(styles, /\.nav-item-badge/);
  assert.match(styles, /\.status-reaction-chip/);
  assert.match(migration, /status_id uuid not null references public\.status_posts/i);
  assert.match(migration, /public\.can_view_status\(status\.author_id, status\.expires_at\)/i);
  assert.match(migration, /mark_my_status_reaction_notifications_read/);
  assert.match(migration, /get_my_navigation_unread_counts/);
  assert.match(migration, /alter publication supabase_realtime add table public\.status_reactions/i);
  assert.match(downMigration, /drop table if exists public\.status_reactions/i);
});
