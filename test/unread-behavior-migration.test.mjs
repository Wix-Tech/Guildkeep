import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

let PGlite = null;
try {
  ({ PGlite } = await import('@electric-sql/pglite'));
} catch {
  /* optional dev dependency */
}

test(
  'unread behavior migration adds an idempotent, member-writable mute preference',
  { skip: PGlite ? false : 'install @electric-sql/pglite to validate Supabase migrations' },
  async () => {
    const db = await PGlite.create();
    try {
      await db.exec(`
        create role authenticated;
        create table public.chat_member_settings (
          chat_id uuid not null,
          user_id uuid not null,
          pinned boolean not null default false,
          last_read_at timestamptz not null default now(),
          primary key (chat_id, user_id)
        );
        grant update (pinned, last_read_at) on public.chat_member_settings to authenticated;
      `);

      const migration = await readFile(
        new URL('../db/supabase/015_unread_behavior.sql', import.meta.url),
        'utf8',
      );
      const downMigration = await readFile(
        new URL('../db/supabase/015_unread_behavior.down.sql', import.meta.url),
        'utf8',
      );
      await db.exec(migration);
      await db.exec(migration);

      const { rows: column } = await db.query(
        `select column_default, is_nullable from information_schema.columns
         where table_schema = 'public' and table_name = 'chat_member_settings'
           and column_name = 'muted'`,
      );
      assert.deepEqual(column, [{ column_default: 'false', is_nullable: 'NO' }]);
      const { rows: privilege } = await db.query(
        `select has_column_privilege(
          'authenticated', 'public.chat_member_settings', 'muted', 'UPDATE'
        ) as can_update_muted`,
      );
      assert.equal(privilege[0].can_update_muted, true);

      await db.exec(downMigration);
      await db.exec(downMigration);
      const { rows: removedColumn } = await db.query(
        `select column_name from information_schema.columns
         where table_schema = 'public' and table_name = 'chat_member_settings'
           and column_name = 'muted'`,
      );
      assert.deepEqual(removedColumn, []);
    } finally {
      await db.close();
    }
  },
);
