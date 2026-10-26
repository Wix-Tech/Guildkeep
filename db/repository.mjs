/**
 * repository.mjs — the adapter between the database and the two features.
 *
 *   database ──loadGroupBot()──► group-admin.mjs (pure logic)
 *            ◄──applyEffects()── effects[]
 *
 *   database ──loadSearchCorpus()──► buildIndex() (in-memory engine)
 *            ◄──fts5Candidates()───  (optional: let SQLite narrow the set first)
 *
 * Nothing in src/ knows this file exists, and nothing here knows SQL beyond the
 * statements it owns. That is the whole point: you can swap either side.
 */
import { all, get, run, transaction } from './db.mjs';
import { createGroupBot } from '../src/group-admin.mjs';

/* ------------------------------------------------------------------ */
/* Groups and members                                                  */
/* ------------------------------------------------------------------ */

export function createGroup(db, { id, name, ownerId, ownerName, ownerPhone, now = Date.now() }) {
  return transaction(db, () => {
    run(db, 'INSERT INTO groups (id, name, created_at) VALUES (?, ?, ?)', id, name, now);
    run(db, 'INSERT INTO group_settings (group_id, updated_at) VALUES (?, ?)', id, now);
    run(
      db,
      `INSERT INTO users (id, name, phone, kind) VALUES (?, ?, ?, 'person')
       ON CONFLICT (id) DO UPDATE SET name = excluded.name`,
      ownerId,
      ownerName,
      ownerPhone ?? null,
    );
    run(
      db,
      `INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)`,
      id,
      ownerId,
      now,
    );
    // every group needs a chat so messages have somewhere to live
    run(
      db,
      `INSERT INTO chats (id, kind, name, group_id, avatar_hue) VALUES (?, 'group', ?, ?, ?)`,
      `chat_${id}`,
      name,
      id,
      (id.length * 37) % 360,
    );
    return id;
  });
}

export function addGroupMember(db, { groupId, userId, name, phone, role = 'member', now = Date.now() }) {
  return transaction(db, () => {
    run(
      db,
      `INSERT INTO users (id, name, phone, kind) VALUES (?, ?, ?, 'person')
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, phone = COALESCE(excluded.phone, users.phone)`,
      userId,
      name,
      phone ?? null,
    );
    run(
      db,
      `INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (group_id, user_id) DO UPDATE SET role = excluded.role, banned = 0, muted = 0`,
      groupId,
      userId,
      role,
      now,
    );
  });
}

/**
 * Build a live bot instance for one group, straight from the database.
 * The bot is pure; everything it needs is loaded here.
 */
export function loadGroupBot(db, groupId, { now } = {}) {
  // `now` may be a number or a clock function (the bot takes a function).
  const clock = typeof now === 'function' ? now : () => now ?? Date.now();
  const nowMs = clock();
  const group = get(db, 'SELECT * FROM groups WHERE id = ?', groupId);
  if (!group) throw new Error(`unknown group: ${groupId}`);

  const settings = get(db, 'SELECT * FROM group_settings WHERE group_id = ?', groupId) ?? {};

  const rows = all(
    db,
    `SELECT m.user_id AS id, u.name, u.phone, m.role, m.muted, m.muted_until AS mutedUntil,
            m.banned, m.joined_at AS joinedAt, m.last_message_at AS lastMessageAt
       FROM group_members m
       JOIN users u ON u.id = m.user_id
      WHERE m.group_id = ?
      ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.name`,
    groupId,
  );

  const bot = createGroupBot({
    group: { id: group.id, name: group.name, createdAt: group.created_at },
    members: rows.map((r) => ({
      id: r.id,
      name: r.name,
      phone: r.phone,
      role: r.role,
      muted: !!r.muted,
      banned: !!r.banned,
    })),
    settings: {
      locked: !!settings.locked,
      announcement: !!settings.announcement,
      slowSeconds: settings.slow_seconds ?? 0,
      antiLink: !!settings.anti_link,
      welcome: settings.welcome ?? null,
      rules: settings.rules ?? null,
      warnLimit: settings.warn_limit ?? 3,
      warnAction: settings.warn_action ?? 'mute',
    },
    ...(now ? { now: clock } : {}),
  });

  // Restore the state createGroupBot does not take as input.
  bot.state.group.inviteEpoch = group.invite_epoch;
  bot.state.group.pinned = settings.pinned_text
    ? { text: settings.pinned_text, authorId: settings.pinned_by, at: settings.pinned_at }
    : null;
  bot.state.group.statuses = all(
    db,
    `SELECT id, text, author_id AS authorId, author_name AS authorName,
            created_at AS at, expires_at AS expiresAt
       FROM group_statuses WHERE group_id = ? ORDER BY created_at DESC`,
    groupId,
  );

  bot.restorePending(
    all(
      db,
      `SELECT actor_id AS actorId, command, args, flags, expires_at AS expiresAt
         FROM pending_actions WHERE group_id = ?`,
      groupId,
    ).map((r) => ({
      actorId: r.actorId,
      command: r.command,
      args: JSON.parse(r.args ?? '[]'),
      flags: JSON.parse(r.flags ?? '[]'),
      expiresAt: r.expiresAt,
    })),
  );

  // restore the undo stack so /undo survives a restart
  bot.state.undoStack = all(
    db,
    `SELECT actor_id AS actorId, kind, payload, created_at AS at
       FROM undo_stack WHERE group_id = ? ORDER BY id`,
    groupId,
  ).map((r) => ({ ...JSON.parse(r.payload), at: r.at, actor: r.actorId, kind: r.kind }));

  for (const row of rows) {
    const member = bot.state.members.get(row.id);
    if (!member) continue;
    member.mutedUntil = row.mutedUntil ?? null;
    member.joinedAt = row.joinedAt;
    member.lastMessageAt = row.lastMessageAt;
    member.warnings = all(
      db,
      'SELECT created_at AS at, created_by AS "by", reason FROM warnings WHERE group_id = ? AND user_id = ? ORDER BY created_at',
      groupId,
      row.id,
    );
  }

  return bot;
}

/* ------------------------------------------------------------------ */
/* Effects → SQL                                                       */
/* ------------------------------------------------------------------ */

const b = (v) => (v ? 1 : 0);

/**
 * Persist the `effects` a command returned. One transaction: either the whole
 * command lands or none of it does.
 *
 * @returns {string[]} a human-readable list of what was written
 */
export function applyEffects(db, { groupId, actorId, effects = [], now } = {}) {
  const nowMs = typeof now === 'function' ? now() : (now ?? Date.now());
  if (!effects.length) return [];
  now = nowMs;
  const written = [];

  transaction(db, () => {
    // A group can exist without a settings row (imported data, half-run
    // migrations, a hand-written INSERT). Every settings write below is an
    // UPDATE, so without this the adapter would report "settings.locked = 1"
    // while touching zero rows — a silent no-op. Create the row first.
    run(
      db,
      'INSERT INTO group_settings (group_id, updated_at) VALUES (?, ?) ON CONFLICT (group_id) DO NOTHING',
      groupId,
      now,
    );

    const touchSettings = () =>
      run(db, 'UPDATE group_settings SET updated_at = ? WHERE group_id = ?', now, groupId);

    const upsertMember = (member) => {
      if (!member?.id) return;
      run(
        db,
        `INSERT INTO users (id, name, phone, kind) VALUES (?, ?, ?, 'person')
         ON CONFLICT (id) DO UPDATE SET name = excluded.name,
           phone = COALESCE(excluded.phone, users.phone)`,
        member.id,
        member.name ?? member.id,
        member.phone ?? null,
      );
      run(
        db,
        `INSERT INTO group_members (group_id, user_id, role, muted, muted_until, banned, joined_at, last_message_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (group_id, user_id) DO UPDATE SET
           role = excluded.role, muted = excluded.muted, muted_until = excluded.muted_until,
           banned = excluded.banned`,
        groupId,
        member.id,
        member.role ?? 'member',
        b(member.muted),
        member.mutedUntil ?? null,
        b(member.banned),
        member.joinedAt ?? now,
        member.lastMessageAt ?? 0,
      );
    };

    for (const effect of effects) {
      switch (effect.type) {
        case 'group_locked':
          run(
            db,
            'UPDATE group_settings SET locked = ? WHERE group_id = ?',
            b(effect.value ?? true),
            groupId,
          );
          touchSettings();
          written.push(`settings.locked = ${b(effect.value ?? true)}`);
          break;

        case 'group_opened':
          run(db, 'UPDATE group_settings SET locked = 0, announcement = 0 WHERE group_id = ?', groupId);
          touchSettings();
          written.push('settings.locked = 0');
          break;

        case 'announcement_mode':
          run(
            db,
            'UPDATE group_settings SET announcement = ?, locked = CASE WHEN ? THEN 1 ELSE locked END WHERE group_id = ?',
            b(effect.enabled),
            b(effect.enabled),
            groupId,
          );
          touchSettings();
          written.push(`settings.announcement = ${b(effect.enabled)}`);
          break;

        case 'slow_mode':
          run(
            db,
            'UPDATE group_settings SET slow_seconds = ? WHERE group_id = ?',
            effect.seconds ?? 0,
            groupId,
          );
          touchSettings();
          written.push(`settings.slow_seconds = ${effect.seconds ?? 0}`);
          break;

        case 'anti_link':
          run(
            db,
            'UPDATE group_settings SET anti_link = ? WHERE group_id = ?',
            b(effect.enabled),
            groupId,
          );
          touchSettings();
          written.push(`settings.anti_link = ${b(effect.enabled)}`);
          break;

        case 'welcome_set':
          run(db, 'UPDATE group_settings SET welcome = ? WHERE group_id = ?', effect.text, groupId);
          touchSettings();
          written.push('settings.welcome updated');
          break;

        case 'group_renamed':
          run(db, 'UPDATE groups SET name = ? WHERE id = ?', effect.name, groupId);
          run(db, 'UPDATE chats SET name = ? WHERE group_id = ?', effect.name, groupId);
          written.push(`groups.name = ${effect.name}`);
          break;

        case 'group_pinned':
          run(
            db,
            'UPDATE group_settings SET pinned_text = ?, pinned_by = ?, pinned_at = ? WHERE group_id = ?',
            effect.text,
            actorId ?? null,
            now,
            groupId,
          );
          touchSettings();
          written.push('settings.pinned_text set');
          break;

        case 'group_unpinned':
          run(
            db,
            'UPDATE group_settings SET pinned_text = NULL, pinned_by = NULL, pinned_at = NULL WHERE group_id = ?',
            groupId,
          );
          touchSettings();
          written.push('settings.pinned_text cleared');
          break;

        case 'group_status_post':
          run(
            db,
            `INSERT INTO group_statuses (id, group_id, text, author_id, author_name, created_at, expires_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (id) DO UPDATE SET text = excluded.text, expires_at = excluded.expires_at`,
            effect.post.id,
            groupId,
            effect.post.text,
            effect.post.authorId,
            effect.post.authorName,
            effect.post.at,
            effect.post.expiresAt,
          );
          written.push(`group_statuses += ${effect.post.id}`);
          break;

        case 'group_statuses_cleared':
          run(db, 'DELETE FROM group_statuses WHERE group_id = ?', groupId);
          written.push('group_statuses cleared');
          break;

        case 'group_status_removed':
          run(db, 'DELETE FROM group_statuses WHERE id = ? AND group_id = ?', effect.statusId, groupId);
          written.push(`group_statuses -= ${effect.statusId}`);
          break;

        case 'member_added':
          upsertMember(effect.member);
          written.push(`group_members += ${effect.member.id}`);
          break;

        case 'member_removed':
          run(db, 'DELETE FROM group_members WHERE group_id = ? AND user_id = ?', groupId, effect.memberId);
          written.push(`group_members -= ${effect.memberId}`);
          break;

        case 'member_banned':
          run(db, 'UPDATE group_members SET banned = 1, muted = 1 WHERE group_id = ? AND user_id = ?', groupId, effect.memberId);
          written.push(`group_members.banned = 1 (${effect.memberId})`);
          break;

        case 'member_unbanned':
          run(db, 'UPDATE group_members SET banned = 0, muted = 0, muted_until = NULL WHERE group_id = ? AND user_id = ?', groupId, effect.memberId);
          written.push(`group_members.banned = 0 (${effect.memberId})`);
          break;

        case 'member_muted':
          run(
            db,
            'UPDATE group_members SET muted = 1, muted_until = ? WHERE group_id = ? AND user_id = ?',
            effect.until ?? null,
            groupId,
            effect.memberId,
          );
          written.push(`group_members.muted = 1 (${effect.memberId})`);
          break;

        case 'member_unmuted':
          run(
            db,
            'UPDATE group_members SET muted = 0, muted_until = NULL WHERE group_id = ? AND user_id = ?',
            groupId,
            effect.memberId,
          );
          written.push(`group_members.muted = 0 (${effect.memberId})`);
          break;

        case 'member_warned':
          run(
            db,
            'INSERT INTO warnings (group_id, user_id, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?)',
            groupId,
            effect.memberId,
            effect.reason ?? null,
            actorId ?? null,
            now,
          );
          written.push(`warnings += 1 (${effect.memberId}, #${effect.count})`);
          break;

        case 'member_promoted':
          run(db, "UPDATE group_members SET role = 'admin' WHERE group_id = ? AND user_id = ?", groupId, effect.memberId);
          written.push(`group_members.role = admin (${effect.memberId})`);
          break;

        case 'member_demoted':
          run(db, "UPDATE group_members SET role = 'member' WHERE group_id = ? AND user_id = ?", groupId, effect.memberId);
          written.push(`group_members.role = member (${effect.memberId})`);
          break;

        case 'member_role':
          run(db, 'UPDATE group_members SET role = ? WHERE group_id = ? AND user_id = ?', effect.role, groupId, effect.memberId);
          written.push(`group_members.role = ${effect.role} (${effect.memberId})`);
          break;

        case 'invite_rotated':
          run(
            db,
            'UPDATE groups SET invite_epoch = ?, invite_token = lower(hex(randomblob(8))) WHERE id = ?',
            effect.epoch,
            groupId,
          );
          written.push(`groups.invite_epoch = ${effect.epoch}`);
          break;

        case 'messages_purged': {
          const chat = get(db, 'SELECT id FROM chats WHERE group_id = ?', groupId);
          if (!chat) break;
          if (String(effect.amount).toLowerCase() === 'all') {
            run(db, 'UPDATE messages SET deleted = 1 WHERE chat_id = ? AND deleted = 0', chat.id);
          } else {
            run(
              db,
              `UPDATE messages SET deleted = 1
                WHERE sort_id IN (
                  SELECT sort_id FROM messages WHERE chat_id = ? AND deleted = 0
                  ORDER BY sort_id DESC LIMIT ?
                )`,
              chat.id,
              Number(effect.amount) || 0,
            );
          }
          written.push(`messages purged (${effect.amount})`);
          break;
        }

        // No persistence needed: these are outbound-message instructions.
        case 'mention_all':
        case 'welcome_message':
          break;

        default:
          written.push(`skipped unknown effect: ${effect.type}`);
      }
    }
  });

  return written;
}

/**
 * Mirror the bot's parked confirmations into the database (insert new ones,
 * drop the resolved/expired ones). Call after every handle().
 */
export function syncPendingActions(db, { groupId, bot, now } = {}) {
  const nowMs = typeof now === 'function' ? now() : (now ?? Date.now());
  now = nowMs;
  const live = bot.pendingActions().filter((p) => p.expiresAt > now);
  transaction(db, () => {
    run(db, 'DELETE FROM pending_actions WHERE group_id = ?', groupId);
    for (const p of live) {
      run(
        db,
        `INSERT INTO pending_actions (group_id, actor_id, command, args, flags, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        groupId,
        p.actorId,
        p.command,
        JSON.stringify(p.args ?? []),
        JSON.stringify(p.flags ?? []),
        now,
        p.expiresAt,
      );
    }
    run(db, 'DELETE FROM pending_actions WHERE expires_at <= ?', now);
  });
  return live.length;
}

/**
 * Mirror the bot's undo stack into the database after each command.
 * The stack is short (<= 50), so replacing it wholesale is simpler and safer
 * than trying to diff it.
 */
export function syncUndoStack(db, { groupId, bot, now } = {}) {
  const nowMs = typeof now === 'function' ? now() : (now ?? Date.now());
  const stack = bot.state.undoStack ?? [];
  transaction(db, () => {
    run(db, 'DELETE FROM undo_stack WHERE group_id = ?', groupId);
    for (const entry of stack) {
      const { at, actor, kind, ...payload } = entry;
      run(
        db,
        `INSERT INTO undo_stack (group_id, actor_id, kind, payload, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        groupId,
        actor ?? null,
        kind,
        JSON.stringify(payload),
        at ?? nowMs,
      );
    }
  });
  return stack.length;
}

/** Append to the audit log (done for both accepted and denied commands). */
export function recordAudit(
  db,
  { groupId, actorId = null, command, ok = true, targetId = null, detail = null, effects = [], now = Date.now() },
) {
  run(
    db,
    `INSERT INTO audit_log (group_id, actor_id, command, target_id, detail, ok, effects, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    groupId,
    actorId,
    command,
    targetId,
    detail,
    b(ok),
    effects.length ? JSON.stringify(effects) : null,
    now,
  );
}

export function loadAudit(db, groupId, limit = 20) {
  return all(
    db,
    `SELECT a.id, a.actor_id AS actorId, u.name AS actorName, a.command, a.target_id AS targetId,
            a.detail, a.ok, a.created_at AS at
       FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
      WHERE a.group_id = ? ORDER BY a.id DESC LIMIT ?`,
    groupId,
    limit,
  );
}

/** Everything the console/API needs in one call. */
export function snapshotGroup(db, groupId, { now = Date.now() } = {}) {
  const group = get(db, 'SELECT * FROM groups WHERE id = ?', groupId);
  if (!group) return null;
  const settings = get(db, 'SELECT * FROM group_settings WHERE group_id = ?', groupId) ?? {};
  const members = all(
    db,
    `SELECT m.user_id AS id, u.name, u.phone, m.role, m.muted, m.muted_until AS mutedUntil,
            m.banned, m.joined_at AS joinedAt,
            (SELECT COUNT(*) FROM warnings w WHERE w.group_id = m.group_id AND w.user_id = m.user_id) AS warnings
       FROM group_members m JOIN users u ON u.id = m.user_id
      WHERE m.group_id = ?
      ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.name`,
    groupId,
  );
  const statuses = all(
    db,
    `SELECT id, text, author_id AS authorId, author_name AS authorName, created_at AS at, expires_at AS expiresAt
       FROM group_statuses WHERE group_id = ? ORDER BY created_at DESC`,
    groupId,
  ).map((s) => ({ ...s, expired: now > s.expiresAt }));

  return {
    group: {
      id: group.id,
      name: group.name,
      createdAt: group.created_at,
      inviteEpoch: group.invite_epoch,
      inviteToken: group.invite_token,
      locked: !!settings.locked,
      announcement: !!settings.announcement,
      slowSeconds: settings.slow_seconds ?? 0,
      antiLink: !!settings.anti_link,
      welcome: settings.welcome ?? null,
      rules: settings.rules ?? null,
      warnLimit: settings.warn_limit ?? 3,
      warnAction: settings.warn_action ?? 'mute',
      pinned: settings.pinned_text
        ? { text: settings.pinned_text, authorId: settings.pinned_by, at: settings.pinned_at }
        : null,
      statuses,
    },
    members: members.map((m) => ({
      ...m,
      muted: !!m.muted && (!m.mutedUntil || now < m.mutedUntil),
      banned: !!m.banned,
    })),
    audit: loadAudit(db, groupId, 10),
  };
}

/* ------------------------------------------------------------------ */
/* Search corpus                                                       */
/* ------------------------------------------------------------------ */

/**
 * Shape the database into what the in-memory engine wants:
 * { chats, contacts, messages }.
 *
 * `contacts` includes people, groups and businesses because that is how the
 * engine classifies result sections (contacts / groups / business).
 */
export function loadSearchCorpus(db, { includeDeleted = false } = {}) {
  const chats = all(
    db,
    `SELECT id, kind, name, pinned, avatar_hue AS avatarHue FROM chats`,
  );

  const contacts = [
    ...all(
      db,
      `SELECT id, name, phone, about, kind, avatar_hue AS avatarHue, last_active_at AS lastActiveAt
         FROM users WHERE kind = 'person'`,
    ).map((u) => ({ ...u, tags: [] })),
    ...all(db, `SELECT id, name FROM groups`).map((g) => ({
      id: g.id,
      name: g.name,
      kind: 'group',
      phone: null,
      about: '',
      tags: [],
    })),
    ...all(
      db,
      `SELECT id, name, about FROM users WHERE kind = 'business'`,
    ).map((u) => ({ ...u, kind: 'business', tags: [] })),
  ];

  const messages = all(
    db,
    `SELECT m.id, m.chat_id AS chatId, m.sender_id AS senderId, m.text, m.timestamp,
            m.sort_id AS sortId
       FROM messages m
      WHERE ${includeDeleted ? '1' : 'm.deleted = 0'}`,
  );

  return { chats, contacts, messages };
}

/**
 * Optional: let SQLite's FTS5 index narrow the candidate set before the JS
 * engine ranks it. Prefixes on the last token, implicit AND — the same
 * expression the engine compiles, executed by the database instead.
 *
 * @returns {{ sortIds: number[], match: string }}
 */
export function fts5Candidates(db, query, { limit = 500 } = {}) {
  const tokens = String(query ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) return { sortIds: [], match: '' };

  // quote each token so FTS5 never sees a user-supplied operator
  const match = tokens
    .map((t, i) => (i === tokens.length - 1 ? `"${t}"*` : `"${t}"`))
    .join(' ');

  const rows = all(
    db,
    `SELECT rowid AS sortId FROM message_fts WHERE message_fts MATCH ? ORDER BY rowid DESC LIMIT ?`,
    match,
    limit,
  );
  return { sortIds: rows.map((r) => r.sortId), match };
}

/** Rebuild the FTS index from scratch (after a bulk import, or if it drifts). */
export function rebuildSearchIndex(db) {
  transaction(db, () => {
    run(db, `INSERT INTO message_fts (message_fts) VALUES ('rebuild')`);
  });
}

/**
 * Dialect-neutral name for the same operation. The PostgreSQL adapter exposes
 * `searchCandidates`; this alias keeps `repo.searchCandidates()` working
 * whichever database you opened. Returns `{ sortIds, match }` here and
 * `{ sortIds, tsquery }` on Postgres — read `sortIds`, treat the other key as
 * diagnostic.
 */
export const searchCandidates = fts5Candidates;

/** Escape hatch for one-off SQL: `raw(db)('SELECT 1 AS n')` -> [{ n: 1 }]. */
export const raw = (db) => (sql, params = []) => all(db, sql, ...params);
