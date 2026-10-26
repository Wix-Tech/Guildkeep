#!/usr/bin/env node
/**
 * server.mjs — the server half of the hybrid search.
 *
 *   node product/db/migrate.mjs && node product/db/seed.mjs
 *   node product/server.mjs                  # http://0.0.0.0:8787
 *
 *   DATABASE_URL=postgres://user:pw@host/db node product/server.mjs
 *
 * Storage is chosen by DATABASE_URL (see db/open.mjs); the routes are the same
 * on SQLite and PostgreSQL.
 *
 * Two search paths share one corpus:
 *
 *   GET /api/search   → in-memory index built from the database (full ranking,
 *                       fuzzy + semantic layers, staggered paging)
 *   GET /api/fts      → the storage-layer path: FTS5 MATCH on SQLite,
 *                       `tsvector @@ to_tsquery` on PostgreSQL. Use it to
 *                       slice a huge corpus before ranking.
 *
 * The index is rebuilt from SQL on demand: POST /api/reindex
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize as normalizePath } from 'node:path';

import { openRepository } from './db/open.mjs';
import { buildIndex, search } from './src/search-engine.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '0.0.0.0';

const repo = await openRepository();

let index = { docs: [] };
let corpus = { messages: [], chats: [], contacts: [] };
let builtAt = Date.now();

/** Build the in-memory index from whatever store DATABASE_URL points at. */
async function reindex() {
  corpus = await repo.loadSearchCorpus();
  index = buildIndex(corpus);
  builtAt = Date.now();
  return { documents: index.docs.length, builtAt };
}

await reindex();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const bool = (v, fallback = true) =>
  v === null || v === undefined || v === '' ? fallback : v !== 'false' && v !== '0';

const json = (res, status, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

  try {
    return await route(url, req, res);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) json(res, 500, { error: err.message, engine: repo.kind });
    else res.end();
  }
});

async function route(url, req, res) {
  if (url.pathname === '/api/health') {
    // `WHERE NOT deleted` is the one spelling both engines accept
    // (SQLite stores 0/1, PostgreSQL stores a real boolean).
    const [{ n: messages }] = await repo.raw('SELECT COUNT(*) AS n FROM messages WHERE NOT deleted');
    const [{ n: chats }] = await repo.raw('SELECT COUNT(*) AS n FROM chats');
    return json(res, 200, {
      ok: true,
      engine: repo.kind,
      documents: index.docs.length,
      messages: Number(messages),
      chats: Number(chats),
      indexedAt: new Date(builtAt).toISOString(),
    });
  }

  if (url.pathname === '/api/search') {
    const result = search(index, {
      query: url.searchParams.get('q') ?? '',
      page: Number(url.searchParams.get('page') ?? 0),
      pageSize: Number(url.searchParams.get('pageSize') ?? 20),
      chatId: url.searchParams.get('chat') || null,
      filters: {
        messages: bool(url.searchParams.get('messages')),
        contacts: bool(url.searchParams.get('contacts')),
        groups: bool(url.searchParams.get('groups')),
        business: bool(url.searchParams.get('business')),
      },
    });
    return json(res, 200, {
      ...result,
      items: result.items.map((item) => ({
        id: item.id,
        section: item.section,
        matchKind: item.matchKind,
        score: Number(item.score.toFixed(4)),
        doc: item.doc,
        chat: item.chat ? { id: item.chat.id, name: item.chat.name, kind: item.chat.kind } : null,
      })),
    });
  }

  if (url.pathname === '/api/fts') {
    const q = url.searchParams.get('q') ?? '';
    const { sortIds, match, tsquery } = await repo.searchCandidates(q);
    const rows = [];
    for (const id of sortIds) {
      // Double-quoted aliases: PostgreSQL folds unquoted names to lowercase,
      // SQLite keeps them as written. Quoting gives both the same JSON keys.
      const [row] = await repo.raw(
        `SELECT m.id, m.sort_id AS "sortId", m.text, m.chat_id AS "chatId", c.name AS "chatName"
           FROM messages m JOIN chats c ON c.id = m.chat_id
          WHERE m.sort_id = ?`,
        [id],
      );
      if (row) rows.push({ ...row, sortId: Number(row.sortId) });
    }
    return json(res, 200, {
      query: q,
      engine: repo.kind,
      match: match ?? tsquery ?? '',
      count: rows.length,
      rows,
    });
  }

  if (url.pathname === '/api/reindex' && req.method === 'POST') {
    await repo.rebuildSearchIndex();
    return json(res, 200, await reindex());
  }

  if (url.pathname === '/api/healthz') {
    return json(res, 200, { ok: true, engine: repo.kind, documents: index.docs.length });
  }

  const rel = normalizePath(url.pathname === '/' ? 'demo.html' : url.pathname.slice(1));
  const file = join(here, rel);
  if (!file.startsWith(here)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const body = await readFile(file);
    const ext = file.slice(file.lastIndexOf('.'));
    res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
  }
}

server.listen(PORT, HOST, () => {
  console.log(`search server on http://${HOST}:${PORT}`);
  console.log(
    `engine: ${repo.kind} · indexed ${index.docs.length} documents ` +
      `(${corpus.messages.length} messages, ${corpus.chats.length} chats)`,
  );
});
