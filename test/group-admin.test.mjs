/**
 * group-admin.test.mjs — behaviour of the group admin bot.
 * Run: node --test product/test/*.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createGroupBot,
  parseCommand,
  parseDuration,
  formatDuration,
  can,
  ROLE_RANK,
} from '../src/group-admin.mjs';

const makeBot = (nowRef = { t: 1_700_000_000_000 }) => {
  const bot = createGroupBot({
    group: { id: 'g1', name: 'Design Guild' },
    members: [
      { id: 'owner', name: 'Nadia', role: 'owner', phone: '+2348000000001' },
      { id: 'admin1', name: 'Adebayo', role: 'admin', phone: '+2348000000002' },
      { id: 'member1', name: 'Tom', role: 'member', phone: '+2348000000003' },
      { id: 'member2', name: 'Priya', role: 'member', phone: '+2348000000004' },
    ],
    now: () => nowRef.t,
  });
  return { bot, nowRef };
};

const asOwner = (bot, text, extra = {}) => bot.handle({ authorId: 'owner', text, ...extra });
const asAdmin = (bot, text, extra = {}) => bot.handle({ authorId: 'admin1', text, ...extra });
const asMember = (bot, text, extra = {}) => bot.handle({ authorId: 'member1', text, ...extra });

/* ---------------- parsing ---------------- */

test('parseCommand handles prefix, flags and quoted args', () => {
  const p = parseCommand('/welcome "Welcome to the group!" --yes');
  assert.equal(p.name, 'welcome');
  assert.deepEqual(p.args, ['Welcome to the group!']);
  assert.ok(p.flags.has('--yes'));
});

test('parseCommand rejects empty input', () => {
  assert.equal(parseCommand('   '), null);
});

test('durations parse and round-trip', () => {
  assert.equal(parseDuration('10m'), 600_000);
  assert.equal(parseDuration('2h'), 7_200_000);
  assert.equal(parseDuration('7d'), 604_800_000);
  assert.equal(parseDuration('soon'), null);
  assert.equal(formatDuration(600_000), '10m');
  assert.equal(formatDuration(0), 'off');
});

test('role ranks order correctly', () => {
  assert.ok(ROLE_RANK.owner > ROLE_RANK.admin);
  assert.ok(ROLE_RANK.admin > ROLE_RANK.member);
  assert.equal(can({ role: 'member' }, 'admin'), false);
  assert.equal(can({ role: 'admin' }, 'admin'), true);
  assert.equal(can({ role: 'admin' }, 'owner'), false);
});

/* ---------------- permissions ---------------- */

test('members cannot run admin commands', () => {
  const { bot } = makeBot();
  const res = asMember(bot, '/lock');
  assert.equal(res.ok, false);
  assert.match(res.message, /Admins only/);
  assert.equal(bot.snapshot().group.locked, false);
});

test('only the owner can demote, rename and purge', () => {
  const { bot } = makeBot();
  assert.match(asAdmin(bot, '/demote @Priya').message, /owner/i);
  assert.match(asAdmin(bot, '/rename New Name').message, /owner/i);
  assert.match(asAdmin(bot, '/purge 5 --yes').message, /owner/i);
  assert.equal(asOwner(bot, '/rename Design Guild 2').ok, true);
  assert.equal(bot.snapshot().group.name, 'Design Guild 2');
});

test('unknown commands are rejected with a hint', () => {
  const { bot } = makeBot();
  const res = asAdmin(bot, '/banish @Tom');
  assert.equal(res.ok, false);
  assert.match(res.message, /Unknown command/);
});

/* ---------------- lock / open ---------------- */

test('lock blocks members from posting and open restores it', () => {
  const { bot } = makeBot();
  asAdmin(bot, '/lock spam wave');
  assert.equal(bot.snapshot().group.locked, true);

  assert.equal(bot.receive({ authorId: 'member1', text: 'hello' }).action, 'delete');
  assert.equal(bot.receive({ authorId: 'member1', text: 'hello' }).reason, 'group_locked');
  assert.equal(bot.receive({ authorId: 'admin1', text: 'notice' }).action, 'allow');

  asAdmin(bot, '/open');
  assert.equal(bot.receive({ authorId: 'member1', text: 'hello' }).action, 'allow');
});

test('lock is idempotent-safe and undo restores the previous state', () => {
  const { bot } = makeBot();
  asAdmin(bot, '/lock');
  assert.match(asAdmin(bot, '/lock').message, /already locked/);
  const undo = asAdmin(bot, '/undo');
  assert.equal(undo.ok, true);
  assert.equal(bot.snapshot().group.locked, false);
});

/* ---------------- membership ---------------- */

test('kick needs confirmation, then removes the member', () => {
  const { bot } = makeBot();
  const prompt = asAdmin(bot, '/kick @Tom');
  assert.equal(prompt.kind, 'confirm');
  assert.match(prompt.message, /Reply \/confirm/);
  assert.equal(bot.snapshot().members.some((m) => m.id === 'member1'), true);

  const done = asAdmin(bot, '/confirm');
  assert.equal(done.ok, true);
  assert.equal(bot.snapshot().members.some((m) => m.id === 'member1'), false);
  assert.ok(done.effects.some((e) => e.type === 'member_removed'));
});

test('kick with --yes runs immediately and undo restores the member', () => {
  const { bot } = makeBot();
  const res = asAdmin(bot, '/kick @Priya --yes');
  assert.equal(res.ok, true);
  assert.equal(bot.snapshot().members.some((m) => m.id === 'member2'), false);

  asAdmin(bot, '/undo');
  const restored = bot.snapshot().members.find((m) => m.id === 'member2');
  assert.ok(restored, 'member is back after undo');
  assert.equal(restored.role, 'member');
});

test('confirmation expires and can be cancelled', () => {
  const { bot, nowRef } = makeBot();
  asAdmin(bot, '/kick @Tom');
  nowRef.t += 31_000;
  assert.match(asAdmin(bot, '/confirm').message, /expired/);

  nowRef.t += 1;
  asAdmin(bot, '/kick @Tom');
  assert.equal(asAdmin(bot, '/cancel').ok, true);
  assert.equal(bot.snapshot().members.some((m) => m.id === 'member1'), true);
});

test('admins cannot kick admins, owner can', () => {
  const { bot } = makeBot();
  asAdmin(bot, '/promote @Tom');
  assert.match(asAdmin(bot, '/kick @Tom --yes').message, /Only the owner/);
  assert.equal(asOwner(bot, '/kick @Tom --yes').ok, true);

  // an admin can never remove themselves into a downgrade either
  assert.match(asAdmin(bot, '/kick @Adebayo --yes').message, /yourself/);
});

test('the owner can never be kicked or banned', () => {
  const { bot } = makeBot();
  assert.match(asAdmin(bot, '/ban @Nadia --yes').message, /owner/i);
  assert.equal(bot.snapshot().members.some((m) => m.id === 'owner'), true);
});

test('add validates the phone and prevents duplicates', () => {
  const { bot } = makeBot();
  assert.match(asAdmin(bot, '/add 12').message, /Usage/);
  assert.match(asAdmin(bot, '/add +2348000000003').message, /already in the group/);

  const res = asAdmin(bot, '/add +2348099999999 Chiamaka');
  assert.equal(res.ok, true);
  assert.ok(bot.snapshot().members.some((m) => m.name === 'Chiamaka'));
  assert.ok(res.effects.some((e) => e.type === 'member_added'));
});

test('add posts the welcome message when one is configured', () => {
  const { bot } = makeBot();
  asAdmin(bot, '/welcome "Welcome {name} to Design Guild!"');
  const res = asAdmin(bot, '/add +2348011112222 Kofi');
  const welcome = res.effects.find((e) => e.type === 'welcome_message');
  assert.ok(welcome);
  assert.match(welcome.text, /Welcome Kofi to Design Guild!/);
});

test('ban blocks rejoining and posting; unban lifts it', () => {
  const { bot } = makeBot();
  asAdmin(bot, '/ban @Tom --yes');
  assert.equal(bot.receive({ authorId: 'member1', text: 'hi' }).reason, 'banned');
  assert.match(asAdmin(bot, '/unban @Tom').message, /unbanned/);
  assert.equal(bot.receive({ authorId: 'member1', text: 'hi' }).action, 'allow');
});

/* ---------------- moderation ---------------- */

test('mute blocks posting until unmuted or the timer runs out', () => {
  const { bot, nowRef } = makeBot();
  asAdmin(bot, '/mute @Tom 10m');
  assert.equal(bot.receive({ authorId: 'member1', text: 'hi' }).reason, 'muted');

  nowRef.t += 10 * 60_000 + 1;
  assert.equal(bot.receive({ authorId: 'member1', text: 'hi' }).action, 'allow');
});

test('unmute restores posting immediately', () => {
  const { bot } = makeBot();
  asAdmin(bot, '/mute @Tom');
  assert.match(asAdmin(bot, '/unmute @Tom').message, /unmuted/);
  assert.equal(bot.receive({ authorId: 'member1', text: 'hi' }).action, 'allow');
});

test('anti-link deletes member links and warns, admins are exempt', () => {
  const { bot } = makeBot();
  asAdmin(bot, '/antilink on');
  const verdict = bot.receive({ authorId: 'member1', text: 'check https://spam.example' });
  assert.equal(verdict.action, 'delete');
  assert.equal(verdict.reason, 'anti_link');
  assert.equal(verdict.warning, 1);
  assert.equal(bot.receive({ authorId: 'admin1', text: 'https://ok.example' }).action, 'allow');
});

test('warnings escalate to a mute at the configured limit', () => {
  const { bot } = makeBot();
  asAdmin(bot, '/warn @Tom spam');
  asAdmin(bot, '/warn @Tom spam');
  const third = asAdmin(bot, '/warn @Tom spam');
  assert.ok(third.effects.some((e) => e.type === 'member_muted'));
  assert.equal(bot.receive({ authorId: 'member1', text: 'hi' }).reason, 'muted');
  assert.match(asAdmin(bot, '/warns @Tom').message, /spam/);
  asAdmin(bot, '/clearwarns @Tom');
  assert.match(asAdmin(bot, '/warns @Tom').message, /no warnings/);
});

test('slow mode rate-limits members but not admins', () => {
  const { bot, nowRef } = makeBot();
  asAdmin(bot, '/slowmode 30s');
  assert.equal(bot.receive({ authorId: 'member1', text: 'one' }).action, 'allow');
  const second = bot.receive({ authorId: 'member1', text: 'two' });
  assert.equal(second.reason, 'slow_mode');
  assert.ok(second.retryInMs > 0);

  nowRef.t += 31_000;
  assert.equal(bot.receive({ authorId: 'member1', text: 'three' }).action, 'allow');
  assert.equal(bot.receive({ authorId: 'admin1', text: 'a' }).action, 'allow');
  assert.equal(bot.receive({ authorId: 'admin1', text: 'b' }).action, 'allow');
});

test('announcement mode behaves like lock and can be undone', () => {
  const { bot } = makeBot();
  asAdmin(bot, '/announce on');
  const snap = bot.snapshot();
  assert.equal(snap.group.announcement, true);
  assert.equal(snap.group.locked, true);
  assert.equal(bot.receive({ authorId: 'member1', text: 'hi' }).reason, 'group_locked');

  asAdmin(bot, '/undo');
  const after = bot.snapshot();
  assert.equal(after.group.announcement, false);
  assert.equal(after.group.locked, false);
});

/* ---------------- status + extras ---------------- */

test('status posts are recorded with a 24h expiry and can be cleared', () => {
  const { bot, nowRef } = makeBot();
  const res = asAdmin(bot, '/status "Closing early today"');
  assert.equal(res.ok, true);
  const post = res.effects.find((e) => e.type === 'group_status_post').post;
  assert.equal(post.text, 'Closing early today');
  assert.equal(post.expiresAt - post.at, 86_400_000);

  const snap = bot.snapshot();
  assert.equal(snap.group.statuses.length, 1);
  assert.equal(snap.group.statuses[0].expired, false);

  nowRef.t += 86_400_001;
  assert.equal(bot.snapshot().group.statuses[0].expired, true);
  assert.match(asAdmin(bot, '/status clear').message, /Cleared 1/);
});

test('status rejects overlong text', () => {
  const { bot } = makeBot();
  const res = asAdmin(bot, `/status ${'x'.repeat(701)}`);
  assert.equal(res.ok, false);
  assert.match(res.message, /too long/);
});

test('promote/demote change roles with undo support', () => {
  const { bot } = makeBot();
  assert.equal(asAdmin(bot, '/promote @Tom').ok, true);
  assert.equal(bot.snapshot().members.find((m) => m.id === 'member1').role, 'admin');
  asAdmin(bot, '/undo');
  assert.equal(bot.snapshot().members.find((m) => m.id === 'member1').role, 'member');

  asOwner(bot, '/demote @Adebayo');
  assert.equal(bot.snapshot().members.find((m) => m.id === 'admin1').role, 'member');
});

test('invite reset rotates the epoch and needs confirmation', () => {
  const { bot } = makeBot();
  assert.equal(asAdmin(bot, '/invite reset').kind, 'confirm');
  assert.equal(asAdmin(bot, '/confirm').ok, true);
  assert.equal(bot.snapshot().group.inviteEpoch, 2);
});

test('audit log records who did what, and /help filters by role', () => {
  const { bot } = makeBot();
  asAdmin(bot, '/lock maintenance');
  const audit = asAdmin(bot, '/audit').message;
  assert.match(audit, /Adebayo/);
  assert.match(audit, /lock/);

  const memberHelp = asMember(bot, '/help').message;
  assert.doesNotMatch(memberHelp, /\/lock/, 'members do not see admin commands');
  const ownerHelp = asOwner(bot, '/help').message;
  assert.match(ownerHelp, /\/lock/);
  assert.match(ownerHelp, /\/demote/);
});

test('muted members cannot run member commands either', () => {
  const { bot } = makeBot();
  asAdmin(bot, '/mute @Tom');
  const res = asMember(bot, '/rules');
  assert.equal(res.ok, false);
  assert.match(res.message, /muted/);
});

test('settings block reports the current state', () => {
  const { bot } = makeBot();
  asAdmin(bot, '/lock');
  asAdmin(bot, '/slowmode 1m');
  asAdmin(bot, '/antilink on');
  const stats = asAdmin(bot, '/stats').message;
  assert.match(stats, /admins only/);
  assert.match(stats, /Slow mode: 1m/);
  assert.match(stats, /Anti-link: on/);
});
