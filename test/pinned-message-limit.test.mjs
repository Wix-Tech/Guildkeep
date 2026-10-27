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
  'pinned-message migration caps non-admin pins and allows chat admins to exceed the cap',
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
        create table public.chats (
          id uuid primary key,
          chat_type text not null,
          channel_public boolean not null default false
        );
        create table public.chat_members (
          chat_id uuid not null,
          user_id uuid not null,
          role text not null,
          primary key (chat_id, user_id)
        );
        create table public.messages (
          id uuid primary key,
          chat_id uuid not null,
          deleted_at timestamptz
        );
        grant usage on schema public to authenticated;
        grant select on public.profiles, public.chats, public.chat_members, public.messages
          to authenticated;
      `);

      const readSql = async (name) => readFile(
        new URL(`../db/supabase/${name}`, import.meta.url),
        'utf8',
      );
      const baseMigration = await readSql('011_pinned_messages.sql');
      const basePublicationSetup = baseMigration.lastIndexOf('\ndo $$') + 1;
      assert.ok(basePublicationSetup > 1, 'base migration should configure Realtime publication');
      await db.exec(baseMigration.slice(0, basePublicationSetup));

      const pinLimitMigration = await readSql('014_chat_pin_limit.sql');
      const pinLimitDownMigration = await readSql('014_chat_pin_limit.down.sql');
      await db.exec(pinLimitMigration);
      await db.exec(pinLimitMigration);
      assert.match(pinLimitDownMigration, /drop function if exists public\.enforce_chat_pin_limit/i);

      const directChatId = '00000000-0000-4000-8000-000000000001';
      const groupChatId = '00000000-0000-4000-8000-000000000002';
      const ownerId = '00000000-0000-4000-8000-000000000003';
      const adminId = '00000000-0000-4000-8000-000000000004';
      const memberId = '00000000-0000-4000-8000-000000000005';
      const directMessageIds = Array.from({ length: 6 }, (_, index) =>
        `00000000-0000-4000-8000-${String(index + 11).padStart(12, '0')}`);
      const groupMessageIds = Array.from({ length: 6 }, (_, index) =>
        `00000000-0000-4000-8000-${String(index + 21).padStart(12, '0')}`);

      await db.query(
        `insert into public.profiles (id) values ($1), ($2), ($3)`,
        [ownerId, adminId, memberId],
      );
      await db.query(
        `insert into public.chats (id, chat_type) values ($1, 'direct'), ($2, 'group')`,
        [directChatId, groupChatId],
      );
      await db.query(
        `insert into public.chat_members (chat_id, user_id, role) values
          ($1, $2, 'member'), ($1, $3, 'member'),
          ($4, $2, 'owner'), ($4, $3, 'admin'), ($4, $5, 'member')`,
        [directChatId, ownerId, adminId, groupChatId, memberId],
      );
      await db.query(
        `insert into public.messages (id, chat_id)
         select direct_message.id, $1::uuid
         from unnest($2::uuid[]) as direct_message(id)
         union all
         select group_message.id, $3::uuid
         from unnest($4::uuid[]) as group_message(id)`,
        [directChatId, directMessageIds, groupChatId, groupMessageIds],
      );

      await db.exec('set role authenticated');
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [ownerId]);
      for (const messageId of directMessageIds.slice(0, 5)) {
        await db.query(
          `insert into public.chat_pins (chat_id, message_id, pinned_by) values ($1, $2, $3)`,
          [directChatId, messageId, ownerId],
        );
      }
      await assert.rejects(
        db.query(
          `insert into public.chat_pins (chat_id, message_id, pinned_by) values ($1, $2, $3)`,
          [directChatId, directMessageIds[5], ownerId],
        ),
        /maximum of 5/i,
      );

      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [memberId]);
      await assert.rejects(
        db.query(
          `insert into public.chat_pins (chat_id, message_id, pinned_by) values ($1, $2, $3)`,
          [groupChatId, groupMessageIds[0], memberId],
        ),
        /cannot pin messages/i,
      );

      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [adminId]);
      for (const messageId of groupMessageIds) {
        await db.query(
          `insert into public.chat_pins (chat_id, message_id, pinned_by) values ($1, $2, $3)`,
          [groupChatId, messageId, adminId],
        );
      }
      const { rows } = await db.query(
        `select count(*)::integer as count from public.chat_pins where chat_id = $1`,
        [groupChatId],
      );
      assert.equal(rows[0].count, 6, 'group admins may pin more than five messages');
      await db.exec('reset role');
      await db.exec(pinLimitDownMigration);
      await db.exec(pinLimitDownMigration);
    } finally {
      await db.close();
    }
  },
);
