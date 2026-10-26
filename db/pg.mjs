/**
 * pg.mjs — the PostgreSQL implementation of the repository contract.
 *
 * Same functions, same shapes as db/repository.mjs; different dialect
 * ($1 placeholders, BOOLEAN, JSONB, tsvector). The bot never knows which one it
 * is talking to, because in both cases it only ever sees plain objects.
 *
 * Works with `pg` (node-postgres), `postgres.js` (via a thin adapter), or
 * PGlite — anything exposing:
 *
 *     client.query(sql, params) -> { rows }
 *
 * Production:
 *   import pg from 'pg';
 *   const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
 *   const repo = createPgRepository({ query: (sql, params) => pool.query(sql, params) });
 *
 * Tests (no server needed, real Postgres compiled to WASM):
 *   import { PGlite } from '@electric-sql/pglite';
 *   const db = await PGlite.create();
 *   const repo = createPgRepository(db);
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createGroupBot } from '../src/group-admin.mjs';
import { USERS, GROUP_MEMBERS, MESSAGES, NOW } from './seed.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const PG_SCHEMA = join(here, 'pg', 'schema.sql');

/** Build a safe tsquery: every token ANDed, prefix match on the last one. */
export function buildTsQuery(query) {
  const tokens = String(query ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) return '';
  return tokens.map((t, i) => (i === tokens.length - 1 ? `${t}:*` : t)).join(' & ');
}

export function createPgRepository(client) {
  /**
   * Run raw SQL with `?` placeholders (converted to $1..$n). Shared code can
   * be written against SQLite's syntax and still work here.
   */
  const rawSql = async (sql, params = []) => {
    let n = 0;
    const converted = String(sql).replace(/\?/g, () => `$${++n}`);
    return q(converted, params);
  };

  const q = async (sql, params = []) => {
    const res = await client.query(sql, params);
    return res?.rows ?? [];
  };
  const one = async (sql, params = []) => (await q(sql, params))[0] ?? null;

  /** Run fn inside a transaction (nested calls become savepoints). */
  let depth = 0;
  const transaction = async (fn) => {
    const savepoint = `sp_${depth}`;
    await q(depth === 0 ? 'BEGIN' : `SAVEPOINT ${savepoint}`);
    depth += 1;
    try {
      const out = await fn();
      await q(depth === 1 ? 'COMMIT' : `RELEASE SAVEPOINT ${savepoint}`);
      depth -= 1;
      return out;
    } catch (err) {
      try {
        await q(depth === 1 ? 'ROLLBACK' : `ROLLBACK TO SAVEPOINT ${savepoint}`);
      } catch {
        /* already gone */
      }
      depth -= 1;
      throw err;
    }
  };

  const clockOf = (now) => (typeof now === 'function' ? now : () => now ?? Date.now());

  /* ---------------- migrations ---------------- */

  async function migrate() {
    const sql = await readFile(PG_SCHEMA, 'utf8');
    // Multi-statement DDL: use exec() when available (PGlite), otherwise the
    // simple-query path of node-postgres (query without parameters).
    if (typeof client.exec === 'function') await client.exec(sql);
    else await q(sql);
    return ['pg/schema.sql'];
  }

  /* ---------------- groups and members ---------------- */

  async function createGroup({ id, name, ownerId, ownerName, ownerPhone, now = Date.now() }) {
    return transaction(async () => {
      await q('INSERT INTO groups (id, name, created_at) VALUES ($1, $2, $3)', [id, name, now]);
      await q('INSERT INTO group_settings (group_id, updated_at) VALUES ($1, $2)', [id, now]);
      await q(
        `INSERT INTO users (id, name, phone, kind) VALUES ($1, $2, $3, 'person')
         ON CONFLICT (id) DO UPDATE SET name = excluded.name`,
        [ownerId, ownerName, ownerPhone ?? null],
      );
      await q(
        `INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES ($1, $2, 'owner', $3)`,
        [id, ownerId, now],
      );
      await q(
        `INSERT INTO chats (id, kind, name, group_id, avatar_hue) VALUES ($1, 'group', $2, $3, $4)`,
        [`chat_${id}`, name, id, (id.length * 37) % 360],
      );
      return id;
    });
  }

  async function addGroupMember({ groupId, userId, name, phone, role = 'member', now = Date.now() }) {
    return transaction(async () => {
      await q(
        `INSERT INTO users (id, name, phone, kind) VALUES ($1, $2, $3, 'person')
         ON CONFLICT (id) DO UPDATE SET name = excluded.name, phone = COALESCE(excluded.phone, users.phone)`,
        [userId, name, phone ?? null],
      );
      await q(
        `INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (group_id, user_id) DO UPDATE SET role = excluded.role, banned = FALSE, muted = FALSE`,
        [groupId, userId, role, now],
      );
    });
  }

  async function loadGroupBot(groupId, { now } = {}) {
    const clock = clockOf(now);
    const nowMs = clock();

    const group = await one('SELECT * FROM groups WHERE id = $1', [groupId]);
    if (!group) throw new Error(`unknown group: ${groupId}`);
    const settings = (await one('SELECT * FROM group_settings WHERE group_id = $1', [groupId])) ?? {};

    const rows = await q(
      `SELECT m.user_id AS id, u.name, u.phone, m.role, m.muted,
              m.muted_until AS "mutedUntil", m.banned,
              m.joined_at AS "joinedAt", m.last_message_at AS "lastMessageAt"
         FROM group_members m JOIN users u ON u.id = m.user_id
        WHERE m.group_id = $1
        ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.name`,
      [groupId],
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
      now: clock,
    });

    bot.state.group.inviteEpoch = group.invite_epoch;
    bot.state.group.pinned = settings.pinned_text
      ? { text: settings.pinned_text, authorId: settings.pinned_by, at: settings.pinned_at }
      : null;
    bot.state.group.statuses = await q(
      `SELECT id, text, author_id AS "authorId", author_name AS "authorName",
              created_at AS at, expires_at AS "expiresAt"
         FROM group_statuses WHERE group_id = $1 ORDER BY created_at DESC`,
      [groupId],
    );

    bot.restorePending(
      (
        await q(
          `SELECT actor_id AS "actorId", command, args, flags, expires_at AS "expiresAt"
             FROM pending_actions WHERE group_id = $1`,
          [groupId],
        )
      ).map((r) => ({
        actorId: r.actorId,
        command: r.command,
        args: r.args ?? [],
        flags: r.flags ?? [],
        expiresAt: Number(r.expiresAt),
      })),
    );

    bot.state.undoStack = (
      await q(
        `SELECT actor_id AS "actorId", kind, payload, created_at AS at
           FROM undo_stack WHERE group_id = $1 ORDER BY id`,
        [groupId],
      )
    ).map((r) => ({ ...r.payload, at: Number(r.at), actor: r.actorId, kind: r.kind }));

    for (const row of rows) {
      const member = bot.state.members.get(row.id);
      if (!member) continue;
      member.mutedUntil = row.mutedUntil != null ? Number(row.mutedUntil) : null;
      member.joinedAt = Number(row.joinedAt);
      member.lastMessageAt = Number(row.lastMessageAt);
      member.warnings = await q(
        `SELECT created_at AS at, created_by AS "by", reason FROM warnings
          WHERE group_id = $1 AND user_id = $2 ORDER BY created_at`,
        [groupId, row.id],
      );
    }

    void nowMs;
    return bot;
  }

  /* ---------------- effects ---------------- */

  async function applyEffects({ groupId, actorId, effects = [], now } = {}) {
    const nowMs = clockOf(now)();
    if (!effects.length) return [];
    const written = [];

    await transaction(async () => {
      // Same guard as the SQLite adapter: settings effects are UPDATEs, so a
      // group without a settings row would otherwise change nothing while the
      // adapter reports success.
      await q(
        `INSERT INTO group_settings (group_id, updated_at) VALUES ($1, $2)
         ON CONFLICT (group_id) DO NOTHING`,
        [groupId, nowMs],
      );

      const touch = () =>
        q('UPDATE group_settings SET updated_at = $1 WHERE group_id = $2', [nowMs, groupId]);

      const upsertMember = async (member) => {
        if (!member?.id) return;
        await q(
          `INSERT INTO users (id, name, phone, kind) VALUES ($1, $2, $3, 'person')
           ON CONFLICT (id) DO UPDATE SET name = excluded.name,
             phone = COALESCE(excluded.phone, users.phone)`,
          [member.id, member.name ?? member.id, member.phone ?? null],
        );
        await q(
          `INSERT INTO group_members (group_id, user_id, role, muted, muted_until, banned, joined_at, last_message_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (group_id, user_id) DO UPDATE SET
             role = excluded.role, muted = excluded.muted,
             muted_until = excluded.muted_until, banned = excluded.banned`,
          [
            groupId,
            member.id,
            member.role ?? 'member',
            !!member.muted,
            member.mutedUntil ?? null,
            !!member.banned,
            member.joinedAt ?? nowMs,
            member.lastMessageAt ?? 0,
          ],
        );
      };

      for (const effect of effects) {
        switch (effect.type) {
          case 'group_locked':
            await q('UPDATE group_settings SET locked = $1 WHERE group_id = $2', [
              effect.value ?? true,
              groupId,
            ]);
            await touch();
            written.push(`settings.locked = ${effect.value ?? true}`);
            break;

          case 'group_opened':
            await q('UPDATE group_settings SET locked = FALSE, announcement = FALSE WHERE group_id = $1', [groupId]);
            await touch();
            written.push('settings.locked = false');
            break;

          case 'announcement_mode':
            await q(
              `UPDATE group_settings SET announcement = $1,
                 locked = CASE WHEN $1 THEN TRUE ELSE locked END
               WHERE group_id = $2`,
              [!!effect.enabled, groupId],
            );
            await touch();
            written.push(`settings.announcement = ${!!effect.enabled}`);
            break;

          case 'slow_mode':
            await q('UPDATE group_settings SET slow_seconds = $1 WHERE group_id = $2', [
              effect.seconds ?? 0,
              groupId,
            ]);
            await touch();
            written.push(`settings.slow_seconds = ${effect.seconds ?? 0}`);
            break;

          case 'anti_link':
            await q('UPDATE group_settings SET anti_link = $1 WHERE group_id = $2', [
              !!effect.enabled,
              groupId,
            ]);
            await touch();
            written.push(`settings.anti_link = ${!!effect.enabled}`);
            break;

          case 'welcome_set':
            await q('UPDATE group_settings SET welcome = $1 WHERE group_id = $2', [effect.text, groupId]);
            await touch();
            written.push('settings.welcome updated');
            break;

          case 'group_renamed':
            await q('UPDATE groups SET name = $1 WHERE id = $2', [effect.name, groupId]);
            await q('UPDATE chats SET name = $1 WHERE group_id = $2', [effect.name, groupId]);
            written.push(`groups.name = ${effect.name}`);
            break;

          case 'group_pinned':
            await q(
              'UPDATE group_settings SET pinned_text = $1, pinned_by = $2, pinned_at = $3 WHERE group_id = $4',
              [effect.text, actorId ?? null, nowMs, groupId],
            );
            await touch();
            written.push('settings.pinned_text set');
            break;

          case 'group_unpinned':
            await q(
              'UPDATE group_settings SET pinned_text = NULL, pinned_by = NULL, pinned_at = NULL WHERE group_id = $1',
              [groupId],
            );
            await touch();
            written.push('settings.pinned_text cleared');
            break;

          case 'group_status_post':
            await q(
              `INSERT INTO group_statuses (id, group_id, text, author_id, author_name, created_at, expires_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               ON CONFLICT (id) DO UPDATE SET text = excluded.text, expires_at = excluded.expires_at`,
              [
                effect.post.id,
                groupId,
                effect.post.text,
                effect.post.authorId,
                effect.post.authorName,
                effect.post.at,
                effect.post.expiresAt,
              ],
            );
            written.push(`group_statuses += ${effect.post.id}`);
            break;

          case 'group_statuses_cleared':
            await q('DELETE FROM group_statuses WHERE group_id = $1', [groupId]);
            written.push('group_statuses cleared');
            break;

          case 'group_status_removed':
            await q('DELETE FROM group_statuses WHERE id = $1 AND group_id = $2', [
              effect.statusId,
              groupId,
            ]);
            written.push(`group_statuses -= ${effect.statusId}`);
            break;

          case 'member_added':
            await upsertMember(effect.member);
            written.push(`group_members += ${effect.member.id}`);
            break;

          case 'member_removed':
            await q('DELETE FROM group_members WHERE group_id = $1 AND user_id = $2', [
              groupId,
              effect.memberId,
            ]);
            written.push(`group_members -= ${effect.memberId}`);
            break;

          case 'member_banned':
            await q(
              'UPDATE group_members SET banned = TRUE, muted = TRUE WHERE group_id = $1 AND user_id = $2',
              [groupId, effect.memberId],
            );
            written.push(`group_members.banned = true (${effect.memberId})`);
            break;

          case 'member_unbanned':
            await q(
              'UPDATE group_members SET banned = FALSE, muted = FALSE, muted_until = NULL WHERE group_id = $1 AND user_id = $2',
              [groupId, effect.memberId],
            );
            written.push(`group_members.banned = false (${effect.memberId})`);
            break;

          case 'member_muted':
            await q(
              'UPDATE group_members SET muted = TRUE, muted_until = $1 WHERE group_id = $2 AND user_id = $3',
              [effect.until ?? null, groupId, effect.memberId],
            );
            written.push(`group_members.muted = true (${effect.memberId})`);
            break;

          case 'member_unmuted':
            await q(
              'UPDATE group_members SET muted = FALSE, muted_until = NULL WHERE group_id = $1 AND user_id = $2',
              [groupId, effect.memberId],
            );
            written.push(`group_members.muted = false (${effect.memberId})`);
            break;

          case 'member_warned':
            await q(
              `INSERT INTO warnings (group_id, user_id, reason, created_by, created_at)
               VALUES ($1, $2, $3, $4, $5)`,
              [groupId, effect.memberId, effect.reason ?? null, actorId ?? null, nowMs],
            );
            written.push(`warnings += 1 (${effect.memberId}, #${effect.count})`);
            break;

          case 'member_promoted':
            await q("UPDATE group_members SET role = 'admin' WHERE group_id = $1 AND user_id = $2", [
              groupId,
              effect.memberId,
            ]);
            written.push(`group_members.role = admin (${effect.memberId})`);
            break;

          case 'member_demoted':
            await q("UPDATE group_members SET role = 'member' WHERE group_id = $1 AND user_id = $2", [
              groupId,
              effect.memberId,
            ]);
            written.push(`group_members.role = member (${effect.memberId})`);
            break;

          case 'member_role':
            await q('UPDATE group_members SET role = $1 WHERE group_id = $2 AND user_id = $3', [
              effect.role,
              groupId,
              effect.memberId,
            ]);
            written.push(`group_members.role = ${effect.role} (${effect.memberId})`);
            break;

          case 'invite_rotated':
            await q(
              `UPDATE groups SET invite_epoch = $1, invite_token = encode(gen_random_bytes(8), 'hex')
               WHERE id = $2`,
              [effect.epoch, groupId],
            );
            written.push(`groups.invite_epoch = ${effect.epoch}`);
            break;

          case 'messages_purged': {
            const chat = await one('SELECT id FROM chats WHERE group_id = $1', [groupId]);
            if (!chat) break;
            if (String(effect.amount).toLowerCase() === 'all') {
              await q('UPDATE messages SET deleted = TRUE WHERE chat_id = $1 AND NOT deleted', [chat.id]);
            } else {
              await q(
                `UPDATE messages SET deleted = TRUE
                  WHERE sort_id IN (
                    SELECT sort_id FROM messages
                     WHERE chat_id = $1 AND NOT deleted
                     ORDER BY sort_id DESC LIMIT $2
                  )`,
                [chat.id, Number(effect.amount) || 0],
              );
            }
            written.push(`messages purged (${effect.amount})`);
            break;
          }

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

  async function syncPendingActions({ groupId, bot, now } = {}) {
    const nowMs = clockOf(now)();
    const live = bot.pendingActions().filter((p) => p.expiresAt > nowMs);
    await transaction(async () => {
      await q('DELETE FROM pending_actions WHERE group_id = $1', [groupId]);
      for (const p of live) {
        await q(
          `INSERT INTO pending_actions (group_id, actor_id, command, args, flags, created_at, expires_at)
           VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)`,
          [groupId, p.actorId, p.command, JSON.stringify(p.args ?? []), JSON.stringify(p.flags ?? []), nowMs, p.expiresAt],
        );
      }
      await q('DELETE FROM pending_actions WHERE expires_at <= $1', [nowMs]);
    });
    return live.length;
  }

  async function syncUndoStack({ groupId, bot, now } = {}) {
    const nowMs = clockOf(now)();
    const stack = bot.state.undoStack ?? [];
    await transaction(async () => {
      await q('DELETE FROM undo_stack WHERE group_id = $1', [groupId]);
      for (const entry of stack) {
        const { at, actor, kind, ...payload } = entry;
        await q(
          `INSERT INTO undo_stack (group_id, actor_id, kind, payload, created_at)
           VALUES ($1, $2, $3, $4::jsonb, $5)`,
          [groupId, actor ?? null, kind, JSON.stringify(payload), at ?? nowMs],
        );
      }
    });
    return stack.length;
  }

  async function recordAudit({
    groupId,
    actorId = null,
    command,
    ok = true,
    targetId = null,
    detail = null,
    effects = [],
    now,
  }) {
    const nowMs = clockOf(now)();
    await q(
      `INSERT INTO audit_log (group_id, actor_id, command, target_id, detail, ok, effects, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
      [
        groupId,
        actorId,
        command,
        targetId,
        detail,
        !!ok,
        effects.length ? JSON.stringify(effects) : null,
        nowMs,
      ],
    );
  }

  async function loadAudit(groupId, limit = 20) {
    return q(
      `SELECT a.id, a.actor_id AS "actorId", u.name AS "actorName", a.command,
              a.target_id AS "targetId", a.detail, a.ok, a.created_at AS at
         FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
        WHERE a.group_id = $1 ORDER BY a.id DESC LIMIT $2`,
      [groupId, limit],
    );
  }

  async function snapshotGroup(groupId, { now } = {}) {
    const nowMs = clockOf(now)();
    const group = await one('SELECT * FROM groups WHERE id = $1', [groupId]);
    if (!group) return null;
    const settings = (await one('SELECT * FROM group_settings WHERE group_id = $1', [groupId])) ?? {};

    const members = await q(
      `SELECT m.user_id AS id, u.name, u.phone, m.role, m.muted,
              m.muted_until AS "mutedUntil", m.banned, m.joined_at AS "joinedAt",
              (SELECT COUNT(*)::int FROM warnings w
                WHERE w.group_id = m.group_id AND w.user_id = m.user_id) AS warnings
         FROM group_members m JOIN users u ON u.id = m.user_id
        WHERE m.group_id = $1
        ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.name`,
      [groupId],
    );

    const statuses = (
      await q(
        `SELECT id, text, author_id AS "authorId", author_name AS "authorName",
                created_at AS at, expires_at AS "expiresAt"
           FROM group_statuses WHERE group_id = $1 ORDER BY created_at DESC`,
        [groupId],
      )
    ).map((s) => ({ ...s, at: Number(s.at), expiresAt: Number(s.expiresAt), expired: nowMs > Number(s.expiresAt) }));

    return {
      group: {
        id: group.id,
        name: group.name,
        createdAt: Number(group.created_at),
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
          ? { text: settings.pinned_text, authorId: settings.pinned_by, at: Number(settings.pinned_at) }
          : null,
        statuses,
      },
      members: members.map((m) => ({
        ...m,
        joinedAt: Number(m.joinedAt),
        muted: !!m.muted && (!m.mutedUntil || nowMs < Number(m.mutedUntil)),
        banned: !!m.banned,
      })),
      audit: await loadAudit(groupId, 10),
    };
  }

  /* ---------------- search ---------------- */

  async function loadSearchCorpus({ includeDeleted = false } = {}) {
    const chats = await q('SELECT id, kind, name, pinned, avatar_hue AS "avatarHue" FROM chats');

    const contacts = [
      ...(
        await q(
          `SELECT id, name, phone, about, kind, avatar_hue AS "avatarHue",
                  last_active_at AS "lastActiveAt"
             FROM users WHERE kind = 'person'`,
        )
      ).map((u) => ({ ...u, tags: [] })),
      ...(await q('SELECT id, name FROM groups')).map((g) => ({
        id: g.id,
        name: g.name,
        kind: 'group',
        phone: null,
        about: '',
        tags: [],
      })),
      ...(await q(`SELECT id, name, about FROM users WHERE kind = 'business'`)).map((u) => ({
        ...u,
        kind: 'business',
        tags: [],
      })),
    ];

    const messages = await q(
      `SELECT id, chat_id AS "chatId", sender_id AS "senderId", text, timestamp, sort_id AS "sortId"
         FROM messages ${includeDeleted ? '' : 'WHERE NOT deleted'}`,
    );

    return {
      chats: chats.map((c) => ({ ...c, pinned: !!c.pinned })),
      contacts,
      messages: messages.map((m) => ({ ...m, timestamp: Number(m.timestamp), sortId: Number(m.sortId) })),
    };
  }

  /**
   * Postgres full-text search — the counterpart of fts5Candidates().
   * Prefix match on the final token, AND between tokens, GIN-indexed.
   */
  async function searchCandidates(query, { limit = 500 } = {}) {
    const tsquery = buildTsQuery(query);
    if (!tsquery) return { sortIds: [], tsquery: '' };
    const rows = await q(
      `SELECT sort_id AS "sortId"
         FROM messages
        WHERE NOT deleted AND search_tsv @@ to_tsquery('simple', $1)
        ORDER BY sort_id DESC
        LIMIT $2`,
      [tsquery, limit],
    );
    return { sortIds: rows.map((r) => Number(r.sortId)), tsquery };
  }

  async function rebuildSearchIndex() {
    // generated column: nothing to rebuild. Reindex = rewrite the column.
    await q('UPDATE messages SET text = text');
    return { rebuilt: true };
  }

  /* ---------------- seed ---------------- */

  async function seed({ reset = false, now = NOW } = {}) {
    if (reset) {
      await transaction(async () => {
        await q(
          `TRUNCATE messages, chats, audit_log, group_statuses, warnings, group_members,
                    group_settings, groups, users, pending_actions, undo_stack RESTART IDENTITY CASCADE`,
        );
      });
    }

    await transaction(async () => {
      for (const [id, name, phone, kind, about, hue] of USERS) {
        await q(
          `INSERT INTO users (id, name, phone, kind, about, avatar_hue, last_active_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`,
          [id, name, phone, kind, about, hue, now - 3 * 86_400_000],
        );
      }

      const groupRow = await one('SELECT id FROM groups WHERE id = $1', ['g_design']);
      if (!groupRow) {
        await createGroup({
          id: 'g_design',
          name: 'Design Guild',
          ownerId: 'u_nadia',
          ownerName: 'Nadia Haddad',
          ownerPhone: '+234 801 000 0001',
          now,
        });
      }
      await q(`UPDATE chats SET pinned = TRUE, avatar_hue = 280, name = 'Design Guild' WHERE group_id = $1`, [
        'g_design',
      ]);

      for (const [id, name, kind, pinned, peer] of [
        ['chat_d_priya', 'Priya Nair', 'direct', false, 'u_priya'],
        ['chat_d_adebayo', 'Adebayo Okafor', 'direct', false, 'u_adebayo'],
        ['chat_d_tomas', 'Tomás Silva', 'direct', false, 'u_tomas'],
        ['chat_b_bakery', 'Naples Bakery', 'business', false, 'b_bakery'],
        ['chat_b_pharmacy', 'Ikoyi Pharmacy', 'business', false, 'b_pharmacy'],
      ]) {
        await q(
          `INSERT INTO chats (id, kind, name, pinned, peer_user_id, avatar_hue)
           VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
          [id, kind, name, pinned, peer, (id.length * 29) % 360],
        );
      }

      for (const [id, chatId, senderId, text, ago] of MESSAGES) {
        await q(
          `INSERT INTO messages (id, chat_id, sender_id, text, timestamp)
           VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
          [id, chatId, senderId, text, now - ago],
        );
      }

      for (const [userId, role] of GROUP_MEMBERS) {
        const user = USERS.find((u) => u[0] === userId);
        await addGroupMember({
          groupId: 'g_design',
          userId,
          name: user?.[1] ?? userId,
          phone: user?.[2] ?? null,
          role,
          now,
        });
      }

      await q(
        `UPDATE group_settings SET rules = $1, welcome = $2, warn_limit = 3, warn_action = 'mute', updated_at = $3
          WHERE group_id = $4`,
        [
          '1. Critique the work, not the person.\n2. No links without context.\n3. Thursday 4pm is critique time.',
          'Welcome {name} — say hi and check /rules.',
          now,
          'g_design',
        ],
      );

      await q(
        `INSERT INTO group_statuses (id, group_id, text, author_id, author_name, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`,
        [
          'status_seed_1',
          'g_design',
          'Critique moved to 5pm this Thursday.',
          'u_nadia',
          'Nadia Haddad',
          now - 2 * 3_600_000,
          now - 2 * 3_600_000 + 86_400_000,
        ],
      );
    });

    const count = async (sql) => Number((await one(sql))?.n ?? 0);
    return {
      users: await count('SELECT COUNT(*)::int AS n FROM users'),
      groups: await count('SELECT COUNT(*)::int AS n FROM groups'),
      members: await count('SELECT COUNT(*)::int AS n FROM group_members'),
      chats: await count('SELECT COUNT(*)::int AS n FROM chats'),
      messages: await count('SELECT COUNT(*)::int AS n FROM messages'),
    };
  }

  return {
    // lifecycle
    migrate,
    transaction,
    // groups
    createGroup,
    addGroupMember,
    loadGroupBot,
    applyEffects,
    syncPendingActions,
    syncUndoStack,
    recordAudit,
    loadAudit,
    snapshotGroup,
    // search
    loadSearchCorpus,
    searchCandidates,
    rebuildSearchIndex,
    // dev
    seed,
    /**
     * Escape hatch, same call shape as SQLite's `raw(sql, params)`:
     * `?` placeholders are rewritten to $1..$n so a query written once runs
     * on both engines. Avoid `?` inside string literals.
     */
    raw: rawSql,
  };
}
