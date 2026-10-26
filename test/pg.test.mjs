/**
 * pg.test.mjs — the PostgreSQL implementation, tested against real Postgres.
 *
 * Uses PGlite (Postgres compiled to WASM) so no server or Docker is needed.
 * It is a dev-only dependency:
 *
 *     npm --prefix product install --save-dev @electric-sql/pglite
 *
 * When it is not installed these tests skip with a message instead of failing,
 * because `node_modules` is not part of the repository.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';

import { openMigrated } from '../db/db.mjs';
import * as sqlite from '../db/repository.mjs';
import { seed as seedSqlite, NOW } from '../db/seed.mjs';
import { buildIndex, search } from '../src/search-engine.mjs';

let PGlite = null;
let pg = null;
try {
  ({ PGlite } = await import('@electric-sql/pglite'));
  pg = await import('../db/pg.mjs');
} catch {
  /* optional dev dependency */
}

const skip = PGlite ? false : 'install @electric-sql/pglite to run the Postgres tests';

/**
 * One PGlite instance for the whole file.
 *
 * A fresh WASM Postgres per test allocates a new ~100 MB heap each time and the
 * runner gets OOM-killed (this sandbox has 2 GB). So: migrate once, then reset
 * the data between tests with TRUNCATE.
 */
let shared = null;
async function freshPg() {
  if (!shared) {
    const client = await PGlite.create();
    shared = { client, repo: pg.createPgRepository(client) };
    await shared.repo.migrate();
  }
  await shared.repo.seed({ reset: true, now: NOW });
  return shared.repo;
}

after(async () => {
  if (shared) {
    await shared.client.close();
    shared = null;
  }
});

/** The same round trip admin-server.mjs performs, for the PG port. */
async function command(repo, actorId, text, now = NOW) {
  const bot = await repo.loadGroupBot('g_design', { now: () => now });
  const result = bot.handle({ authorId: actorId, text });
  const written = await repo.applyEffects({ groupId: 'g_design', actorId, effects: result.effects ?? [], now });
  await repo.syncPendingActions({ groupId: 'g_design', bot, now });
  await repo.syncUndoStack({ groupId: 'g_design', bot, now });
  await repo.recordAudit({
    groupId: 'g_design',
    actorId,
    command: result.command ?? text,
    ok: result.ok,
    effects: result.effects ?? [],
    now,
  });
  return { ...result, written };
}

/* ------------------------------------------------------------------ */

test('schema applies and seeds on Postgres', { skip }, async () => {
  const repo = await freshPg();
  const snap = await repo.snapshotGroup('g_design');
  assert.equal(snap.group.name, 'Design Guild');
  assert.equal(snap.members.length, 6);
  assert.equal(snap.members[0].role, 'owner');
  assert.equal(snap.group.statuses.length, 1);
});

test('schema invariants hold on Postgres too', { skip }, async () => {
  const repo = await freshPg();
  const db = repo.raw;

  // one owner per group (partial unique index)
  await assert.rejects(
    () =>
      db(`INSERT INTO group_members (group_id, user_id, role, joined_at)
          VALUES ('g_design', 'u_adebayo', 'owner', ${NOW})`),
    /one_owner_per_group|duplicate key/i,
  );

  // unique phone
  await assert.rejects(
    () => db(`INSERT INTO users (id, name, phone) VALUES ('dupe', 'Dupe', '+234 801 000 0001')`),
    /duplicate key|users_phone_key/i,
  );

  // status length limit enforced by the schema
  await assert.rejects(
    () =>
      db(
        `INSERT INTO group_statuses (id, group_id, text, author_id, author_name, created_at, expires_at)
         VALUES ('too_long', 'g_design', $1, 'u_nadia', 'Nadia', ${NOW}, ${NOW + 1})`,
        ['x'.repeat(701)],
      ),
    /violates check constraint/i,
  );
});

test('commands round-trip through Postgres', { skip }, async () => {
  const repo = await freshPg();

  await command(repo, 'u_adebayo', '/lock maintenance');
  assert.equal((await repo.snapshotGroup('g_design')).group.locked, true);

  const bot = await repo.loadGroupBot('g_design', { now: () => NOW });
  assert.equal(bot.receive({ authorId: 'u_tomas', text: 'hi' }).reason, 'group_locked');

  await command(repo, 'u_adebayo', '/open');
  assert.equal((await repo.snapshotGroup('g_design')).group.locked, false);
});

test('confirmations and undo survive across requests on Postgres', { skip }, async () => {
  const repo = await freshPg();

  const prompt = await command(repo, 'u_adebayo', '/kick @Priya');
  assert.equal(prompt.kind, 'confirm');
  const pending = await repo.raw('SELECT COUNT(*)::int AS n FROM pending_actions');
  assert.equal(pending[0].n, 1);

  const done = await command(repo, 'u_adebayo', '/confirm');
  assert.equal(done.ok, true);
  const gone = await repo.raw(
    `SELECT COUNT(*)::int AS n FROM group_members WHERE user_id = 'u_priya'`,
  );
  assert.equal(gone[0].n, 0);

  const undone = await command(repo, 'u_adebayo', '/undo');
  assert.equal(undone.ok, true);
  const back = await repo.raw(`SELECT role FROM group_members WHERE user_id = 'u_priya'`);
  assert.equal(back[0].role, 'member');
});

test('warnings, mutes and statuses land in the right tables', { skip }, async () => {
  const repo = await freshPg();
  await command(repo, 'u_adebayo', '/warn @Tomás spam');
  await command(repo, 'u_adebayo', '/warn @Tomás spam');
  await command(repo, 'u_adebayo', '/warn @Tomás spam');

  const warns = await repo.raw(`SELECT COUNT(*)::int AS n FROM warnings WHERE user_id = 'u_tomas'`);
  assert.equal(warns[0].n, 3);
  const muted = await repo.raw(`SELECT muted FROM group_members WHERE user_id = 'u_tomas'`);
  assert.equal(muted[0].muted, true);

  await command(repo, 'u_adebayo', '/status "Critique at 5pm"');
  const statuses = await repo.raw(`SELECT COUNT(*)::int AS n FROM group_statuses`);
  assert.ok(statuses[0].n >= 2);

  await command(repo, 'u_adebayo', '/status clear');
  const cleared = await repo.raw(`SELECT COUNT(*)::int AS n FROM group_statuses`);
  assert.equal(cleared[0].n, 0);
});

test('Postgres full-text search matches prefix and AND semantics', { skip }, async () => {
  const repo = await freshPg();

  const one = await repo.searchCandidates('sourd');
  assert.equal(one.tsquery, 'sourd:*');
  assert.equal(one.sortIds.length, 1);

  const two = await repo.searchCandidates('index rebuild');
  assert.equal(two.tsquery, 'index & rebuild:*');
  assert.ok(two.sortIds.length > 0);

  // a term with no hits returns nothing rather than erroring
  const none = await repo.searchCandidates('zzzznotaword');
  assert.equal(none.sortIds.length, 0);

  // punctuation and operators are neutralised, not executed
  const nasty = await repo.searchCandidates('sourd & | ! ( ) :*');
  assert.ok(!nasty.tsquery.includes('|'), 'operators are stripped from the tsquery');
});

test('deleted messages drop out of Postgres search', { skip }, async () => {
  const repo = await freshPg();
  assert.ok((await repo.searchCandidates('sourd')).sortIds.length > 0);
  await repo.raw(`UPDATE messages SET deleted = TRUE WHERE chat_id = 'chat_b_bakery'`);
  assert.equal((await repo.searchCandidates('sourd')).sortIds.length, 0);
});

test('purge soft-deletes only that group chat', { skip }, async () => {
  const repo = await freshPg();
  await command(repo, 'u_nadia', '/purge 3 --yes');
  const rows = await repo.raw(
    `SELECT m.id, c.group_id FROM messages m JOIN chats c ON c.id = m.chat_id WHERE m.deleted`,
  );
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => r.group_id === 'g_design'));
});

/* ------------------------------------------------------------------ */
/* Parity: the same commands must produce the same state on both.      */
/* ------------------------------------------------------------------ */

test('a group with no settings row still accepts settings effects', { skip }, async () => {
  const repo = await freshPg();
  await repo.raw('DELETE FROM group_settings');
  const bot = await repo.loadGroupBot('g_design', { now: () => NOW });
  const result = bot.handle({ authorId: 'u_adebayo', text: '/lock maintenance' });
  await repo.applyEffects({ groupId: 'g_design', actorId: 'u_adebayo', effects: result.effects, now: NOW });
  assert.equal((await repo.snapshotGroup('g_design', { now: NOW })).group.locked, true);
});

test('SQLite and Postgres agree on a command script', { skip }, async () => {
  const script = [
    ['u_adebayo', '/lock maintenance'],
    ['u_adebayo', '/slowmode 30s'],
    ['u_adebayo', '/antilink on'],
    ['u_adebayo', '/warn @Tomás spam'],
    ['u_adebayo', '/status "Critique at 5pm"'],
    ['u_adebayo', '/promote @Kofi'],
    ['u_adebayo', '/kick @Priya --yes'],
    ['u_adebayo', '/undo'],
    ['u_nadia', '/rename Design Guild HQ'],
    ['u_adebayo', '/open'],
  ];

  // --- SQLite -------------------------------------------------------
  const liteDb = await openMigrated(':memory:');
  await seedSqlite(liteDb, { now: NOW });
  for (const [actorId, text] of script) {
    const bot = sqlite.loadGroupBot(liteDb, 'g_design', { now: () => NOW });
    const result = bot.handle({ authorId: actorId, text });
    sqlite.applyEffects(liteDb, { groupId: 'g_design', actorId, effects: result.effects ?? [], now: NOW });
    sqlite.syncPendingActions(liteDb, { groupId: 'g_design', bot, now: NOW });
    sqlite.syncUndoStack(liteDb, { groupId: 'g_design', bot, now: NOW });
    sqlite.recordAudit(liteDb, { groupId: 'g_design', actorId, command: result.command ?? text, ok: result.ok, effects: result.effects ?? [], now: NOW });
  }
  const liteSnap = sqlite.snapshotGroup(liteDb, 'g_design', { now: NOW });

  // --- Postgres -----------------------------------------------------
  const repo = await freshPg();
  for (const [actorId, text] of script) await command(repo, actorId, text);
  const pgSnap = await repo.snapshotGroup('g_design', { now: NOW });

  // normalise: ids/timestamps differ, meaning must not
  const normalise = (snap) => ({
    name: snap.group.name,
    locked: snap.group.locked,
    slowSeconds: snap.group.slowSeconds,
    antiLink: snap.group.antiLink,
    inviteEpoch: snap.group.inviteEpoch,
    statuses: snap.group.statuses.map((s) => s.text).sort(),
    members: [...snap.members]
      .map((m) => `${m.name}:${m.role}:${m.muted ? 'muted' : ''}:${m.banned ? 'banned' : ''}:${m.warnings}`)
      .sort(),
  });

  assert.deepEqual(normalise(pgSnap), normalise(liteSnap));
});

test('both stores feed the same search engine the same corpus', { skip }, async () => {
  const liteDb = await openMigrated(':memory:');
  await seedSqlite(liteDb, { now: NOW });
  const repo = await freshPg();

  const liteCorpus = sqlite.loadSearchCorpus(liteDb);
  const pgCorpus = await repo.loadSearchCorpus();

  const shape = (c) => ({
    messages: c.messages.map((m) => `${m.id}|${m.chatId}|${m.senderId}`).sort(),
    chats: c.chats.map((x) => `${x.id}|${x.kind}|${x.name}`).sort(),
    contacts: c.contacts.map((x) => `${x.id}|${x.kind}|${x.name}`).sort(),
  });
  assert.deepEqual(shape(pgCorpus), shape(liteCorpus));

  const lite = search(buildIndex(liteCorpus), { query: 'sourd', now: NOW });
  const pgRes = search(buildIndex(pgCorpus), { query: 'sourd', now: NOW });
  assert.equal(pgRes.total, lite.total);
  assert.deepEqual(
    pgRes.items.map((i) => i.doc.text ?? i.doc.name).sort(),
    lite.items.map((i) => i.doc.text ?? i.doc.name).sort(),
  );
});
