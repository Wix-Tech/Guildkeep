#!/usr/bin/env node
/**
 * admin-server.mjs — HTTP surface for the group admin bot.
 *
 *   node product/db/migrate.mjs && node product/db/seed.mjs
 *   node product/admin-server.mjs          # http://0.0.0.0:8788
 *
 *   DATABASE_URL=postgres://user:pw@host/db node product/admin-server.mjs
 *
 * The storage engine is chosen by DATABASE_URL (see db/open.mjs):
 * unset -> SQLite at product/data/app.db, postgres://... -> PostgreSQL.
 * Nothing below this line knows which one it got.
 *
 * Every request is a full round trip through the database:
 *
 *   loadGroupBot(group)      →  bot.handle()  →  applyEffects()
 *                            →  syncPendingActions() + syncUndoStack() + audit
 *
 * That means a restart (or a second server instance) sees the same state, and
 * confirmation prompts and /undo keep working across requests.
 *
 *   curl -s localhost:8788/api/group
 *   curl -s -X POST localhost:8788/api/group/command -H 'content-type: application/json' \
 *        -d '{"actorId":"u_adebayo","text":"/lock maintenance"}'
 *   curl -s -X POST localhost:8788/api/group/message -H 'content-type: application/json' \
 *        -d '{"actorId":"u_tomas","text":"hello"}'
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize as normalizePath } from 'node:path';

import { openRepository } from './db/open.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8788);
const HOST = process.env.HOST ?? '0.0.0.0';
const GROUP = process.env.GROUP_ID ?? 'g_design';
const MAX_BODY = 16 * 1024;

const repo = await openRepository();

const json = (res, status, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
};

const readJson = (req) =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });

/** Shared handler for a command: load → handle → persist → audit. */
async function handleCommand({ actorId, text, mentions = [] }) {
  const bot = await repo.loadGroupBot(GROUP);
  const result = bot.handle({ authorId: actorId, text, mentions });

  const written = await repo.applyEffects({
    groupId: GROUP,
    actorId,
    effects: result.effects ?? [],
  });
  await repo.syncPendingActions({ groupId: GROUP, bot });
  await repo.syncUndoStack({ groupId: GROUP, bot });
  await repo.recordAudit({
    groupId: GROUP,
    actorId,
    command: result.command ?? text,
    ok: result.ok,
    detail: result.ok ? null : result.message,
    effects: result.effects ?? [],
  });

  return { ...result, written };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

  try {
    if (url.pathname === '/api/health') {
      return json(res, 200, { ok: true, engine: repo.kind, group: GROUP });
    }

    if (url.pathname === '/api/group' && req.method === 'GET') {
      const snap = await repo.snapshotGroup(GROUP);
      if (!snap) return json(res, 404, { error: `unknown group ${GROUP}` });
      return json(res, 200, snap);
    }

    if (url.pathname === '/api/group/command' && req.method === 'POST') {
      let body;
      try {
        body = await readJson(req);
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
      const { actorId, text, mentions } = body;
      if (!actorId || typeof text !== 'string') {
        return json(res, 422, { error: 'actorId and text are required' });
      }
      const result = await handleCommand({ actorId, text, mentions: mentions ?? [] });
      // `written` is what the database actually did — handy for debugging
      // adapters: it tells you which rows moved.
      return json(res, result.ok ? 200 : 403, {
        ...result,
        engine: repo.kind,
        group: (await repo.snapshotGroup(GROUP))?.group ?? null,
      });
    }

    if (url.pathname === '/api/group/message' && req.method === 'POST') {
      let body;
      try {
        body = await readJson(req);
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
      const { actorId, text = '' } = body;
      if (!actorId) return json(res, 422, { error: 'actorId is required' });

      const bot = await repo.loadGroupBot(GROUP);
      const verdict = bot.receive({ authorId: actorId, text });

      if (verdict.action === 'allow') {
        await repo.raw(
          'UPDATE group_members SET last_message_at = ? WHERE group_id = ? AND user_id = ?',
          [Date.now(), GROUP, actorId],
        );
      } else {
        await repo.recordAudit({
          groupId: GROUP,
          actorId,
          command: 'auto_moderation',
          ok: true,
          targetId: actorId,
          detail: verdict.reason,
        });
      }
      return json(res, verdict.action === 'allow' ? 200 : 202, verdict);
    }

    if (url.pathname === '/api/audit') {
      const limit = Number(url.searchParams.get('limit') ?? 20);
      return json(res, 200, { groupId: GROUP, audit: await repo.loadAudit(GROUP, limit) });
    }

    if (url.pathname === '/api/help') {
      const actorId = url.searchParams.get('actor') ?? 'u_tomas';
      const bot = await repo.loadGroupBot(GROUP);
      return json(res, 200, { actorId, help: bot.help(actorId) });
    }

    const rel = normalizePath(url.pathname === '/' ? 'admin-demo.html' : url.pathname.slice(1));
    const file = join(here, rel);
    if (!file.startsWith(here)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    const data = await readFile(file);
    res.writeHead(200, {
      'content-type': file.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream',
    });
    res.end(data);
  } catch (err) {
    if (err?.code === 'ENOENT') {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    console.error(err);
    if (!res.headersSent) json(res, 500, { error: err.message });
    else res.end();
  }
});

const snap = await repo.snapshotGroup(GROUP);

server.listen(PORT, HOST, () => {
  console.log(`admin bot on http://${HOST}:${PORT}`);
  console.log(
    `engine: ${repo.kind} · group: ${snap?.group.name ?? '(missing)'} · ${snap?.members.length ?? 0} members`,
  );
  if (!snap) console.log('run: npm --prefix product run db:reset');
});
