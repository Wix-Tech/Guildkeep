/**
 * db.test.mjs — the persistence layer and its adapters.
 * Run: node --test product/test/*.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { openMigrated, migrate, openDb, all, get, run } from '../db/db.mjs';
import {
  createGroup,
  addGroupMember,
  loadGroupBot,
  applyEffects,
  recordAudit,
  syncPendingActions,
  syncUndoStack,
  snapshotGroup,
  loadAudit,
  loadSearchCorpus,
  fts5Candidates,
  rebuildSearchIndex,
} from '../db/repository.mjs';
import { seed, NOW } from '../db/seed.mjs';
import { buildIndex, search } from '../src/search-engine.mjs';

const GROUP = 'g_design';
const ADMIN = 'u_adebayo';
const MEMBER = 'u_tomas';

/** Fresh seeded in-memory database for every test. */
async function freshDb() {
  const db = await openMigrated(':memory:');
  await seed(db, { now: NOW });
  return db;
}

/**
 * Exactly what the HTTP handler does: load → handle → persist effects →
 * persist confirmations/undo → audit.
 */
function command(db, actorId, text, now = NOW) {
  const bot = loadGroupBot(db, GROUP, { now: () => now });
  const result = bot.handle({ authorId: actorId, text });
  const written = applyEffects(db, { groupId: GROUP, actorId, effects: result.effects, now });
  syncPendingActions(db, { groupId: GROUP, bot, now });
  syncUndoStack(db, { groupId: GROUP, bot, now });
  recordAudit(db, {
    groupId: GROUP,
    actorId,
    command: result.command ?? text,
    ok: result.ok,
    detail: result.ok ? null : result.message,
    effects: result.effects ?? [],
    now,
  });
  return { ...result, written };
}

/* ---------------- migrations ---------------- */

test('migrations apply once and are idempotent', async () => {
  const db = openDb(':memory:');
  const first = await migrate(db);
  assert.deepEqual(first, [
    '001_init.sql',
    '002_search.sql',
    '003_pending_actions.sql',
    '004_undo_stack.sql',
  ]);
  const second = await migrate(db);
  assert.deepEqual(second, [], 're-running applies nothing');
  assert.equal(all(db, 'SELECT version FROM schema_migrations').length, 4);
  db.close();
});

test('schema enforces its invariants', async () => {
  const db = await freshDb();

  // one owner per group
  assert.throws(
    () =>
      run(
        db,
        `INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?, 'u_adebayo', 'owner', ?)`,
        GROUP,
        NOW,
      ),
    /UNIQUE|constraint/i,
  );

  // phone numbers are unique
  assert.throws(
    () =>
      run(db, `INSERT INTO users (id, name, phone) VALUES ('dupe', 'Dupe', '+234 801 000 0001')`),
    /UNIQUE|constraint/i,
  );

  // status text is length-limited by the schema, not by the bot
  assert.throws(
    () =>
      run(
        db,
        `INSERT INTO group_statuses (id, group_id, text, author_id, author_name, created_at, expires_at)
         VALUES ('too_long', ?, ?, 'u_nadia', 'Nadia', ?, ?)`,
        GROUP,
        'x'.repeat(701),
        NOW,
        NOW + 1,
      ),
    /CHECK|constraint/i,
  );

  // deleting a group cascades to everything that belongs to it
  run(db, 'DELETE FROM groups WHERE id = ?', GROUP);
  assert.equal(get(db, 'SELECT COUNT(*) AS n FROM group_members WHERE group_id = ?', GROUP).n, 0);
  assert.equal(get(db, 'SELECT COUNT(*) AS n FROM group_settings WHERE group_id = ?', GROUP).n, 0);
  assert.equal(get(db, 'SELECT COUNT(*) AS n FROM messages WHERE chat_id = ?', 'chat_g_design').n, 0);
  db.close();
});

test('seeding twice does not duplicate rows', async () => {
  const db = await freshDb();
  const before = snapshotGroup(db, GROUP);
  await seed(db, { now: NOW });
  const after = snapshotGroup(db, GROUP);
  assert.equal(after.members.length, before.members.length);
  assert.equal(get(db, 'SELECT COUNT(*) AS n FROM messages').n, 21);
  db.close();
});

/* ---------------- state round trips ---------------- */

test('a group can be created from scratch through the repository', async () => {
  const db = await openMigrated(':memory:');
  createGroup(db, { id: 'g2', name: 'Backend Platform', ownerId: 'u_x', ownerName: 'X', now: NOW });
  addGroupMember(db, { groupId: 'g2', userId: 'u_y', name: 'Y', role: 'admin', now: NOW });

  const snap = snapshotGroup(db, 'g2');
  assert.equal(snap.group.name, 'Backend Platform');
  assert.equal(snap.members.length, 2);
  assert.equal(snap.members[0].role, 'owner', 'owner sorts first');
  assert.equal(get(db, 'SELECT id FROM chats WHERE group_id = ?', 'g2').id, 'chat_g2');
  db.close();
});

test('/lock persists and is visible to the next request', async () => {
  const db = await freshDb();
  command(db, ADMIN, '/lock maintenance');

  assert.equal(get(db, 'SELECT locked FROM group_settings WHERE group_id = ?', GROUP).locked, 1);

  // a *new* bot instance (i.e. a new HTTP request) sees the lock
  const bot = loadGroupBot(db, GROUP, { now: () => NOW });
  assert.equal(bot.state.group.locked, true);
  assert.equal(bot.receive({ authorId: MEMBER, text: 'hello' }).reason, 'group_locked');

  command(db, ADMIN, '/open');
  assert.equal(get(db, 'SELECT locked FROM group_settings WHERE group_id = ?', GROUP).locked, 0);
  db.close();
});

test('confirmations survive a restart, and so does undo', async () => {
  const db = await freshDb();

  const prompt = command(db, ADMIN, '/kick @Priya');
  assert.equal(prompt.kind, 'confirm');
  assert.equal(
    get(db, 'SELECT COUNT(*) AS n FROM pending_actions WHERE group_id = ?', GROUP).n,
    1,
    'the parked confirmation is in the database',
  );

  const done = command(db, ADMIN, '/confirm');
  assert.equal(done.ok, true);
  assert.equal(
    get(db, 'SELECT COUNT(*) AS n FROM group_members WHERE group_id = ? AND user_id = ?', GROUP, 'u_priya').n,
    0,
  );
  assert.equal(get(db, 'SELECT COUNT(*) AS n FROM pending_actions WHERE group_id = ?', GROUP).n, 0);

  // undo in a separate request restores the member with its original role
  const undone = command(db, ADMIN, '/undo');
  assert.equal(undone.ok, true);
  const restored = get(db, 'SELECT role FROM group_members WHERE group_id = ? AND user_id = ?', GROUP, 'u_priya');
  assert.equal(restored.role, 'member');
  db.close();
});

test('expired confirmations are not honoured', async () => {
  const db = await freshDb();
  command(db, ADMIN, '/kick @Priya');
  const late = NOW + 31_000;
  const res = command(db, ADMIN, '/confirm', late);
  assert.match(res.message, /expired/);
  assert.equal(
    get(db, 'SELECT COUNT(*) AS n FROM group_members WHERE user_id = ?', 'u_priya').n,
    1,
    'nothing was removed',
  );
  db.close();
});

test('warnings accumulate as rows and escalate to a mute', async () => {
  const db = await freshDb();
  command(db, ADMIN, '/warn @Tomás spam');
  command(db, ADMIN, '/warn @Tomás spam');
  command(db, ADMIN, '/warn @Tomás spam');

  assert.equal(get(db, 'SELECT COUNT(*) AS n FROM warnings WHERE user_id = ?', MEMBER).n, 3);
  const row = get(db, 'SELECT muted, muted_until FROM group_members WHERE group_id = ? AND user_id = ?', GROUP, MEMBER);
  assert.equal(row.muted, 1);

  // the warnings are reloaded into the bot, so /warns and the limit still work
  const bot = loadGroupBot(db, GROUP, { now: () => NOW });
  assert.equal(bot.state.members.get(MEMBER).warnings.length, 3);
  assert.equal(bot.receive({ authorId: MEMBER, text: 'hi' }).reason, 'muted');
  db.close();
});

test('timed mutes persist with their expiry', async () => {
  const db = await freshDb();
  command(db, ADMIN, '/mute @Tomás 10m');
  const row = get(db, 'SELECT muted, muted_until FROM group_members WHERE user_id = ?', MEMBER);
  assert.equal(row.muted, 1);
  assert.equal(row.muted_until, NOW + 600_000);

  // after the timer, the gate lets the member post again
  const later = NOW + 601_000;
  const bot = loadGroupBot(db, GROUP, { now: () => later });
  assert.equal(bot.receive({ authorId: MEMBER, text: 'hi' }).action, 'allow');
  db.close();
});

test('/add creates a user row and a membership row, welcome included', async () => {
  const db = await freshDb();
  const res = command(db, ADMIN, '/add +234 802 555 1212 Zainab');

  assert.equal(res.ok, true, res.message);
  const user = get(db, `SELECT id, name, phone FROM users WHERE name = 'Zainab'`);
  assert.ok(user, 'user row created');
  assert.equal(user.phone, '+234 802 555 1212');

  const membership = get(db, 'SELECT role FROM group_members WHERE group_id = ? AND user_id = ?', GROUP, user.id);
  assert.equal(membership.role, 'member');

  const welcome = res.effects.find((e) => e.type === 'welcome_message');
  assert.match(welcome.text, /Welcome Zainab/);
  db.close();
});

test('ban and unban are persisted flags', async () => {
  const db = await freshDb();
  command(db, ADMIN, '/ban @Tomás --yes');
  assert.equal(get(db, 'SELECT banned FROM group_members WHERE user_id = ?', MEMBER).banned, 1);
  assert.equal(loadGroupBot(db, GROUP, { now: () => NOW }).receive({ authorId: MEMBER, text: 'x' }).reason, 'banned');

  command(db, ADMIN, '/unban @Tomás');
  assert.equal(get(db, 'SELECT banned FROM group_members WHERE user_id = ?', MEMBER).banned, 0);
  db.close();
});

test('group status posts and clears hit the table', async () => {
  const db = await freshDb();
  const before = get(db, 'SELECT COUNT(*) AS n FROM group_statuses WHERE group_id = ?', GROUP).n;

  command(db, ADMIN, '/status "Critique at 5pm"');
  const rows = all(db, 'SELECT text, expires_at - created_at AS ttl FROM group_statuses WHERE group_id = ?', GROUP);
  assert.equal(rows.length, before + 1);
  assert.ok(rows.some((r) => r.text === 'Critique at 5pm' && r.ttl === 86_400_000));

  command(db, ADMIN, '/status clear');
  assert.equal(get(db, 'SELECT COUNT(*) AS n FROM group_statuses WHERE group_id = ?', GROUP).n, 0);
  db.close();
});

test('promote and rename persist, and undo reverts them', async () => {
  const db = await freshDb();
  command(db, ADMIN, '/promote @Tomás');
  assert.equal(get(db, 'SELECT role FROM group_members WHERE user_id = ?', MEMBER).role, 'admin');
  command(db, ADMIN, '/undo');
  assert.equal(get(db, 'SELECT role FROM group_members WHERE user_id = ?', MEMBER).role, 'member');

  command(db, 'u_nadia', '/rename Design Guild HQ');
  assert.equal(get(db, 'SELECT name FROM groups WHERE id = ?', GROUP).name, 'Design Guild HQ');
  assert.equal(get(db, 'SELECT name FROM chats WHERE group_id = ?', GROUP).name, 'Design Guild HQ');
  db.close();
});

test('invite reset bumps the epoch and mints a token', async () => {
  const db = await freshDb();
  const before = get(db, 'SELECT invite_epoch, invite_token FROM groups WHERE id = ?', GROUP);
  command(db, ADMIN, '/invite reset --yes');
  const after = get(db, 'SELECT invite_epoch, invite_token FROM groups WHERE id = ?', GROUP);
  assert.equal(after.invite_epoch, before.invite_epoch + 1);
  assert.ok(after.invite_token, 'a new invite token was generated in SQL');
  db.close();
});

test('purge soft-deletes the newest messages in that chat and unhooks them from search', async () => {
  const db = await freshDb();
  // note: an external-content FTS5 table returns the *content* rows on SELECT,
  // so index membership must be probed with MATCH, never with COUNT(*).
  assert.equal(fts5Candidates(db, 'nearest').sortIds.length, 1);

  command(db, 'u_nadia', '/purge 3 --yes');
  assert.equal(get(db, 'SELECT COUNT(*) AS n FROM messages WHERE deleted = 1').n, 3);
  assert.equal(
    get(db, "SELECT COUNT(*) AS n FROM messages m JOIN chats c ON c.id = m.chat_id WHERE m.deleted = 1 AND c.group_id = ?", GROUP).n,
    3,
    'purge only touches the group chat',
  );

  assert.equal(
    fts5Candidates(db, 'nearest').sortIds.length,
    0,
    'the update trigger removed the purged row from the index',
  );
  const index = buildIndex(loadSearchCorpus(db));
  assert.equal(search(index, { query: 'nearest', now: NOW }).total, 0);
  // messages outside the purged chat are untouched
  assert.equal(fts5Candidates(db, 'prescription').sortIds.length, 1);
  db.close();
});

test('denied commands are audited but change nothing', async () => {
  const db = await freshDb();
  const res = command(db, MEMBER, '/lock');
  assert.equal(res.ok, false);
  assert.equal(get(db, 'SELECT locked FROM group_settings WHERE group_id = ?', GROUP).locked, 0);

  const audit = loadAudit(db, GROUP, 5);
  assert.ok(audit.some((a) => a.command === 'lock' && a.ok === 0 && a.actorId === MEMBER));
  db.close();
});

test('settings round-trip through the loader', async () => {
  const db = await freshDb();
  command(db, ADMIN, '/slowmode 30s');
  command(db, ADMIN, '/antilink on');
  command(db, ADMIN, '/pin "Critique notes in the drive"');
  command(db, ADMIN, '/welcome "Hi {name}"');

  const bot = loadGroupBot(db, GROUP, { now: () => NOW });
  assert.equal(bot.state.group.slowSeconds, 30);
  assert.equal(bot.state.group.antiLink, true);
  assert.equal(bot.state.group.pinned.text, 'Critique notes in the drive');
  assert.equal(bot.state.group.welcome, 'Hi {name}');
  assert.equal(bot.state.group.inviteEpoch, 1);
  db.close();
});

/* ---------------- search over the database ---------------- */

test('the search corpus is built from the database', async () => {
  const db = await freshDb();
  const corpus = loadSearchCorpus(db);
  assert.equal(corpus.messages.length, 21);
  assert.ok(corpus.contacts.some((c) => c.name === 'Design Guild' && c.kind === 'group'));

  const index = buildIndex(corpus);
  const res = search(index, { query: 'sourd', now: NOW });
  assert.ok(res.total > 0);
  assert.match(res.items[0].doc.text, /sourdough/);

  // scoping to a chat works against real ids
  const scoped = search(index, { query: 'index', chatId: 'chat_g_design', now: NOW });
  assert.ok(scoped.items.every((i) => i.chat.id === 'chat_g_design'));
  db.close();
});

test('deleted messages disappear from search', async () => {
  const db = await freshDb();
  const index = buildIndex(loadSearchCorpus(db));
  assert.ok(search(index, { query: 'sourd', now: NOW }).total > 0);

  run(db, "UPDATE messages SET deleted = 1 WHERE chat_id = 'chat_b_bakery'");
  const afterIndex = buildIndex(loadSearchCorpus(db));
  const after = search(afterIndex, { query: 'sourd', now: NOW });
  assert.equal(after.items.filter((i) => i.chat?.id === 'chat_b_bakery').length, 0);
  db.close();
});

test('FTS5 and the in-memory engine agree on prefix hits', async () => {
  const db = await freshDb();
  const { sortIds, match } = fts5Candidates(db, 'sourd');
  assert.equal(match, '"sourd"*');
  assert.ok(sortIds.length > 0);

  const index = buildIndex(loadSearchCorpus(db));
  const engineHitIds = new Set(
    search(index, { query: 'sourd', now: NOW }).items.map((i) => i.doc.sortId),
  );
  for (const id of sortIds) {
    assert.ok(engineHitIds.has(id), `sort_id ${id} found by FTS5 must also be found by the engine`);
  }
  db.close();
});

test('rebuilding the index re-derives it from messages', async () => {
  const db = await freshDb();
  run(db, `INSERT INTO messages (id, chat_id, sender_id, text, timestamp) VALUES ('m_new', 'chat_g_design', 'u_wei', 'vector index tuning notes', ?)`, NOW);
  // the insert trigger indexed it already
  assert.equal(all(db, "SELECT rowid FROM message_fts WHERE message_fts MATCH 'vector'").length, 1);

  run(db, 'DELETE FROM message_fts');
  assert.equal(all(db, "SELECT rowid FROM message_fts WHERE message_fts MATCH 'vector'").length, 0);
  rebuildSearchIndex(db);
  assert.equal(all(db, "SELECT rowid FROM message_fts WHERE message_fts MATCH 'vector'").length, 1);
  db.close();
});

test('a group with no settings row still accepts settings effects', async () => {
  // Regression: every settings effect is an UPDATE, so a group whose
  // group_settings row is missing (imported data, interrupted migration)
  // used to report `settings.locked = 1` while changing nothing.
  const db = await freshDb();
  run(db, `DELETE FROM group_settings`);
  const bot = loadGroupBot(db, 'g_design');
  const result = bot.handle({ authorId: 'u_adebayo', text: '/lock maintenance' });
  const written = applyEffects(db, { groupId: 'g_design', actorId: 'u_adebayo', effects: result.effects, now: NOW });
  assert.deepEqual(written, ['settings.locked = 1']);
  assert.equal(snapshotGroup(db, 'g_design', { now: NOW }).group.locked, true);
  db.close();
});
