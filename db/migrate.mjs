#!/usr/bin/env node
/**
 * migrate.mjs — create or upgrade the database.
 *
 *   node product/db/migrate.mjs             # product/data/app.db
 *   DB_PATH=/tmp/x.db node product/db/migrate.mjs
 *   node product/db/migrate.mjs --status    # show applied migrations
 */
import { openDb, migrate, ensureDirFor } from './db.mjs';
import { DB_PATH } from './paths.mjs';

const dbPath = process.env.DB_PATH ?? DB_PATH;
await ensureDirFor(dbPath);
const db = openDb(dbPath);

if (process.argv.includes('--status')) {
  await migrate(db, { log: () => {} });
  const rows = db.prepare('SELECT version, applied_at FROM schema_migrations ORDER BY version').all();
  console.log(`database: ${dbPath}`);
  for (const r of rows) {
    console.log(`  ${r.version}  applied ${new Date(r.applied_at).toISOString()}`);
  }
} else {
  const applied = await migrate(db, { log: (m) => console.log(m) });
  console.log(
    applied.length
      ? `database ready: ${dbPath}`
      : `nothing to do — ${dbPath} is up to date`,
  );
}

db.close();
