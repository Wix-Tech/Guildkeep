/**
 * open.mjs — one entry point, two databases.
 *
 *     const repo = await openRepository();          // DATABASE_URL decides
 *     const repo = await openRepository('sqlite:./data/app.db');
 *     const repo = await openRepository('postgres://user:pw@host/db');
 *
 * The rest of the app never knows which one it got. `repo.kind` is 'sqlite'
 * or 'postgres' if you need to branch (e.g. to report which engine served a
 * search).
 *
 * SQLite and PostgreSQL both implement the *same* contract:
 *
 *     migrate()                     run/verify schema, idempotent
 *     seed({reset})                 deterministic fixtures (dev only)
 *     transaction(fn)               fn(tx) is rolled back if it throws
 *     createGroup / addGroupMember
 *     loadGroupBot(groupId, opts)   -> pure bot, no I/O inside
 *     applyEffects({groupId, actorId, effects, now})
 *     syncPendingActions / syncUndoStack
 *     recordAudit / loadAudit
 *     snapshotGroup(groupId, opts)
 *     loadSearchCorpus()
 *     searchCandidates(query, opts)  -> {sortIds, match | tsquery}
 *     rebuildSearchIndex()
 *     raw                            callable: raw(sql, params?) -> rows
 *
 * Environment:
 *   DATABASE_URL   postgres://… | postgresql://… | sqlite:/path | file:/path
 *                  (unset -> file:<product>/data/app.db)
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { openMigrated, openDb, transaction } from './db.mjs';
import * as sqlite from './repository.mjs';
import { seed as seedSqlite } from './seed.mjs';
import { DB_PATH } from './paths.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** SQLite repository — the reference implementation. */
export function createSqliteRepository(file = DB_PATH) {
  return {
    kind: 'sqlite',
    file,
    // open lazily so importing this module never touches disk
    async open() {
      if (!this._db) this._db = await openMigrated(file);
      return this._db;
    },
    get db() {
      if (!this._db) throw new Error('call await repo.open() first');
      return this._db;
    },
    async migrate() {
      await this.open();
      return { kind: 'sqlite', file };
    },
    async close() {
      this._db?.close?.();
      this._db = null;
    },
    async seed(opts = {}) {
      const db = await this.open();
      return seedSqlite(db, opts);
    },
    async transaction(fn) {
      return transaction(this.db, fn);
    },
    async createGroup(...args) {
      return sqlite.createGroup(this.db, ...args);
    },
    async addGroupMember(...args) {
      return sqlite.addGroupMember(this.db, ...args);
    },
    async loadGroupBot(groupId, opts) {
      return sqlite.loadGroupBot(this.db, groupId, opts);
    },
    async applyEffects(...args) {
      return sqlite.applyEffects(this.db, ...args);
    },
    async syncPendingActions(...args) {
      return sqlite.syncPendingActions(this.db, ...args);
    },
    async syncUndoStack(...args) {
      return sqlite.syncUndoStack(this.db, ...args);
    },
    async recordAudit(...args) {
      return sqlite.recordAudit(this.db, ...args);
    },
    async loadAudit(...args) {
      return sqlite.loadAudit(this.db, ...args);
    },
    async snapshotGroup(...args) {
      return sqlite.snapshotGroup(this.db, ...args);
    },
    async loadSearchCorpus() {
      return sqlite.loadSearchCorpus(this.db);
    },
    async searchCandidates(...args) {
      return sqlite.searchCandidates(this.db, ...args);
    },
    async rebuildSearchIndex() {
      return sqlite.rebuildSearchIndex(this.db);
    },
    get raw() {
      return sqlite.raw(this.db);
    },
  };
}

/**
 * PostgreSQL repository — same contract, different dialect.
 *
 * Driver choice:
 *   1. `pg` installed            -> connect to `url` (production)
 *   2. only `@electric-sql/pglite` -> in-process WASM Postgres (dev / CI),
 *                                     no server, no data survives a restart
 *   Force the second with PGLITE=1.
 */
export async function createPostgresRepository(url) {
  let client;
  if (process.env.PGLITE !== '1' && !(await hasPg())) {
    ({ client } = await connectPglite());
  } else if (process.env.PGLITE === '1') {
    ({ client } = await connectPglite());
  } else {
    client = await connectExternal(url);
  }

  const { createPgRepository } = await import('./pg.mjs');
  const repo = createPgRepository(client);
  repo.kind = 'postgres';
  repo.driver = client.driver;
  repo.close = async () => {
    await client.close?.();
  };
  return repo;
}

async function hasPg() {
  try {
    await import('pg');
    return true;
  } catch {
    return false;
  }
}

async function connectPglite() {
  const { PGlite } = await import('@electric-sql/pglite').catch(() => {
    throw new Error(
      'No Postgres driver found. Install `pg` (production) or\n' +
        '  npm --prefix product install --save-dev @electric-sql/pglite   (dev, in-process)',
    );
  });
  const client = await PGlite.create();
  client.driver = 'pglite';
  return { client };
}

async function connectExternal(url) {
  let pgClient;
  try {
    ({ default: pgClient } = await import('pg'));
  } catch {
    throw new Error(
      'No Postgres driver found. Either install `pg` for a real server\n' +
        '  npm --prefix product install pg\n' +
        'or install `@electric-sql/pglite` to run Postgres in-process (dev only).',
    );
  }
  const pool = new pgClient.Pool({ connectionString: url, max: Number(process.env.PG_POOL_MAX ?? 10) });
  // Same shape PGlite exposes: query(sql, params) -> { rows }
  return {
    driver: 'pg',
    query: (sql, params) => pool.query(sql, params),
    // migrate() runs the whole schema file, which is several statements
    exec: (sql) => pool.query(sql),
    close: () => pool.end(),
  };
}

/**
 * Open whatever DATABASE_URL points at.
 *
 * With SEED_ON_EMPTY=1 a freshly migrated, empty database gets the demo
 * fixtures. It is a dev convenience (one process is enough to bring up a local
 * Postgres), not something to run in production.
 *
 * @param {string} [url] defaults to process.env.DATABASE_URL
 * @param {{seedOnEmpty?: boolean}} [opts]
 */
export async function openRepository(url = process.env.DATABASE_URL, opts = {}) {
  const target = url?.trim();
  const seedOnEmpty = opts.seedOnEmpty ?? process.env.SEED_ON_EMPTY === '1';

  if (target && /^postgres(ql)?:\/\//i.test(target)) {
    const repo = await createPostgresRepository(target);
    await repo.migrate();
    if (seedOnEmpty && (await isEmpty(repo))) await repo.seed();
    return repo;
  }

  let file = DB_PATH;
  if (target) {
    file = target.replace(/^(sqlite|file):?(\/\/)?/, '');
    if (file === ':memory:') return createMemorySqlite();
    if (!path.isAbsolute(file)) file = path.join(HERE, '..', file);
  }
  const repo = createSqliteRepository(file);
  await repo.migrate();
  if (seedOnEmpty && (await isEmpty(repo))) await repo.seed();
  return repo;
}

async function isEmpty(repo) {
  const [row] = await repo.raw('SELECT COUNT(*) AS n FROM users');
  return Number(row?.n ?? row?.count ?? 0) === 0;
}

function createMemorySqlite() {
  const repo = createSqliteRepository(':memory:');
  return repo;
}

export { openDb, openMigrated, sqlite };
