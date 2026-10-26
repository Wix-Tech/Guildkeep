#!/usr/bin/env node
/**
 * demo.mjs — end-to-end walkthrough: command → effects → SQL rows.
 *
 *   node product/db/demo.mjs
 *
 * Starts from a throwaway in-memory database, so it never touches product/data.
 */
import { openMigrated } from './db.mjs';
import {
  loadGroupBot,
  applyEffects,
  recordAudit,
  snapshotGroup,
  loadSearchCorpus,
  fts5Candidates,
  syncPendingActions,
  syncUndoStack,
} from './repository.mjs';
import { seed, NOW } from './seed.mjs';
import { buildIndex, search } from '../src/search-engine.mjs';

const line = (label = '') => console.log(label ? `\n\x1b[2m── ${label} ──\x1b[0m` : '');

const db = await openMigrated(':memory:');
await seed(db, { now: NOW });

const GROUP = 'g_design';
const ADMIN = 'u_adebayo';
const MEMBER = 'u_tomas';

/**
 * One round trip: load state → run command → persist effects → audit.
 * This is the whole integration surface; your HTTP handler does exactly this.
 */
function runCommand({ actorId, text, now = NOW }) {
  const bot = loadGroupBot(db, GROUP, { now: () => now });
  const result = bot.handle({ authorId: actorId, text });
  const written = applyEffects(db, { groupId: GROUP, actorId, effects: result.effects, now });
  // confirmations are state too: park them in the database, not in memory
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

function showCommand(actor, text) {
  const res = runCommand({ actorId: actor, text });
  const who = snapshotGroup(db, GROUP).members.find((m) => m.id === actor)?.name ?? actor;
  console.log(`${who} → ${text}`);
  console.log(`  bot: ${res.message.split('\n')[0]}`);
  if (res.written.length) console.log(`  db : ${res.written.join(' · ')}`);
  return res;
}

line('before');
const before = snapshotGroup(db, GROUP);
console.log(`members=${before.members.length} locked=${before.group.locked} statuses=${before.group.statuses.length}`);

line('/lock by an admin');
showCommand(ADMIN, '/lock maintenance window');
console.log('  settings row:', db.prepare('SELECT locked, announcement, updated_at FROM group_settings WHERE group_id = ?').get(GROUP));

line('a member message while locked');
{
  const bot = loadGroupBot(db, GROUP, { now: () => NOW });
  console.log(' ', bot.receive({ authorId: MEMBER, text: 'hello everyone' }));
}

line('/open, then a member message again');
showCommand(ADMIN, '/open');
{
  const bot = loadGroupBot(db, GROUP, { now: () => NOW });
  console.log(' ', bot.receive({ authorId: MEMBER, text: 'hello everyone' }));
}

line('/status "Critique at 5pm"');
showCommand(ADMIN, '/status "Critique at 5pm"');
console.log(
  '  status rows:',
  db.prepare('SELECT text, author_name, expires_at - created_at AS ttl_ms FROM group_statuses ORDER BY created_at DESC').all().map((r) => ({ ...r })),
);

line('/warn ×3 → auto-mute');
for (let i = 1; i <= 3; i += 1) showCommand(ADMIN, `/warn @Tomás spam ${i}`);
console.log('  warnings in db:', db.prepare('SELECT COUNT(*) AS n FROM warnings WHERE user_id = ?').get(MEMBER).n);
console.log(
  '  member row   :',
  { ...db.prepare('SELECT user_id, muted, muted_until, banned FROM group_members WHERE group_id = ? AND user_id = ?').get(GROUP, MEMBER) },
);
console.log('  can post?    :', loadGroupBot(db, GROUP, { now: () => NOW }).receive({ authorId: MEMBER, text: 'hi' }));

line('/kick with confirmation, then /undo');
showCommand(ADMIN, '/kick @Priya');
showCommand(ADMIN, '/confirm');
console.log('  member rows:', db.prepare('SELECT COUNT(*) AS n FROM group_members WHERE group_id = ?').get(GROUP).n);
showCommand(ADMIN, '/undo');
console.log('  member rows:', db.prepare('SELECT COUNT(*) AS n FROM group_members WHERE group_id = ?').get(GROUP).n);

line('/add — creates a user row and a membership row');
showCommand(ADMIN, '/add +234 802 555 1212 Zainab');
console.log('  new user:', { ...db.prepare("SELECT id, name, phone FROM users WHERE name = 'Zainab'").get() });
console.log('  seats free? no — membership row:',
  { ...db.prepare("SELECT role, banned FROM group_members WHERE user_id = (SELECT id FROM users WHERE name='Zainab')").get() });

line('audit log (from the database)');
for (const a of snapshotGroup(db, GROUP).audit.slice(0, 8)) {
  console.log(`  ${a.actorName ?? a.actorId} · ${a.command}${a.detail ? ` · ${a.detail.slice(0, 40)}` : ''}`);
}

line('search over the same database');
const corpus = loadSearchCorpus(db);
console.log(`corpus: ${corpus.messages.length} messages, ${corpus.chats.length} chats, ${corpus.contacts.length} contacts`);
const index = buildIndex(corpus);

for (const q of ['sourd', 'index rebuild', 'from:Adebayo index', 'Tomas']) {
  const res = search(index, { query: q, now: NOW });
  console.log(
    `  "${q}" → ${res.total} hit(s); compiled="${res.ftsQuery}"` +
      (res.items[0] ? ` · top: ${res.items[0].doc.text?.slice(0, 48) ?? res.items[0].doc.name}` : ''),
  );
}

line('SQLite FTS5 parity check');
const { sortIds, match } = fts5Candidates(db, 'sourd');
console.log(`  FTS5 MATCH "${match}" → ${sortIds.length} rowid(s)`);
const ftsTitles = sortIds
  .map((id) => db.prepare('SELECT text FROM messages WHERE sort_id = ?').get(id).text)
  .map((t) => t.slice(0, 60));
console.log('  rows:', ftsTitles);

db.close();
console.log('\n\x1b[2mdone — the bot never touched SQL; the repository never parsed a command.\x1b[0m');
