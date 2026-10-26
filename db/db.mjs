/**
 * db.mjs — SQLite plumbing (built into Node, no native deps).
 *
 *   import { openDb, migrate, transaction } from './db/db.mjs';
 *   const db = openDb('product/data/app.db');
 *   await migrate(db);
 *
 * `node:sqlite` is experimental in Node 22 but stable enough for this; if your
 * runtime does not ship it, swap this one file for better-sqlite3 — nothing
 * else in product/ imports a database driver.
 */
import { DatabaseSync } from 'node:sqlite';
import { readdir, readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const SCHEMA_DIR = join(here, 'schema');

export function openDb(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  if (path !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
  }
  return db;
}

const depths = new WeakMap();

/**
 * Run fn inside a transaction; rolls back on throw. Returns fn's value.
 * Re-entrant: a nested call becomes a SAVEPOINT, so repository functions can
 * be composed inside bigger transactions (seed scripts, request handlers).
 */
export function transaction(db, fn) {
  const depth = depths.get(db) ?? 0;
  const savepoint = `sp_${depth}`;

  if (depth === 0) db.exec('BEGIN IMMEDIATE');
  else db.exec(`SAVEPOINT ${savepoint}`);
  depths.set(db, depth + 1);

  try {
    const out = fn();
    if (depth === 0) db.exec('COMMIT');
    else db.exec(`RELEASE ${savepoint}`);
    depths.set(db, depth);
    return out;
  } catch (err) {
    try {
      if (depth === 0) db.exec('ROLLBACK');
      else {
        db.exec(`ROLLBACK TO ${savepoint}`);
        db.exec(`RELEASE ${savepoint}`);
      }
    } catch {
      /* transaction already gone */
    }
    depths.set(db, depth);
    throw err;
  }
}

/**
 * Apply every .sql file in db/schema in name order, once.
 * Idempotent: applied versions are recorded in schema_migrations.
 */
export async function migrate(db, { dir = SCHEMA_DIR, log = () => {} } = {}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);

  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version),
  );
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();

  const newlyApplied = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(join(dir, file), 'utf8');
    transaction(db, () => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
        file,
        Date.now(),
      );
    });
    newlyApplied.push(file);
    log(`applied ${file}`);
  }
  return newlyApplied;
}

/** Convenience for scripts/tests: a migrated database, in a file or in memory. */
export async function openMigrated(path = ':memory:') {
  const db = openDb(path);
  await migrate(db);
  return db;
}

export async function ensureDirFor(path) {
  if (path === ':memory:') return;
  await mkdir(dirname(path), { recursive: true });
}

/* ------------------------------------------------------------------ */
/* Query helpers — node:sqlite returns null-prototype rows, which are  */
/* annoying to spread. These keep call sites readable.                 */
/* ------------------------------------------------------------------ */

export const all = (db, sql, ...params) =>
  db.prepare(sql).all(...params).map((r) => ({ ...r }));

export const get = (db, sql, ...params) => {
  const row = db.prepare(sql).get(...params);
  return row ? { ...row } : null;
};

export const run = (db, sql, ...params) => db.prepare(sql).run(...params);
