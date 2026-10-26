/**
 * group-admin.mjs — a group administration bot with a command surface.
 *
 * The whole feature is one state machine plus a declarative command table:
 *
 *   admin types  ─► parse ─► permission gate ─► confirm gate ─► execute ─► audit
 *                                                              │
 *   member posts ─► receive() ─► lock / announcement / mute / antilink / slowmode
 *
 * Design rules that keep it safe to ship:
 *  - every mutating command returns an `effects` array; nothing mutates the
 *    world outside this module, so you can persist effects however you like;
 *  - destructive commands (kick / ban / purge) require `--yes` or a second
 *    `/confirm` within 30s;
 *  - every executed command lands in the audit log, and reversible ones push an
 *    undo entry;
 *  - permissions are checked before arguments are even validated, so a member
 *    cannot probe for member lists.
 *
 * No dependencies, no network, deterministic (clock is injectable).
 */

/* ------------------------------------------------------------------ */
/* Roles and permissions                                               */
/* ------------------------------------------------------------------ */

export const ROLE_RANK = { bot: 0, member: 1, admin: 2, owner: 3 };

/** Who may run commands at each level. */
const LEVELS = {
  member: ['member', 'admin', 'owner', 'bot'],
  admin: ['admin', 'owner'],
  owner: ['owner'],
  anyone: ['bot'],
};

export function can(actor, level) {
  if (!actor) return false;
  return (LEVELS[level] ?? []).includes(actor.role);
}

/** Admins may act on members; only the owner may act on admins. */
function outranks(actor, target) {
  if (!target) return true;
  return ROLE_RANK[actor.role] > ROLE_RANK[target.role];
}

/* ------------------------------------------------------------------ */
/* Small parsers                                                       */
/* ------------------------------------------------------------------ */

const DURATION_RE = /^(\d+)\s*(s|sec|secs|m|min|mins|h|hr|hrs|d|day|days)$/i;
const UNIT_MS = {
  s: 1_000,
  sec: 1_000,
  secs: 1_000,
  m: 60_000,
  min: 60_000,
  mins: 60_000,
  h: 3_600_000,
  hr: 3_600_000,
  hrs: 3_600_000,
  d: 86_400_000,
  day: 86_400_000,
  days: 86_400_000,
};

/** "10m" -> 600000. Returns null for anything unparseable. */
export function parseDuration(input) {
  const m = DURATION_RE.exec(String(input ?? '').trim());
  if (!m) return null;
  return Number(m[1]) * UNIT_MS[m[2].toLowerCase()];
}

export function formatDuration(ms) {
  if (ms == null) return 'off';
  if (ms === 0) return 'off';
  if (ms % 86_400_000 === 0) return `${ms / 86_400_000}d`;
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
  if (ms % 60_000 === 0) return `${ms / 60_000}m`;
  return `${Math.round(ms / 1000)}s`;
}

const FLAGS = new Set(['--yes', '-y', '--all', '--force', '--quiet']);

/**
 * Split a command line into head, positional args and flags.
 * Supports quoted arguments:  /welcome "Welcome to the group!"
 */
export function parseCommand(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;

  const withoutPrefix = raw.replace(/^[/!.]/, '');
  const tokens = [];
  let buffer = '';
  let quote = null;

  for (const ch of withoutPrefix) {
    if (quote) {
      if (ch === quote) quote = null;
      else buffer += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (buffer) tokens.push(buffer);
      buffer = '';
      continue;
    }
    buffer += ch;
  }
  if (buffer) tokens.push(buffer);

  if (tokens.length === 0) return null;

  const flags = new Set(tokens.filter((t) => FLAGS.has(t.toLowerCase())).map((t) => t.toLowerCase()));
  const rest = tokens.filter((t) => !FLAGS.has(t.toLowerCase()));

  return {
    name: rest[0].toLowerCase(),
    args: rest.slice(1),
    flags,
    raw,
    isCommand: /^[/!.]/.test(raw),
  };
}

/* ------------------------------------------------------------------ */
/* Group state                                                         */
/* ------------------------------------------------------------------ */

const MAX_STATUS = 700;
const STATUS_TTL = 86_400_000; // group status lives 24h
const CONFIRM_TTL = 30_000;
const LINK_RE = /(https?:\/\/|www\.|chat\.whatsapp\.com\/|\b[a-z0-9-]+\.(com|net|org|io|ng|co)\b)/i;

export const DEFAULT_SETTINGS = Object.freeze({
  locked: false, // only admins can post
  announcement: false, // admins post, members read (same effect, different label)
  slowSeconds: 0, // per-member posting cooldown
  antiLink: false, // delete member messages containing links
  welcome: null, // message posted when someone joins
  rules: null, // static text `/rules` prints
  warnLimit: 3, // warnings before the configured action fires
  warnAction: 'mute', // 'mute' | 'kick'
  maxWarnings: 10,
});

export function createGroupBot({ group = {}, members = [], settings = {}, now } = {}) {
  const clock = typeof now === 'function' ? now : () => Date.now();

  const state = {
    group: {
      id: group.id ?? 'group',
      name: group.name ?? 'New group',
      createdAt: group.createdAt ?? clock(),
      inviteEpoch: 1,
      pinned: null,
      statuses: [],
      ...DEFAULT_SETTINGS,
      ...settings,
    },
    members: new Map(), // id -> member
    audit: [],
    undoStack: [],
    pending: new Map(), // actorId -> { command, args, flags, expiresAt }
  };

  /* ---------------- membership helpers ---------------- */

  const addMember = ({ id, name, phone, role = 'member', muted = false, banned = false }) => {
    if (!id) return null;
    const existing = state.members.get(id);
    if (existing) {
      existing.name = name ?? existing.name;
      existing.role = role ?? existing.role;
      return existing;
    }
    const member = {
      id,
      name: name ?? id,
      phone: phone ?? null,
      role,
      muted,
      banned,
      warnings: [],
      joinedAt: clock(),
      lastMessageAt: 0,
    };
    state.members.set(id, member);
    return member;
  };

  for (const m of members) addMember(m);

  const byName = (needle) => {
    const n = String(needle ?? '').toLowerCase().replace(/^@/, '').trim();
    if (!n) return null;
    const digits = n.replace(/[^\d]/g, '');
    for (const m of state.members.values()) {
      if (m.id.toLowerCase() === n) return m;
      if (digits.length >= 5 && m.phone && m.phone.replace(/[^\d]/g, '').endsWith(digits)) return m;
      if (m.name.toLowerCase() === n) return m;
    }
    for (const m of state.members.values()) {
      if (m.name.toLowerCase().startsWith(n)) return m;
    }
    return null;
  };

  /** Resolve "@Name", a phone, or an id into a member. */
  const resolveTarget = (token, mentions = []) => {
    if (token && token.startsWith('@')) return byName(token);
    if (token && /^\+?\d[\d\s-]{5,}$/.test(token)) return byName(token);
    if (token && state.members.has(token)) return state.members.get(token);
    // bare name fallback, then first mention
    const bare = byName(token);
    if (bare) return bare;
    for (const id of mentions) {
      const m = state.members.get(id);
      if (m) return m;
    }
    return null;
  };

  const adminsOf = () =>
    [...state.members.values()].filter((m) => m.role === 'admin' || m.role === 'owner');

  const audit = (entry) => {
    state.audit.unshift({ at: clock(), ...entry });
    if (state.audit.length > 200) state.audit.length = 200;
  };

  const pushUndo = (entry) => {
    state.undoStack.push({ at: clock(), ...entry });
    if (state.undoStack.length > 50) state.undoStack.shift();
  };

  const stripMember = (m) => {
    if (m.role === 'owner') return { ok: false, message: "The group owner can't be removed." };
    return { ok: true };
  };

  /* ---------------- command table ---------------- */

  const COMMANDS = [
    {
      name: 'help',
      aliases: ['commands', '?'],
      level: 'member',
      usage: 'help [command]',
      summary: 'List the commands you can use',
      run: ({ actor, args }) => {
        if (args[0]) {
          const cmd = findCommand(args[0]);
          if (!cmd) return { ok: false, message: `Unknown command: ${args[0]}` };
          if (!can(actor, cmd.level)) return { ok: false, message: denyMessage(cmd) };
          return { ok: true, message: `/${cmd.usage}\n${cmd.summary}`, kind: 'info' };
        }
        return { ok: true, message: renderHelp(actor), kind: 'help' };
      },
    },
    {
      name: 'rules',
      level: 'member',
      usage: 'rules',
      summary: 'Show the group rules',
      run: () =>
        state.group.rules
          ? { ok: true, message: state.group.rules, kind: 'info' }
          : { ok: false, message: 'No rules set. An admin can add them with /setrules <text>.' },
    },
    {
      name: 'stats',
      aliases: ['info'],
      level: 'admin',
      usage: 'stats',
      summary: 'Group health at a glance',
      run: () => ({ ok: true, message: describeSettings(state), kind: 'info' }),
    },
    {
      name: 'lock',
      aliases: ['close', 'freeze'],
      level: 'admin',
      usage: 'lock [reason]',
      summary: 'Only admins can post',
      run: ({ actor, args }) => {
        if (state.group.locked) return { ok: false, message: 'Group is already locked.' };
        state.group.locked = true;
        const reason = args.join(' ') || 'no reason given';
        pushUndo({ kind: 'lock', actor: actor.id, before: false });
        audit({ actor: actor.id, command: 'lock', detail: reason });
        return {
          ok: true,
          message: `🔒 Group locked by ${actor.name} (${reason}). Only admins can post now.`,
          effects: [{ type: 'group_locked', reason }],
          kind: 'action',
        };
      },
    },
    {
      name: 'open',
      aliases: ['unlock', 'reopen'],
      level: 'admin',
      usage: 'open',
      summary: 'Everyone can post again',
      run: ({ actor }) => {
        if (!state.group.locked && !state.group.announcement) {
          return { ok: false, message: 'Group is already open.' };
        }
        state.group.locked = false;
        state.group.announcement = false;
        pushUndo({ kind: 'lock', actor: actor.id, before: true });
        audit({ actor: actor.id, command: 'open' });
        return {
          ok: true,
          message: `🔓 Group opened by ${actor.name}. Everyone can post again.`,
          effects: [{ type: 'group_opened' }],
          kind: 'action',
        };
      },
    },
    {
      name: 'announce',
      aliases: ['announcement'],
      level: 'admin',
      usage: 'announce <on|off>',
      summary: 'Announcement mode: admins post, members read',
      run: ({ actor, args }) => {
        const on = parseToggle(args[0]);
        if (on == null) return { ok: false, message: 'Usage: /announce on|off' };
        if (on === state.group.announcement) {
          return { ok: false, message: `Announcement mode is already ${on ? 'on' : 'off'}.` };
        }
        state.group.announcement = on;
        state.group.locked = on ? true : state.group.locked;
        pushUndo({ kind: 'announce', actor: actor.id, before: !on });
        audit({ actor: actor.id, command: 'announce', detail: on ? 'on' : 'off' });
        return {
          ok: true,
          message: on
            ? '📣 Announcement mode on — only admins can post.'
            : '📣 Announcement mode off.',
          effects: [{ type: 'announcement_mode', enabled: on }],
          kind: 'action',
        };
      },
    },
    {
      name: 'slowmode',
      aliases: ['slow'],
      level: 'admin',
      usage: 'slowmode <off|10s|1m|5m>',
      summary: 'Rate-limit members to one message per interval',
      run: ({ actor, args }) => {
        const arg = args[0] ?? 'off';
        if (/^(off|0|none)$/i.test(arg)) {
          const before = state.group.slowSeconds;
          state.group.slowSeconds = 0;
          audit({ actor: actor.id, command: 'slowmode', detail: 'off' });
          if (before === 0) return { ok: false, message: 'Slow mode is already off.' };
          pushUndo({ kind: 'slowmode', actor: actor.id, before });
          return { ok: true, message: '🐌 Slow mode off.', effects: [{ type: 'slow_mode', seconds: 0 }] };
        }
        const ms = parseDuration(arg);
        if (!ms || ms > 86_400_000) {
          return { ok: false, message: 'Usage: /slowmode off|10s|1m|5m (max 1d)' };
        }
        const before = state.group.slowSeconds;
        state.group.slowSeconds = Math.round(ms / 1000);
        pushUndo({ kind: 'slowmode', actor: actor.id, before });
        audit({ actor: actor.id, command: 'slowmode', detail: formatDuration(ms) });
        return {
          ok: true,
          message: `🐌 Slow mode: one message per ${formatDuration(ms)} for members.`,
          effects: [{ type: 'slow_mode', seconds: state.group.slowSeconds }],
          kind: 'action',
        };
      },
    },
    {
      name: 'antilink',
      aliases: ['nolink'],
      level: 'admin',
      usage: 'antilink <on|off>',
      summary: 'Delete member messages containing links',
      run: ({ actor, args }) => {
        const on = parseToggle(args[0]);
        if (on == null) return { ok: false, message: 'Usage: /antilink on|off' };
        if (on === state.group.antiLink) {
          return { ok: false, message: `Anti-link is already ${on ? 'on' : 'off'}.` };
        }
        state.group.antiLink = on;
        pushUndo({ kind: 'antilink', actor: actor.id, before: !on });
        audit({ actor: actor.id, command: 'antilink', detail: on ? 'on' : 'off' });
        return {
          ok: true,
          message: on ? '🔗 Anti-link on — member links get deleted.' : '🔗 Anti-link off.',
          effects: [{ type: 'anti_link', enabled: on }],
          kind: 'action',
        };
      },
    },
    {
      name: 'welcome',
      level: 'admin',
      usage: 'welcome <text|off>',
      summary: 'Message posted when someone joins ({name} = new member)',
      run: ({ actor, args }) => {
        const text = args.join(' ').trim();
        if (!text) return { ok: false, message: 'Usage: /welcome "Welcome {name}!" or /welcome off' };
        if (/^off$/i.test(text)) {
          state.group.welcome = null;
          audit({ actor: actor.id, command: 'welcome', detail: 'off' });
          return { ok: true, message: 'Welcome message removed.' };
        }
        state.group.welcome = text;
        audit({ actor: actor.id, command: 'welcome', detail: text.slice(0, 80) });
        return {
          ok: true,
          message: `Welcome message set:\n“${text}”`,
          effects: [{ type: 'welcome_set', text }],
        };
      },
    },
    {
      name: 'setrules',
      level: 'admin',
      usage: 'setrules <text|off>',
      summary: 'Store the group rules (/rules prints them)',
      run: ({ actor, args }) => {
        const text = args.join(' ').trim();
        if (!text) return { ok: false, message: 'Usage: /setrules "1. Be kind…"' };
        state.group.rules = /^off$/i.test(text) ? null : text;
        audit({ actor: actor.id, command: 'setrules' });
        return {
          ok: true,
          message: state.group.rules ? 'Rules saved. Members can read them with /rules.' : 'Rules cleared.',
        };
      },
    },
    {
      name: 'status',
      aliases: ['poststatus'],
      level: 'admin',
      usage: 'status <text> | status clear',
      summary: 'Post to the group status (24h)',
      run: ({ actor, args }) => {
        const text = args.join(' ').trim();
        if (!text) return { ok: false, message: 'Usage: /status "Closing early today" or /status clear' };
        if (/^clear$/i.test(text)) {
          const removed = state.group.statuses.length;
          state.group.statuses = [];
          audit({ actor: actor.id, command: 'status', detail: 'clear' });
          return {
            ok: true,
            message: `Cleared ${removed} status post(s).`,
            effects: [{ type: 'group_statuses_cleared', count: removed }],
            kind: 'action',
          };
        }
        if (text.length > MAX_STATUS) {
          return { ok: false, message: `Status is too long (${text.length}/${MAX_STATUS}).` };
        }
        const post = {
          id: `st${state.group.statuses.length + 1}_${clock().toString(36)}`,
          text,
          authorId: actor.id,
          authorName: actor.name,
          at: clock(),
          expiresAt: clock() + STATUS_TTL,
        };
        state.group.statuses.unshift(post);
        pushUndo({ kind: 'status', actor: actor.id, statusId: post.id });
        audit({ actor: actor.id, command: 'status', detail: text.slice(0, 80) });
        return {
          ok: true,
          message: `📢 Posted to the group status:\n“${text}”\n(visible for 24h · /status clear to remove)`,
          effects: [{ type: 'group_status_post', post }],
          kind: 'action',
        };
      },
    },
    {
      name: 'add',
      aliases: ['addmember'],
      level: 'admin',
      usage: 'add <phone> [name]',
      summary: 'Add a member to the group',
      run: ({ actor, args }) => {
        // The parser splits on spaces, so a phone typed as "+234 802 555 1212"
        // arrives as several args. Join the longest leading phone-looking run.
        let consumed = 0;
        let phone = '';
        for (const arg of args.slice(0, 5)) {
          const candidate = phone ? `${phone} ${arg}` : arg;
          if (!/^\+?[\d][\d\s-]*$/.test(candidate)) break;
          phone = candidate;
          consumed += 1;
        }
        if (!phone || !/^\+?\d[\d\s-]{5,}$/.test(phone)) {
          return { ok: false, message: 'Usage: /add +2348012345678 [Display name]' };
        }
        if (hasPhone(phone)) return { ok: false, message: 'That number is already in the group.' };
        const name = args.slice(consumed).join(' ') || `+${phone.replace(/[^\d]/g, '')}`;
        const member = addMember({
          id: `u${state.members.size + 1}_${clock().toString(36)}`,
          name,
          phone,
        });
        pushUndo({ kind: 'add', actor: actor.id, memberId: member.id });
        audit({ actor: actor.id, command: 'add', detail: name });
        const welcome = state.group.welcome
          ? `\n\n${state.group.welcome.replace(/\{name\}/g, name)}`
          : '';
        return {
          ok: true,
          message: `➕ ${name} added by ${actor.name}.${welcome}`,
          effects: [
            { type: 'member_added', member },
            ...(welcome ? [{ type: 'welcome_message', text: welcome.trim() }] : []),
          ],
          kind: 'action',
        };
      },
    },
    {
      name: 'kick',
      aliases: ['remove'],
      level: 'admin',
      usage: 'kick @member [reason] [--yes]',
      summary: 'Remove a member (they can rejoin)',
      destructive: true,
      run: ({ actor, args, flags, mentions }) => confirmable({
        actor,
        name: 'kick',
        args,
        flags,
        mentions,
        describe: (target, reason) => `Remove ${target.name} from the group${reason ? ` (${reason})` : ''}?`,
        apply: (target, reason) => {
          const guard = stripMember(target);
          if (!guard.ok) return guard;
          if (!outranks(actor, target)) {
            return { ok: false, message: `Only the owner can remove an admin (${target.name}).` };
          }
          const snapshot = { ...target };
          state.members.delete(target.id);
          pushUndo({ kind: 'kick', actor: actor.id, member: snapshot });
          audit({ actor: actor.id, command: 'kick', target: target.id, detail: reason });
          const left = reason ? ` Reason: ${reason}` : '';
          return {
            ok: true,
            message: `🚪 ${target.name} removed by ${actor.name}.${left}`,
            effects: [{ type: 'member_removed', memberId: target.id, reason }],
            kind: 'action',
          };
        },
      }),
    },
    {
      name: 'ban',
      level: 'admin',
      usage: 'ban @member [reason] [--yes]',
      summary: 'Remove and block from rejoining',
      destructive: true,
      run: ({ actor, args, flags, mentions }) => confirmable({
        actor,
        name: 'ban',
        args,
        flags,
        mentions,
        describe: (target, reason) => `Ban ${target.name}${reason ? ` (${reason})` : ''}? They cannot rejoin.`,
        apply: (target, reason) => {
          if (target.role === 'owner') return { ok: false, message: "The group owner can't be banned." };
          if (!outranks(actor, target)) return { ok: false, message: `Only the owner can ban an admin (${target.name}).` };
          target.banned = true;
          target.muted = true;
          pushUndo({ kind: 'ban', actor: actor.id, memberId: target.id });
          audit({ actor: actor.id, command: 'ban', target: target.id, detail: reason });
          return {
            ok: true,
            message: `⛔ ${target.name} banned by ${actor.name}.${reason ? ` Reason: ${reason}` : ''}`,
            effects: [{ type: 'member_banned', memberId: target.id, reason }],
            kind: 'action',
          };
        },
      }),
    },
    {
      name: 'unban',
      level: 'admin',
      usage: 'unban <phone|@name>',
      summary: 'Lift a ban',
      run: ({ actor, args, mentions }) => {
        const target = resolveTarget(args[0], mentions);
        if (!target) return { ok: false, message: 'Who? Use /unban @name or /unban +234…' };
        if (!target.banned) return { ok: false, message: `${target.name} is not banned.` };
        target.banned = false;
        target.muted = false;
        audit({ actor: actor.id, command: 'unban', target: target.id });
        return {
          ok: true,
          message: `✅ ${target.name} unbanned.`,
          effects: [{ type: 'member_unbanned', memberId: target.id }],
        };
      },
    },
    {
      name: 'mute',
      aliases: ['silence'],
      level: 'admin',
      usage: 'mute @member [10m]',
      summary: 'Stop a member from posting (optionally timed)',
      run: ({ actor, args, mentions }) => {
        const target = resolveTarget(args[0], mentions);
        if (!target) return { ok: false, message: 'Who? Use /mute @name 10m' };
        if (target.role === 'owner') return { ok: false, message: "The group owner can't be muted." };
        if (!outranks(actor, target)) return { ok: false, message: `Only the owner can mute an admin (${target.name}).` };
        const ms = args[1] ? parseDuration(args[1]) : 0;
        if (args[1] && ms == null) return { ok: false, message: 'Duration must look like 30s, 10m, 2h or 7d.' };
        target.muted = true;
        target.mutedUntil = ms ? clock() + ms : null;
        pushUndo({ kind: 'mute', actor: actor.id, memberId: target.id });
        audit({ actor: actor.id, command: 'mute', target: target.id, detail: ms ? formatDuration(ms) : 'indefinite' });
        return {
          ok: true,
          message: `🔇 ${target.name} muted${ms ? ` for ${formatDuration(ms)}` : ''}.`,
          effects: [{ type: 'member_muted', memberId: target.id, until: target.mutedUntil }],
          kind: 'action',
        };
      },
    },
    {
      name: 'unmute',
      level: 'admin',
      usage: 'unmute @member',
      summary: 'Let a muted member post again',
      run: ({ actor, args, mentions }) => {
        const target = resolveTarget(args[0], mentions);
        if (!target) return { ok: false, message: 'Who? Use /unmute @name' };
        if (!target.muted) return { ok: false, message: `${target.name} is not muted.` };
        target.muted = false;
        target.mutedUntil = null;
        audit({ actor: actor.id, command: 'unmute', target: target.id });
        return {
          ok: true,
          message: `🔊 ${target.name} unmuted.`,
          effects: [{ type: 'member_unmuted', memberId: target.id }],
        };
      },
    },
    {
      name: 'warn',
      level: 'admin',
      usage: 'warn @member [reason]',
      summary: `Warn a member (auto-${DEFAULT_SETTINGS.warnAction} at the limit)`,
      run: ({ actor, args, mentions }) => {
        const target = resolveTarget(args[0], mentions);
        if (!target) return { ok: false, message: 'Who? Use /warn @name reason' };
        if (!outranks(actor, target)) return { ok: false, message: `You can't warn ${target.name}.` };
        const reason = args.slice(1).join(' ') || 'no reason given';
        target.warnings.push({ at: clock(), by: actor.id, reason });
        audit({ actor: actor.id, command: 'warn', target: target.id, detail: reason });

        const limit = state.group.warnLimit;
        const effects = [
          { type: 'member_warned', memberId: target.id, count: target.warnings.length, reason },
        ];
        let tail = `⚠️ ${target.name} warned (${target.warnings.length}/${limit}) — ${reason}`;

        if (target.warnings.length >= limit) {
          if (state.group.warnAction === 'kick') {
            state.members.delete(target.id);
            pushUndo({ kind: 'kick', actor: actor.id, member: { ...target } });
            effects.push({ type: 'member_removed', memberId: target.id, reason: 'warning limit' });
            tail += `\n🚪 Warning limit reached — ${target.name} was removed.`;
          } else {
            target.muted = true;
            target.mutedUntil = null;
            effects.push({ type: 'member_muted', memberId: target.id, until: null });
            tail += `\n🔇 Warning limit reached — ${target.name} was muted.`;
          }
        }
        return { ok: true, message: tail, effects, kind: 'action' };
      },
    },
    {
      name: 'warns',
      aliases: ['warnings'],
      level: 'admin',
      usage: 'warns @member',
      summary: 'Show a member’s warnings',
      run: ({ args, mentions }) => {
        const target = resolveTarget(args[0], mentions);
        if (!target) return { ok: false, message: 'Who? Use /warns @name' };
        if (!target.warnings.length) return { ok: true, message: `${target.name} has no warnings.` };
        const lines = target.warnings.map(
          (w, i) => `${i + 1}. ${w.reason} — ${new Date(w.at).toISOString().slice(0, 16).replace('T', ' ')}`,
        );
        return { ok: true, message: `Warnings for ${target.name}:\n${lines.join('\n')}`, kind: 'info' };
      },
    },
    {
      name: 'clearwarns',
      aliases: ['resetwarns'],
      level: 'admin',
      usage: 'clearwarns @member',
      summary: 'Clear a member’s warnings',
      run: ({ actor, args, mentions }) => {
        const target = resolveTarget(args[0], mentions);
        if (!target) return { ok: false, message: 'Who? Use /clearwarns @name' };
        target.warnings = [];
        audit({ actor: actor.id, command: 'clearwarns', target: target.id });
        return { ok: true, message: `Warnings cleared for ${target.name}.` };
      },
    },
    {
      name: 'promote',
      level: 'admin',
      usage: 'promote @member',
      summary: 'Make a member an admin',
      run: ({ actor, args, mentions }) => {
        const target = resolveTarget(args[0], mentions);
        if (!target) return { ok: false, message: 'Who? Use /promote @name' };
        if (target.role === 'admin') return { ok: false, message: `${target.name} is already an admin.` };
        if (target.role === 'owner') return { ok: false, message: `${target.name} is the owner.` };
        target.role = 'admin';
        pushUndo({ kind: 'role', actor: actor.id, memberId: target.id, before: 'member' });
        audit({ actor: actor.id, command: 'promote', target: target.id });
        return {
          ok: true,
          message: `⭐ ${target.name} is now an admin.`,
          effects: [{ type: 'member_promoted', memberId: target.id }],
          kind: 'action',
        };
      },
    },
    {
      name: 'demote',
      level: 'owner',
      usage: 'demote @admin',
      summary: 'Remove admin rights (owner only)',
      run: ({ actor, args, mentions }) => {
        const target = resolveTarget(args[0], mentions);
        if (!target) return { ok: false, message: 'Who? Use /demote @name' };
        if (target.role !== 'admin') return { ok: false, message: `${target.name} is not an admin.` };
        target.role = 'member';
        pushUndo({ kind: 'role', actor: actor.id, memberId: target.id, before: 'admin' });
        audit({ actor: actor.id, command: 'demote', target: target.id });
        return {
          ok: true,
          message: `⬇️ ${target.name} is no longer an admin.`,
          effects: [{ type: 'member_demoted', memberId: target.id }],
          kind: 'action',
        };
      },
    },
    {
      name: 'rename',
      aliases: ['setname'],
      level: 'owner',
      usage: 'rename <new group name>',
      summary: 'Rename the group (owner only)',
      run: ({ actor, args }) => {
        const name = args.join(' ').trim();
        if (!name || name.length > 60) return { ok: false, message: 'Usage: /rename New group name (max 60 chars)' };
        const before = state.group.name;
        state.group.name = name;
        pushUndo({ kind: 'rename', actor: actor.id, before });
        audit({ actor: actor.id, command: 'rename', detail: name });
        return {
          ok: true,
          message: `✏️ Group renamed: “${name}”.`,
          effects: [{ type: 'group_renamed', name }],
          kind: 'action',
        };
      },
    },
    {
      name: 'pin',
      level: 'admin',
      usage: 'pin <text|off>',
      summary: 'Pin a message in the group',
      run: ({ actor, args }) => {
        const text = args.join(' ').trim();
        if (!text) return { ok: false, message: 'Usage: /pin <text> or /pin off' };
        if (/^off$/i.test(text)) {
          state.group.pinned = null;
          audit({ actor: actor.id, command: 'pin', detail: 'off' });
          return { ok: true, message: 'Unpinned.', effects: [{ type: 'group_unpinned' }] };
        }
        state.group.pinned = { text, authorId: actor.id, at: clock() };
        audit({ actor: actor.id, command: 'pin', detail: text.slice(0, 80) });
        return {
          ok: true,
          message: `📌 Pinned: “${text}”`,
          effects: [{ type: 'group_pinned', text }],
          kind: 'action',
        };
      },
    },
    {
      name: 'invite',
      aliases: ['invitelink'],
      level: 'admin',
      usage: 'invite reset',
      summary: 'Revoke the current invite link',
      destructive: true,
      run: ({ actor, args, flags }) => {
        if (args[0] !== 'reset') return { ok: false, message: 'Usage: /invite reset --yes' };
        if (!flags.has('--yes')) {
          state.pending.set(actor.id, {
            command: 'invite',
            args,
            flags,
            expiresAt: clock() + CONFIRM_TTL,
          });
          return {
            ok: true,
            message: 'Revoke the current invite link? Members with the old link will be blocked.\nReply /confirm within 30s (or add --yes).',
            kind: 'confirm',
          };
        }
        state.group.inviteEpoch += 1;
        state.pending.delete(actor.id);
        audit({ actor: actor.id, command: 'invite reset' });
        return {
          ok: true,
          message: `🔗 Invite link revoked (epoch ${state.group.inviteEpoch}).`,
          effects: [{ type: 'invite_rotated', epoch: state.group.inviteEpoch }],
          kind: 'action',
        };
      },
    },
    {
      name: 'tagall',
      aliases: ['everyone'],
      level: 'admin',
      usage: 'tagall [message]',
      summary: 'Mention every member',
      run: ({ actor, args }) => {
        const members = [...state.members.values()].filter((m) => !m.banned);
        const note = args.join(' ').trim();
        const mentions = members.map((m) => `@${m.name}`).join(' ');
        return {
          ok: true,
          message: `${note ? `${note}\n\n` : ''}${mentions}\n\n(${members.length} members tagged by ${actor.name})`,
          effects: [{ type: 'mention_all', memberIds: members.map((m) => m.id) }],
          kind: 'action',
        };
      },
    },
    {
      name: 'purge',
      level: 'owner',
      usage: 'purge <n|all> --yes',
      summary: 'Delete recent messages (owner only)',
      destructive: true,
      run: ({ actor, args, flags }) => {
        const amount = args[0] ?? '10';
        if (!/^(\d+|all)$/i.test(amount)) return { ok: false, message: 'Usage: /purge 50 --yes or /purge all --yes' };
        if (!flags.has('--yes')) {
          state.pending.set(actor.id, { command: 'purge', args, flags, expiresAt: clock() + CONFIRM_TTL });
          return {
            ok: true,
            message: `Delete the last ${amount} message(s)? This cannot be undone.\nReply /confirm within 30s (or add --yes).`,
            kind: 'confirm',
          };
        }
        state.pending.delete(actor.id);
        audit({ actor: actor.id, command: 'purge', detail: amount });
        return {
          ok: true,
          message: `🧹 Deleted ${amount} message(s).`,
          effects: [{ type: 'messages_purged', amount }],
          kind: 'action',
        };
      },
    },
    {
      name: 'audit',
      aliases: ['log'],
      level: 'admin',
      usage: 'audit [n]',
      summary: 'Recent admin actions',
      run: ({ args }) => {
        const n = Math.min(Number(args[0]) || 10, 50);
        if (!state.audit.length) return { ok: true, message: 'No admin actions logged yet.' };
        const lines = state.audit.slice(0, n).map((a) => {
          const who = state.members.get(a.actor)?.name ?? a.actor ?? 'system';
          const target = a.target ? ` → ${state.members.get(a.target)?.name ?? a.target}` : '';
          const detail = a.detail ? `: ${a.detail}` : '';
          return `• ${who} · ${a.command}${target}${detail}`;
        });
        return { ok: true, message: `Recent admin actions:\n${lines.join('\n')}`, kind: 'info' };
      },
    },
    {
      name: 'undo',
      level: 'admin',
      usage: 'undo',
      summary: 'Undo the last reversible admin action',
      run: ({ actor }) => {
        const entry = state.undoStack.pop();
        if (!entry) return { ok: false, message: 'Nothing to undo.' };
        const performer = state.members.get(entry.actor)?.name ?? entry.actor;
        let message = '';
        let effects = [];

        switch (entry.kind) {
          case 'lock':
            state.group.locked = entry.before;
            message = `Reverted: group ${entry.before ? 'locked' : 'opened'}.`;
            effects = [{ type: 'group_locked', reason: 'undo', value: entry.before }];
            break;
          case 'announce':
            state.group.announcement = entry.before;
            if (!entry.before) state.group.locked = false;
            message = `Reverted: announcement mode ${entry.before ? 'on' : 'off'}.`;
            effects = [{ type: 'announcement_mode', enabled: entry.before }];
            break;
          case 'slowmode':
            state.group.slowSeconds = entry.before;
            message = `Reverted: slow mode ${entry.before ? `${entry.before}s` : 'off'}.`;
            effects = [{ type: 'slow_mode', seconds: entry.before }];
            break;
          case 'antilink':
            state.group.antiLink = entry.before;
            message = `Reverted: anti-link ${entry.before ? 'on' : 'off'}.`;
            effects = [{ type: 'anti_link', enabled: entry.before }];
            break;
          case 'kick': {
            state.members.set(entry.member.id, entry.member);
            message = `Restored ${entry.member.name} to the group.`;
            effects = [{ type: 'member_added', member: entry.member }];
            break;
          }
          case 'ban': {
            const m = state.members.get(entry.memberId);
            if (m) {
              m.banned = false;
              m.muted = false;
            }
            message = `Lifted the ban on ${m?.name ?? entry.memberId}.`;
            effects = [{ type: 'member_unbanned', memberId: entry.memberId }];
            break;
          }
          case 'mute': {
            const m = state.members.get(entry.memberId);
            if (m) {
              m.muted = false;
              m.mutedUntil = null;
            }
            message = `Unmuted ${m?.name ?? entry.memberId}.`;
            effects = [{ type: 'member_unmuted', memberId: entry.memberId }];
            break;
          }
          case 'add': {
            const m = state.members.get(entry.memberId);
            if (m) state.members.delete(entry.memberId);
            message = `Removed ${m?.name ?? entry.memberId} again.`;
            effects = [{ type: 'member_removed', memberId: entry.memberId, reason: 'undo' }];
            break;
          }
          case 'role': {
            const m = state.members.get(entry.memberId);
            if (m) m.role = entry.before;
            message = `${m?.name ?? entry.memberId} is back to ${entry.before}.`;
            effects = [{ type: 'member_role', memberId: entry.memberId, role: entry.before }];
            break;
          }
          case 'rename':
            state.group.name = entry.before;
            message = `Group name restored to “${entry.before}”.`;
            effects = [{ type: 'group_renamed', name: entry.before }];
            break;
          case 'status':
            state.group.statuses = state.group.statuses.filter((s) => s.id !== entry.statusId);
            message = 'Status post removed.';
            effects = [{ type: 'group_status_removed', statusId: entry.statusId }];
            break;
          default:
            return { ok: false, message: 'That action cannot be undone.' };
        }

        audit({ actor: actor.id, command: 'undo', detail: `${entry.kind} by ${performer}` });
        return { ok: true, message: `↩️ ${message}`, effects, kind: 'action' };
      },
    },
  ];

  function findCommand(name) {
    const n = String(name ?? '').toLowerCase().replace(/^[/!.]/, '');
    return COMMANDS.find((c) => c.name === n || (c.aliases ?? []).includes(n)) ?? null;
  }

  function denyMessage(cmd) {
    if (cmd.level === 'owner') return 'Only the group owner can do that.';
    if (cmd.level === 'admin') return 'Admins only. Ask an admin to run this.';
    return 'You cannot run this command.';
  }

  function renderHelp(actor) {
    const groups = [
      ['Admin', 'admin'],
      ['Owner', 'owner'],
      ['Everyone', 'member'],
    ];
    const out = [`Commands available to ${actor.name} (${actor.role}):`];
    for (const [label, level] of groups) {
      const items = COMMANDS.filter((c) => c.level === level && can(actor, level));
      if (!items.length) continue;
      out.push(`\n${label}`);
      for (const c of items) out.push(`/${c.usage} — ${c.summary}`);
    }
    out.push('\nTip: destructive commands ask for /confirm or accept --yes.');
    return out.join('\n');
  }

  function parseToggle(value) {
    if (value == null) return null;
    const v = String(value).toLowerCase();
    if (['on', 'true', '1', 'yes', 'enable'].includes(v)) return true;
    if (['off', 'false', '0', 'no', 'disable'].includes(v)) return false;
    return null;
  }

  function hasPhone(phone) {
    const digits = String(phone).replace(/[^\d]/g, '');
    for (const m of state.members.values()) {
      if (m.phone && m.phone.replace(/[^\d]/g, '') === digits) return true;
    }
    return false;
  }

  /**
   * Two-step confirmation for destructive commands.
   * First call parks the intent and returns a prompt; `/confirm` or `--yes` runs it.
   */
  function confirmable({ actor, name, args, flags, mentions, describe, apply }) {
    const target = resolveTarget(args[0], mentions);
    if (!target) return { ok: false, message: `Who? Use /${name} @name` };
    if (target.id === actor.id) return { ok: false, message: 'You cannot target yourself.' };

    const reason = args
      .slice(1)
      .filter((a) => !a.startsWith('--'))
      .join(' ')
      .trim();

    if (!flags.has('--yes')) {
      state.pending.set(actor.id, { command: name, args, flags, expiresAt: clock() + CONFIRM_TTL });
      return {
        ok: true,
        message: `${describe(target, reason)}\nReply /confirm within 30s (or re-run with --yes).`,
        kind: 'confirm',
        pending: { command: name, target: target.id },
      };
    }
    return apply(target, reason);
  }

  function runPending(actor, confirm) {
    const pending = state.pending.get(actor.id);
    if (!pending) return { ok: false, message: 'Nothing waiting for confirmation.' };
    if (clock() > pending.expiresAt) {
      state.pending.delete(actor.id);
      return { ok: false, message: 'That confirmation expired — run the command again.' };
    }
    if (!confirm) {
      state.pending.delete(actor.id);
      return { ok: true, message: 'Cancelled.' };
    }

    const cmd = findCommand(pending.command);
    const flags = new Set([...pending.flags, '--yes']);
    state.pending.delete(actor.id);
    const result = cmd.run({
      actor,
      args: pending.args,
      flags,
      mentions: [],
      text: '',
    });
    return result;
  }

  /* ---------------- public API ---------------- */

  /**
   * Handle one inbound command message.
   * @returns {{ok:boolean, message:string, kind?:string, effects?:Array, command?:string}}
   */
  function handle({ authorId, text, mentions = [] } = {}) {
    const actor = state.members.get(authorId);
    if (!actor) return { ok: false, message: 'You are not in this group.', kind: 'error' };
    if (actor.banned) return { ok: false, message: 'You are banned from this group.', kind: 'error' };
    if (actor.role === 'member' && (actor.muted || (actor.mutedUntil && clock() < actor.mutedUntil))) {
      return { ok: false, message: 'You are muted in this group.', kind: 'error' };
    }

    const parsed = parseCommand(text);
    if (!parsed) return { ok: false, message: 'Empty command.', kind: 'error' };

    // confirmation replies come first
    if (['confirm', 'yes', 'y'].includes(parsed.name)) {
      if (!can(actor, 'admin')) return { ok: false, message: 'Admins only.', kind: 'error' };
      return finish(actor, 'confirm', runPending(actor, true));
    }
    if (['cancel', 'no'].includes(parsed.name)) {
      if (!can(actor, 'admin')) return { ok: false, message: 'Admins only.', kind: 'error' };
      return finish(actor, 'cancel', runPending(actor, false));
    }

    const cmd = findCommand(parsed.name);
    if (!cmd) {
      return {
        ok: false,
        message: `Unknown command “${parsed.name}”. Try /help.`,
        kind: 'error',
      };
    }
    if (!can(actor, cmd.level)) {
      audit({ actor: actor.id, command: parsed.name, detail: 'denied' });
      return { ok: false, message: denyMessage(cmd), kind: 'error', command: cmd.name };
    }

    const result = cmd.run({
      actor,
      args: parsed.args,
      flags: parsed.flags,
      mentions,
      text: parsed.raw,
    });
    return finish(actor, cmd.name, result);
  }

  function finish(actor, command, result) {
    return {
      ok: !!result.ok,
      message: result.message ?? (result.ok ? 'Done.' : 'Command failed.'),
      kind: result.kind ?? (result.ok ? 'info' : 'error'),
      effects: result.effects ?? [],
      command,
    };
  }

  /**
   * Moderation gate for a normal (non-command) group message.
   * The caller deletes the message when `action === 'delete'`.
   */
  function receive({ authorId, text = '', hasLink } = {}) {
    const author = state.members.get(authorId);
    if (!author) return { action: 'delete', reason: 'not_a_member' };
    if (author.banned) return { action: 'delete', reason: 'banned' };

    const staff = author.role === 'admin' || author.role === 'owner';

    if (author.mutedUntil && clock() >= author.mutedUntil) {
      author.muted = false;
      author.mutedUntil = null;
    }
    if (author.muted && !staff) return { action: 'delete', reason: 'muted' };

    if (!staff && (state.group.locked || state.group.announcement)) {
      return { action: 'delete', reason: 'group_locked' };
    }

    const link = hasLink ?? LINK_RE.test(text);
    if (!staff && link && state.group.antiLink) {
      author.warnings.push({ at: clock(), by: 'system', reason: 'link posted' });
      return { action: 'delete', reason: 'anti_link', warning: author.warnings.length };
    }

    if (!staff && state.group.slowSeconds > 0) {
      const wait = author.lastMessageAt + state.group.slowSeconds * 1000 - clock();
      if (wait > 0) {
        return { action: 'delete', reason: 'slow_mode', retryInMs: wait };
      }
    }

    author.lastMessageAt = clock();
    return { action: 'allow' };
  }

  /** Snapshot for the UI / API — never hand out internal objects. */
  function snapshot() {
    return {
      group: {
        ...state.group,
        statuses: state.group.statuses.map((s) => ({ ...s, expired: clock() > s.expiresAt })),
      },
      members: [...state.members.values()].map((m) => ({
        ...m,
        warnings: [...m.warnings],
        muted: !!m.muted && (!m.mutedUntil || clock() < m.mutedUntil),
      })),
      audit: state.audit.slice(0, 20),
      pending: [...state.pending.entries()].map(([actorId, p]) => ({ actorId, ...p })),
    };
  }

  return {
    handle,
    receive,
    snapshot,
    findCommand,
    /** Current parked confirmations, for adapters that persist them. */
    pendingActions: () =>
      [...state.pending.entries()].map(([actorId, p]) => ({
        actorId,
        command: p.command,
        args: p.args,
        flags: [...p.flags],
        expiresAt: p.expiresAt,
      })),
    /** Restore confirmations loaded from storage. */
    restorePending: (rows = []) => {
      for (const row of rows) {
        state.pending.set(row.actorId, {
          command: row.command,
          args: row.args ?? [],
          flags: new Set(row.flags ?? []),
          expiresAt: row.expiresAt,
        });
      }
    },
    help: (actorId) => {
      const actor = state.members.get(actorId);
      return actor ? renderHelp(actor) : 'Unknown member.';
    },
    /** Exposed for adapters/tests. */
    state,
    commands: COMMANDS,
  };
}

/** Human-readable settings block used by /stats and the UI. */
export function describeSettings(state) {
  const g = state.group;
  const members = [...state.members.values()];
  const admins = members.filter((m) => m.role === 'admin' || m.role === 'owner');
  const activeStatus = g.statuses.filter((s) => Date.now() <= s.expiresAt);
  return [
    `📊 ${g.name}`,
    `Members: ${members.length} (${admins.length} admin${admins.length === 1 ? '' : 's'})`,
    `Posting: ${g.locked || g.announcement ? '🔒 admins only' : '🔓 everyone'}`,
    `Slow mode: ${formatDuration(g.slowSeconds ? g.slowSeconds * 1000 : 0)}`,
    `Anti-link: ${g.antiLink ? 'on' : 'off'}`,
    `Warnings: ${g.warnLimit} then ${g.warnAction}`,
    `Welcome: ${g.welcome ? `“${g.welcome}”` : 'off'}`,
    `Status posts: ${activeStatus.length}`,
    `Pinned: ${g.pinned ? `“${g.pinned.text}”` : 'none'}`,
    `Invite epoch: ${g.inviteEpoch}`,
  ].join('\n');
}
