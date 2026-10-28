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
  'mention notification preferences are private, authenticated, and reversible',
  { skip: PGlite ? false : 'install @electric-sql/pglite to validate Supabase migrations' },
  async () => {
    const db = await PGlite.create();
    try {
      await db.exec(`
        create role anon;
        create role authenticated;
        create schema auth;
        create function auth.uid() returns uuid
          language sql stable
          as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
        grant usage on schema auth to authenticated;
        grant execute on function auth.uid() to authenticated;
        create table public.profiles (id uuid primary key);
        insert into public.profiles values
          ('00000000-0000-0000-0000-000000000001'),
          ('00000000-0000-0000-0000-000000000002');
      `);

      const migration = await readFile(
        new URL('../db/supabase/017_notification_preferences.sql', import.meta.url),
        'utf8',
      );
      const downMigration = await readFile(
        new URL('../db/supabase/017_notification_preferences.down.sql', import.meta.url),
        'utf8',
      );
      await db.exec(migration);
      await db.exec(migration);

      const { rows: column } = await db.query(
        `select column_default, is_nullable from information_schema.columns
         where table_schema = 'public' and table_name = 'user_notification_preferences'
           and column_name = 'mention_notifications_enabled'`,
      );
      assert.deepEqual(column, [{ column_default: 'true', is_nullable: 'NO' }]);
      const { rows: grants } = await db.query(
        `select has_function_privilege('authenticated',
                 'public.get_my_mention_notifications_enabled()', 'EXECUTE') as can_read,
                has_function_privilege('authenticated',
                 'public.update_my_mention_notifications_enabled(boolean)', 'EXECUTE') as can_update,
                has_function_privilege('anon',
                 'public.update_my_mention_notifications_enabled(boolean)', 'EXECUTE') as anon_can_update,
                has_table_privilege('authenticated', 'public.user_notification_preferences',
                 'UPDATE') as direct_update,
                (select relrowsecurity from pg_class where oid = 'public.user_notification_preferences'::regclass)
                 as row_security`,
      );
      assert.deepEqual(grants, [{
        can_read: true,
        can_update: true,
        anon_can_update: false,
        direct_update: false,
        row_security: true,
      }]);

      await db.query(
        `select set_config('request.jwt.claim.sub', $1, false)`,
        ['00000000-0000-0000-0000-000000000001'],
      );
      await db.exec('set role authenticated');
      const { rows: defaultPreference } = await db.query(
        `select public.get_my_mention_notifications_enabled() as enabled`,
      );
      assert.deepEqual(defaultPreference, [{ enabled: true }]);
      const { rows: updated } = await db.query(
        `select public.update_my_mention_notifications_enabled(false) as enabled`,
      );
      const { rows: readBack } = await db.query(
        `select public.get_my_mention_notifications_enabled() as enabled`,
      );
      assert.deepEqual(updated, [{ enabled: false }]);
      assert.deepEqual(readBack, [{ enabled: false }]);
      await db.exec('reset role');

      await db.query(
        `select set_config('request.jwt.claim.sub', $1, false)`,
        ['00000000-0000-0000-0000-000000000002'],
      );
      await db.exec('set role authenticated');
      const { rows: otherUserPreference } = await db.query(
        `select user_id from public.user_notification_preferences`,
      );
      assert.deepEqual(otherUserPreference, []);
      const { rows: otherUserDefault } = await db.query(
        `select public.get_my_mention_notifications_enabled() as enabled`,
      );
      assert.deepEqual(otherUserDefault, [{ enabled: true }]);
      await db.exec('reset role');

      await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
      await db.exec('set role authenticated');
      await assert.rejects(
        db.query(`select public.get_my_mention_notifications_enabled()`),
        /Authentication required/,
      );
      await db.exec('reset role');

      await db.exec(downMigration);
      await db.exec(downMigration);
      const { rows: removedColumn } = await db.query(
        `select to_regclass('public.user_notification_preferences') as preference_table`,
      );
      assert.deepEqual(removedColumn, [{ preference_table: null }]);
      const { rows: removedFunctions } = await db.query(
        `select to_regprocedure('public.get_my_mention_notifications_enabled()') as get_preference,
                to_regprocedure('public.update_my_mention_notifications_enabled(boolean)') as update_preference`,
      );
      assert.deepEqual(removedFunctions, [{ get_preference: null, update_preference: null }]);
    } finally {
      await db.close();
    }
  },
);

test('settings expose a persistent mention-alert toggle without hiding unread records', async () => {
  const [app, api, html, migration, downMigration] = await Promise.all([
    readFile(new URL('../src/live-app.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../src/supabase-chat.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../db/supabase/017_notification_preferences.sql', import.meta.url), 'utf8'),
    readFile(new URL('../db/supabase/017_notification_preferences.down.sql', import.meta.url), 'utf8'),
  ]);

  assert.match(app, /id="settings-mention-notifications"/);
  assert.match(app, /updateMyMentionNotificationsEnabled\(checkbox\.checked\)/);
  assert.match(app, /announce && state\.mentionsLoaded && state\.profile\?\.mention_notifications_enabled !== false/);
  assert.match(app, /state\.mentions\.length[\s\S]*Mention alerts are off/);
  assert.match(app, /getMyMentionNotificationsEnabled\(\)/);
  assert.doesNotMatch(
    api.slice(api.indexOf('export async function getProfile('), api.indexOf('export async function getProfilePreview(')),
    /mention_notifications_enabled/,
  );
  assert.match(api, /rpc\('get_my_mention_notifications_enabled'\)/);
  assert.match(api, /rpc\('update_my_mention_notifications_enabled'/);
  assert.match(html, /id="mention-notifications-toggle"/);
  assert.match(migration, /create table if not exists public\.user_notification_preferences/i);
  assert.match(migration, /where preference\.user_id = current_user_id/i);
  assert.match(migration, /enable row level security/i);
  assert.match(downMigration, /drop table if exists public\.user_notification_preferences/i);
});
