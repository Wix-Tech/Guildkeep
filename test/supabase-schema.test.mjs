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
  'Supabase schema limits chats and messages to authenticated members',
  { skip: PGlite ? false : 'install @electric-sql/pglite to validate the Supabase schema' },
  async () => {
    const db = await PGlite.create();
    try {
      await db.exec(`
        create role anon;
        create role authenticated;
        create role service_role;
        create schema auth;
        create schema storage;
        create schema realtime;
        create table auth.users (
          id uuid primary key,
          raw_user_meta_data jsonb not null default '{}'::jsonb
        );
        create function auth.uid() returns uuid
          language sql stable
          as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
        create table storage.buckets (
          id text primary key,
          name text not null,
          public boolean not null default false,
          file_size_limit bigint,
          allowed_mime_types text[]
        );
        create table storage.objects (
          id uuid primary key default gen_random_uuid(),
          bucket_id text not null,
          name text not null
        );
        create table realtime.messages (
          topic text,
          extension text,
          payload jsonb,
          event text,
          private boolean not null default false,
          inserted_at timestamptz not null default now()
        );
        alter table realtime.messages enable row level security;
        create function realtime.topic() returns text
          language sql stable
          as $$ select current_setting('realtime.topic', true) $$;
        alter table storage.objects enable row level security;
        create function storage.foldername(object_name text) returns text[]
          language sql immutable
          as $$ select (string_to_array(object_name, '/'))[1:array_length(string_to_array(object_name, '/'), 1) - 1] $$;
        grant usage on schema auth to authenticated;
        grant execute on function auth.uid() to authenticated;
        grant usage on schema storage to authenticated;
        grant all on storage.buckets, storage.objects to authenticated;
        grant execute on function storage.foldername(text) to authenticated;
        grant usage on schema realtime to authenticated;
        grant select, insert on realtime.messages to authenticated;
        grant execute on function realtime.topic() to authenticated;
      `);

      const migration = await readFile(
        new URL('../db/supabase/001_chat_app.sql', import.meta.url),
        'utf8',
      );
      const profileSearchMigration = await readFile(
        new URL('../db/supabase/002_profile_search.sql', import.meta.url),
        'utf8',
      );
      const coreFeaturesMigration = await readFile(
        new URL('../db/supabase/003_groups_profile_reactions.sql', import.meta.url),
        'utf8',
      );
      const channelsMigration = await readFile(
        new URL('../db/supabase/004_channels_media_status.sql', import.meta.url),
        'utf8',
      );
      const settingsMigration = await readFile(
        new URL('../db/supabase/005_chat_and_status_settings.sql', import.meta.url),
        'utf8',
      );
      const profilePreviewMigration = await readFile(
        new URL('../db/supabase/006_profile_preview.sql', import.meta.url),
        'utf8',
      );
      const profilePreviewDownMigration = await readFile(
        new URL('../db/supabase/006_profile_preview.down.sql', import.meta.url),
        'utf8',
      );
      const reactionScopingMigration = await readFile(
        new URL('../db/supabase/007_chat_reaction_scoping.sql', import.meta.url),
        'utf8',
      );
      const reactionScopingDownMigration = await readFile(
        new URL('../db/supabase/007_chat_reaction_scoping.down.sql', import.meta.url),
        'utf8',
      );
      const messageRepliesMigration = await readFile(
        new URL('../db/supabase/008_message_replies.sql', import.meta.url),
        'utf8',
      );
      const messageRepliesDownMigration = await readFile(
        new URL('../db/supabase/008_message_replies.down.sql', import.meta.url),
        'utf8',
      );
      const readReceiptsMigration = await readFile(
        new URL('../db/supabase/009_read_typing_presence.sql', import.meta.url),
        'utf8',
      );
      const readReceiptsDownMigration = await readFile(
        new URL('../db/supabase/009_read_typing_presence.down.sql', import.meta.url),
        'utf8',
      );
      const messageSearchMigration = await readFile(
        new URL('../db/supabase/010_message_search.sql', import.meta.url),
        'utf8',
      );
      const messageSearchDownMigration = await readFile(
        new URL('../db/supabase/010_message_search.down.sql', import.meta.url),
        'utf8',
      );
      const pinnedMessagesMigration = await readFile(
        new URL('../db/supabase/011_pinned_messages.sql', import.meta.url),
        'utf8',
      );
      const pinnedMessagesDownMigration = await readFile(
        new URL('../db/supabase/011_pinned_messages.down.sql', import.meta.url),
        'utf8',
      );
      const markChatUnreadMigration = await readFile(
        new URL('../db/supabase/012_mark_chat_unread.sql', import.meta.url),
        'utf8',
      );
      const markChatUnreadDownMigration = await readFile(
        new URL('../db/supabase/012_mark_chat_unread.down.sql', import.meta.url),
        'utf8',
      );
      const mentionsMigration = await readFile(
        new URL('../db/supabase/013_mentions_notifications.sql', import.meta.url),
        'utf8',
      );
      const mentionsDownMigration = await readFile(
        new URL('../db/supabase/013_mentions_notifications.down.sql', import.meta.url),
        'utf8',
      );
      const voiceNoteMigration = await readFile(
        new URL('../db/supabase/016_voice_note_metadata.sql', import.meta.url),
        'utf8',
      );
      const voiceNoteDownMigration = await readFile(
        new URL('../db/supabase/016_voice_note_metadata.down.sql', import.meta.url),
        'utf8',
      );
      const disappearingMessagesMigration = await readFile(
        new URL('../db/supabase/018_disappearing_messages.sql', import.meta.url),
        'utf8',
      );
      const disappearingMessagesDownMigration = await readFile(
        new URL('../db/supabase/018_disappearing_messages.down.sql', import.meta.url),
        'utf8',
      );
      const publicationSetup = migration.lastIndexOf('\ndo $$') + 1;
      assert.ok(publicationSetup > 1, 'migration should configure Realtime publication');
      await db.exec(migration.slice(0, publicationSetup));
      const membershipPublicationSetup = profileSearchMigration.lastIndexOf('\ndo $$') + 1;
      assert.ok(membershipPublicationSetup > 1, 'profile migration should enable chat membership Realtime');
      await db.exec(profileSearchMigration.slice(0, membershipPublicationSetup));
      const featurePublicationSetup = coreFeaturesMigration.lastIndexOf('\ndo $$') + 1;
      assert.ok(featurePublicationSetup > 1, 'feature migration should configure Realtime publication');
      await db.exec(coreFeaturesMigration.slice(0, featurePublicationSetup));
      const channelsPublicationSetup = channelsMigration.lastIndexOf('\ndo $$') + 1;
      assert.ok(channelsPublicationSetup > 1, 'channels migration should configure Realtime publication');
      const channelsPublicationEnd = channelsMigration.indexOf('\n$$;', channelsPublicationSetup) + 4;
      assert.ok(channelsPublicationEnd > channelsPublicationSetup, 'channels migration should close its Realtime block');
      await db.exec(
        channelsMigration.slice(0, channelsPublicationSetup)
        + channelsMigration.slice(channelsPublicationEnd),
      );
      await db.exec(settingsMigration);
      await db.exec(profilePreviewMigration);
      await db.exec(profilePreviewMigration);
      const reactionPublicationSetup = reactionScopingMigration.lastIndexOf('\ndo $$') + 1;
      assert.ok(reactionPublicationSetup > 1, 'reaction migration should configure Realtime publication');
      assert.match(reactionScopingMigration, /alter publication supabase_realtime add table public\.chat_reactions/i);
      assert.match(reactionScopingMigration, /replica identity full/i);
      assert.match(reactionScopingMigration, /chat_reactions_by_chat_message/);
      await db.exec(reactionScopingMigration.slice(0, reactionPublicationSetup));
      await db.exec(reactionScopingMigration.slice(0, reactionPublicationSetup));
      await db.exec(messageRepliesMigration);
      await db.exec(messageRepliesMigration);
      const readReceiptsPublicationSetup = readReceiptsMigration.lastIndexOf('\ndo $$') + 1;
      assert.ok(readReceiptsPublicationSetup > 1, 'read-receipts migration should configure Realtime publication');
      assert.match(readReceiptsMigration, /alter publication supabase_realtime add table public\.message_reads/i);
      await db.exec(readReceiptsMigration.slice(0, readReceiptsPublicationSetup));
      await db.exec(readReceiptsMigration.slice(0, readReceiptsPublicationSetup));
      await db.exec(messageSearchMigration);
      await db.exec(messageSearchMigration);
      const pinsPublicationSetup = pinnedMessagesMigration.lastIndexOf('\ndo $$') + 1;
      assert.ok(pinsPublicationSetup > 1, 'pinned-message migration should configure Realtime publication');
      assert.match(pinnedMessagesMigration, /alter publication supabase_realtime add table public\.chat_pins/i);
      assert.match(pinnedMessagesDownMigration, /drop table if exists public\.chat_pins/i);
      await db.exec(pinnedMessagesMigration.slice(0, pinsPublicationSetup));
      await db.exec(pinnedMessagesMigration.slice(0, pinsPublicationSetup));
      await db.exec(markChatUnreadMigration);
      await db.exec(markChatUnreadMigration);
      assert.match(markChatUnreadDownMigration, /drop function if exists public\.mark_chat_unread/i);
      const mentionsPublicationSetup = mentionsMigration.lastIndexOf('\ndo $$') + 1;
      assert.ok(mentionsPublicationSetup > 1, 'mentions migration should configure Realtime publication');
      assert.match(mentionsMigration, /alter publication supabase_realtime add table public\.message_mentions/i);
      assert.match(mentionsDownMigration, /drop table if exists public\.message_mentions/i);
      await db.exec(mentionsMigration.slice(0, mentionsPublicationSetup));
      await db.exec(mentionsMigration.slice(0, mentionsPublicationSetup));
      await db.exec(voiceNoteMigration);
      await db.exec(voiceNoteMigration);
      assert.match(voiceNoteMigration, /voice_duration_ms integer/i);
      assert.match(voiceNoteMigration, /voice_waveform jsonb/i);
      assert.match(voiceNoteMigration, /messages_voice_note_metadata_check/i);
      const expirySchemaMigration = disappearingMessagesMigration
        .replace(/^create extension if not exists pg_cron;\s*/i, '');
      const expiryCronSetup = expirySchemaMigration.lastIndexOf('do $$');
      assert.ok(expiryCronSetup > 0, 'disappearing messages should schedule server-side expiry');
      assert.match(disappearingMessagesMigration, /cron\.schedule\([\s\S]*?\* \* \* \* \*/i);
      assert.match(disappearingMessagesMigration, /notify\s+pgrst,\s*'reload schema'/i);
      await db.exec(expirySchemaMigration.slice(0, expiryCronSetup));
      await db.exec(expirySchemaMigration.slice(0, expiryCronSetup));
      assert.match(disappearingMessagesDownMigration, /cron\.unschedule/i);

      const userA = '00000000-0000-4000-8000-000000000001';
      const userB = '00000000-0000-4000-8000-000000000002';
      const outsider = '00000000-0000-4000-8000-000000000003';
      await db.query(
        `insert into auth.users (id, raw_user_meta_data) values
          ($1, '{"username":"alex_one","display_name":"Alex One"}'),
          ($2, '{"username":"sam_two","display_name":"Sam Two"}'),
          ($3, '{"username":"outside","display_name":"Outside"}')`,
        [userA, userB, outsider],
      );

      await db.exec('set role authenticated');
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userA]);
      const { rows: people } = await db.query(
        `select id, username from public.search_profiles('sam')`,
      );
      assert.deepEqual(people, [{ id: userB, username: 'sam_two' }]);
      const { rows: selfSearch } = await db.query(
        `select id from public.search_profiles('alex')`,
      );
      assert.deepEqual(selfSearch, []);
      const { rows: literalUnderscoreSearch } = await db.query(
        `select id from public.search_profiles('sam_')`,
      );
      assert.deepEqual(literalUnderscoreSearch.map((row) => row.id), [userB]);
      const { rows: wildcardSearch } = await db.query(
        `select id from public.search_profiles('%')`,
      );
      assert.deepEqual(wildcardSearch, []);
      await db.exec('reset role; set role anon');
      await assert.rejects(
        db.query(`select * from public.search_profiles('sam')`),
        /permission denied/i,
      );
      await assert.rejects(
        db.query(`select * from public.search_messages('hello')`),
        /permission denied/i,
      );
      await db.exec('set role authenticated');
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userA]);
      const { rows: chatRows } = await db.query(
        `select public.create_direct_chat('sam_two') as chat_id`,
      );
      const chatId = chatRows[0].chat_id;
      const { rows: existingChat } = await db.query(
        `select public.create_direct_chat('sam_two') as chat_id`,
      );
      assert.equal(existingChat[0].chat_id, chatId, 'repeated direct-chat creation should reuse the chat');
      const { rows: inserted } = await db.query(
        `insert into public.messages (chat_id, sender_id, body)
         values ($1, $2, 'Hello @sam_two from Alex')
         returning id`,
        [chatId, userA],
      );
      assert.ok(inserted[0].id);
      const { rows: initialExpiry } = await db.query(
        `select expires_at from public.messages where id = $1`,
        [inserted[0].id],
      );
      assert.equal(initialExpiry[0].expires_at, null, 'messages sent with the timer off do not expire');
      await db.query(`select public.set_chat_disappearing_timer($1, 86400)`, [chatId]);
      const { rows: expiryProbe } = await db.query(
        `insert into public.messages (chat_id, sender_id, body, media_path, media_type, file_name)
         values ($1, $2, 'Temporary attachment', $3, 'image/png', 'temporary.png')
         returning id, created_at, expires_at`,
        [chatId, userA, `${chatId}/${userA}/temporary.png`],
      );
      assert.equal(
        new Date(expiryProbe[0].expires_at).getTime() - new Date(expiryProbe[0].created_at).getTime(),
        24 * 60 * 60 * 1000,
        'new messages inherit the server-side timer from their sent time',
      );
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userB]);
      await db.query(`select public.set_chat_disappearing_timer($1, 0)`, [chatId]);
      await assert.rejects(
        db.query(`select public.set_chat_disappearing_timer($1, null)`, [chatId]),
        /choose off, 24 hours, 7 days, or 90 days/i,
      );
      await db.exec('reset role');
      await db.query(
        `insert into storage.objects (bucket_id, name) values ('chat-media', $1)`,
        [`${chatId}/${userA}/temporary.png`],
      );
      await db.query(
        `update public.messages set expires_at = now() - interval '1 second' where id = $1`,
        [expiryProbe[0].id],
      );
      await db.exec('set role authenticated');
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userB]);
      const { rows: hiddenExpired } = await db.query(
        `select id from public.messages where id = $1`,
        [expiryProbe[0].id],
      );
      assert.deepEqual(hiddenExpired, [], 'RLS hides a message as soon as its timer expires');
      const { rows: dueMediaReadable } = await db.query(
        `select public.is_expired_message_media($1) as is_expired`,
        [`${chatId}/${userA}/temporary.png`],
      );
      assert.deepEqual(dueMediaReadable, [{ is_expired: true }]);
      const { rows: hiddenDueMedia } = await db.query(
        `select name from storage.objects where name = $1`,
        [`${chatId}/${userA}/temporary.png`],
      );
      assert.deepEqual(hiddenDueMedia, [], 'media access ends at the expiry deadline, before cron runs');
      await db.exec('reset role');
      const { rows: expiredCount } = await db.query(`select public.expire_due_messages() as count`);
      assert.equal(expiredCount[0].count, 1, 'server cleanup permanently removes expired messages');
      const { rows: removedExpiryProbe } = await db.query(
        `select id from public.messages where id = $1`,
        [expiryProbe[0].id],
      );
      assert.deepEqual(removedExpiryProbe, []);
      const { rows: expiredMedia } = await db.query(
        `select media_path from public.expired_message_media where chat_id = $1`,
        [chatId],
      );
      assert.deepEqual(expiredMedia, [{ media_path: `${chatId}/${userA}/temporary.png` }]);
      await db.exec('set role authenticated');
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userB]);
      const { rows: expiredMediaReadable } = await db.query(
        `select public.is_expired_message_media($1) as is_expired`,
        [`${chatId}/${userA}/temporary.png`],
      );
      assert.deepEqual(expiredMediaReadable, [{ is_expired: true }]);
      const { rows: hiddenExpiredMedia } = await db.query(
        `select name from storage.objects where name = $1`,
        [`${chatId}/${userA}/temporary.png`],
      );
      assert.deepEqual(hiddenExpiredMedia, [], 'expired attachments are blocked from reads immediately');
      const { rows: removedExpiredMedia } = await db.query(
        `delete from storage.objects where name = $1 returning name`,
        [`${chatId}/${userA}/temporary.png`],
      );
      assert.deepEqual(removedExpiredMedia, [], 'ordinary members cannot delete another member’s expired upload');
      await db.exec('reset role');
      const { rows: retainedExpiredMedia } = await db.query(
        `select name from storage.objects where name = $1`,
        [`${chatId}/${userA}/temporary.png`],
      );
      assert.deepEqual(retainedExpiredMedia, [{ name: `${chatId}/${userA}/temporary.png` }]);
      await db.query(
        `delete from storage.objects where name = $1`,
        [`${chatId}/${userA}/temporary.png`],
      );
      await db.query(
        `delete from public.expired_message_media where media_path = $1`,
        [`${chatId}/${userA}/temporary.png`],
      );
      await db.exec('set role authenticated');
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userA]);
      const { rows: pin } = await db.query(
        `insert into public.chat_pins (chat_id, message_id, pinned_by)
         values ($1, $2, $3) returning message_id`,
        [chatId, inserted[0].id, userA],
      );
      assert.deepEqual(pin, [{ message_id: inserted[0].id }], 'direct-chat members can pin messages');
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userB]);
      const { rows: visiblePins } = await db.query(
        `select message_id from public.chat_pins where chat_id = $1`,
        [chatId],
      );
      assert.deepEqual(visiblePins, [{ message_id: inserted[0].id }], 'pins are shared with other chat members');
      await db.query(`select public.mark_chat_unread($1)`, [chatId]);
      const { rows: unreadMentions } = await db.query(
        `select message_id, chat_id, sender_username, body
         from public.list_my_mentions()`,
      );
      assert.deepEqual(unreadMentions, [{
        message_id: inserted[0].id,
        chat_id: chatId,
        sender_username: 'alex_one',
        body: 'Hello @sam_two from Alex',
      }], 'a chat member receives an unread mention notification');
      const { rows: unreadChatRows } = await db.query(
        `select unread_count from public.list_my_chats() where chat_id = $1`,
        [chatId],
      );
      assert.equal(unreadChatRows[0].unread_count, 1, 'mark unread moves only this member’s unread cursor');
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [outsider]);
      const { rows: outsiderMentions } = await db.query(
        `select message_id from public.list_my_mentions()`,
      );
      assert.deepEqual(outsiderMentions, [], 'non-members do not receive mention notifications');
      const { rows: hiddenMentionRows } = await db.query(
        `select message_id from public.message_mentions`,
      );
      assert.deepEqual(hiddenMentionRows, [], 'mention rows are visible only to their recipients');
      const { rows: privatePins } = await db.query(
        `select message_id from public.chat_pins where chat_id = $1`,
        [chatId],
      );
      assert.deepEqual(privatePins, [], 'non-members cannot view private-chat pins');
      await assert.rejects(
        db.query(
          `insert into public.chat_pins (chat_id, message_id, pinned_by)
           values ($1, $2, $3)`,
          [chatId, inserted[0].id, outsider],
        ),
        /row-level security/i,
      );
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userA]);
      const { rows: editableMention } = await db.query(
        `insert into public.messages (chat_id, sender_id, body)
         values ($1, $2, 'Initial @sam_two mention')
         returning id`,
        [chatId, userA],
      );
      await db.query(
        `select public.edit_message($1, 'Edited without a mention')`,
        [editableMention[0].id],
      );
      await db.query(
        `select public.edit_message($1, 'Edited with @sam_two again')`,
        [editableMention[0].id],
      );
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userB]);
      const { rows: editedMentionNotification } = await db.query(
        `select message_id from public.list_my_mentions() where message_id = $1`,
        [editableMention[0].id],
      );
      assert.deepEqual(editedMentionNotification, [{ message_id: editableMention[0].id }], 'editing a message rebuilds its mention recipients');
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userA]);
      await db.query(`select public.delete_message($1)`, [editableMention[0].id]);
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userB]);
      const { rows: deletedMentionNotification } = await db.query(
        `select message_id from public.list_my_mentions() where message_id = $1`,
        [editableMention[0].id],
      );
      assert.deepEqual(deletedMentionNotification, [], 'soft-deleting a message removes its mention notification');
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userA]);
      const { rows: prefixMatches } = await db.query(
        `select message_id, snippet from public.search_messages('hell', $1)`,
        [chatId],
      );
      assert.deepEqual(prefixMatches.map((row) => row.message_id), [inserted[0].id], 'search terms match word prefixes');
      assert.match(prefixMatches[0].snippet, /<mark>hello<\/mark>/i, 'search results return a highlighted snippet');
      const { rows: substringMisses } = await db.query(
        `select message_id from public.search_messages('ello', $1)`,
        [chatId],
      );
      assert.deepEqual(substringMisses, [], 'search matches prefixes rather than arbitrary substrings');
      const { rows: scopedMatches } = await db.query(
        `select public.create_group('Search test group', '{}'::text[]) as other_chat_id`,
      );
      const otherChatId = scopedMatches[0].other_chat_id;
      const { rows: otherMatch } = await db.query(
        `insert into public.messages (chat_id, sender_id, body)
         values ($1, $2, 'Hello from another chat')
         returning id`,
        [otherChatId, userA],
      );
      await assert.rejects(
        db.query(
          `insert into public.chat_pins (chat_id, message_id, pinned_by)
           values ($1, $2, $3)`,
          [otherChatId, inserted[0].id, userA],
        ),
        /same chat/i,
      );
      await assert.rejects(
        db.query(`select public.mark_chat_unread($1)`, [otherChatId]),
        /no received messages to mark unread/i,
      );
      const { rows: currentChatOnly } = await db.query(
        `select message_id from public.search_messages('hell', $1)`,
        [chatId],
      );
      assert.deepEqual(currentChatOnly, [{ message_id: inserted[0].id }], 'current-chat search stays isolated');
      const { rows: globalMatches } = await db.query(
        `select message_id from public.search_messages('hell')`,
      );
      assert.deepEqual(
        globalMatches.map((row) => row.message_id).sort(),
        [inserted[0].id, otherMatch[0].id].sort(),
        'global search includes the caller’s chats',
      );
      const { rows: pinGroupRows } = await db.query(
        `select public.create_group('Pin permissions test', array['sam_two']::text[]) as pin_group_id`,
      );
      const pinGroupId = pinGroupRows[0].pin_group_id;
      const { rows: pinnedGroupMessage } = await db.query(
        `insert into public.messages (chat_id, sender_id, body)
         values ($1, $2, 'Pinned group message')
         returning id`,
        [pinGroupId, userA],
      );
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userB]);
      await assert.rejects(
        db.query(
          `insert into public.chat_pins (chat_id, message_id, pinned_by)
           values ($1, $2, $3)`,
          [pinGroupId, pinnedGroupMessage[0].id, userB],
        ),
        /row-level security/i,
      );
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userA]);
      const { rows: groupPin } = await db.query(
        `insert into public.chat_pins (chat_id, message_id, pinned_by)
         values ($1, $2, $3) returning message_id`,
        [pinGroupId, pinnedGroupMessage[0].id, userA],
      );
      assert.deepEqual(groupPin, [{ message_id: pinnedGroupMessage[0].id }], 'group admins can pin messages');
      await db.query(`select public.delete_message($1)`, [pinnedGroupMessage[0].id]);
      const { rows: removedDeletedPin } = await db.query(
        `select message_id from public.chat_pins where message_id = $1`,
        [pinnedGroupMessage[0].id],
      );
      assert.deepEqual(removedDeletedPin, [], 'deleting a message also removes its pin');
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [outsider]);
      await assert.rejects(
        db.query(`select * from public.search_messages('hell', $1)`, [chatId]),
        /chat not found or access denied/i,
      );
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userA]);
      await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
      await assert.rejects(
        db.query(`select * from public.search_messages('hell')`),
        /authentication required/i,
      );
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userA]);
      await assert.rejects(
        db.query(`select * from public.search_messages('x', $1)`, [chatId]),
        /between 2 and 100/i,
      );
      await assert.rejects(
        db.query(`select * from public.search_messages(repeat('x', 101), $1)`, [chatId]),
        /between 2 and 100/i,
      );
      await assert.rejects(
        db.query(`select * from public.search_messages('aa bb cc dd ee ff gg hh ii', $1)`, [chatId]),
        /at most 8 words/i,
      );
      await assert.rejects(
        db.query(`select * from public.search_messages('hell', $1, 51)`, [chatId]),
        /invalid search page/i,
      );
      await assert.rejects(
        db.query(`select * from public.search_messages('hell', $1, 25, 5001)`, [chatId]),
        /invalid search page/i,
      );
      const { rows: secureSearchRpc } = await db.query(
        `select prosecdef, proconfig from pg_proc
         where oid = 'public.search_messages(text,uuid,integer,integer)'::regprocedure`,
      );
      assert.equal(secureSearchRpc[0].prosecdef, true);
      assert.ok(secureSearchRpc[0].proconfig.includes('search_path=""'));
      const { rows: searchIndex } = await db.query(
        `select indexdef from pg_indexes
         where schemaname = 'public' and indexname = 'messages_search_vector_gin'`,
      );
      assert.match(searchIndex[0].indexdef, /using gin \(search_vector\)/i);
      const { rows: searchFunction } = await db.query(
        `select pg_get_functiondef('public.search_messages(text,uuid,integer,integer)'::regprocedure) as definition`,
      );
      assert.match(searchFunction[0].definition, /message\.search_vector @@ search_query/i);
      assert.match(searchFunction[0].definition, /message\.chat_id = target_chat_id/i);
      const { rows: latestVisibleMessage } = await db.query(
        `select id from public.messages where chat_id = $1
         order by created_at desc, id desc limit 1`,
        [chatId],
      );
      const { rows: markedRead } = await db.query(
        `select * from public.mark_chat_read($1)`,
        [chatId],
      );
      assert.equal(markedRead[0].user_id, userA);
      assert.equal(markedRead[0].last_read_sort_id, latestVisibleMessage[0].id);
      await db.query(`select public.mark_chat_read($1)`, [chatId]);
      const { rows: oneReceiptPerUser } = await db.query(
        `select count(*)::integer as count from public.message_reads
         where chat_id = $1 and user_id = $2`,
        [chatId, userA],
      );
      assert.equal(oneReceiptPerUser[0].count, 1, 'marking a chat repeatedly updates one receipt');
      const { rows: secureReadRpc } = await db.query(
        `select prosecdef, proconfig from pg_proc
         where oid = 'public.mark_chat_read(uuid)'::regprocedure`,
      );
      assert.equal(secureReadRpc[0].prosecdef, true);
      assert.ok(secureReadRpc[0].proconfig.includes('search_path=""'));
      const { rows: ownReceiptUpdate } = await db.query(
        `update public.message_reads set updated_at = updated_at
         where chat_id = $1 and user_id = $2 returning user_id`,
        [chatId, userA],
      );
      assert.deepEqual(ownReceiptUpdate, [{ user_id: userA }], 'users may update their own receipt');
      await db.query(
        `select set_config('realtime.topic', $1, false)`,
        [`chat-live:${chatId}`],
      );
      await db.query(
        `insert into realtime.messages (topic, extension, event, payload, private)
         values ($1, 'broadcast', 'typing', '{"user_id":"00000000-0000-4000-8000-000000000001"}', true)`,
        [`chat-live:${chatId}`],
      );
      const { rows: privateLiveEvent } = await db.query(
        `select topic from realtime.messages`,
      );
      assert.deepEqual(privateLiveEvent, [{ topic: `chat-live:${chatId}` }]);
      const { rows: repliedMessage } = await db.query(
        `insert into public.messages (chat_id, sender_id, body, reply_to_id)
         values ($1, $2, 'Reply to Alex', $3)
         returning id, reply_to_id`,
        [chatId, userA, inserted[0].id],
      );
      assert.deepEqual(repliedMessage, [{
        id: repliedMessage[0].id,
        reply_to_id: inserted[0].id,
      }]);
      const { rows: mediaMessage } = await db.query(
        `insert into public.messages (
           chat_id, sender_id, body, media_path, media_type, file_name
         ) values ($1, $2, '', $3, 'image/png', 'image.png')
         returning id`,
        [chatId, userA, `${chatId}/${userA}/image.png`],
      );
      const waveform = Array.from({ length: 48 }, (_, index) => (index + 1) / 48);
      const { rows: voiceMessage } = await db.query(
        `insert into public.messages (
           chat_id, sender_id, body, media_path, media_type, file_name,
           voice_note, voice_duration_ms, voice_waveform
         ) values ($1, $2, '', $3, 'audio/webm', 'Voice note', true, 4321, $4)
         returning voice_note, voice_duration_ms, voice_waveform`,
        [chatId, userA, `${chatId}/${userA}/voice.webm`, JSON.stringify(waveform)],
      );
      assert.equal(voiceMessage[0].voice_note, true);
      assert.equal(voiceMessage[0].voice_duration_ms, 4321);
      assert.deepEqual(voiceMessage[0].voice_waveform, waveform);
      await assert.rejects(
        db.query(
          `insert into public.messages (
             chat_id, sender_id, body, media_path, media_type, voice_note,
               file_name, voice_duration_ms, voice_waveform
             ) values ($1, $2, '', $3, 'audio/webm', true, 'Voice note', 300001, $4)`,
          [chatId, userA, `${chatId}/${userA}/invalid.webm`, JSON.stringify(waveform)],
        ),
        /messages_voice_note_metadata_check/i,
      );
      await db.query(
        `insert into storage.objects (bucket_id, name) values ('chat-media', $1)`,
        [`${chatId}/${userA}/image.png`],
      );
      const { rows: editableMessage } = await db.query(
        `insert into public.messages (chat_id, sender_id, body)
         values ($1, $2, 'Edit me') returning id`,
        [chatId, userA],
      );
      await db.query(
        `select public.edit_message($1, 'Edited message')`,
        [editableMessage[0].id],
      );
      const { rows: editedMessage } = await db.query(
        `select body, edited_at from public.messages where id = $1`,
        [editableMessage[0].id],
      );
      assert.equal(editedMessage[0].body, 'Edited message');
      assert.ok(editedMessage[0].edited_at);

      const { rows: updatedProfile } = await db.query(
        `select display_name, bio from public.update_my_profile('Alex', 'Hello there')`,
      );
      assert.deepEqual(updatedProfile, [{ display_name: 'Alex', bio: 'Hello there' }]);
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userB]);
      await db.query(
        `select public.update_my_profile('Sam Two', 'Around', $1)`,
        [`${userB}/avatar.png`],
      );
      const { rows: latestForMemberB } = await db.query(
        `select id from public.messages where chat_id = $1
         order by created_at desc, id desc limit 1`,
        [chatId],
      );
      const { rows: memberBReceipt } = await db.query(
        `insert into public.message_reads (chat_id, user_id, last_read_sort_id)
         values ($1, $2, $3) returning user_id`,
        [chatId, userB, latestForMemberB[0].id],
      );
      assert.deepEqual(memberBReceipt, [{ user_id: userB }], 'members can only insert their own receipt');
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userA]);
      const { rows: otherMemberReceiptUpdate } = await db.query(
        `update public.message_reads set last_read_sort_id = $1
         where chat_id = $2 and user_id = $3 returning user_id`,
        [inserted[0].id, chatId, userB],
      );
      assert.deepEqual(otherMemberReceiptUpdate, [], 'users cannot update another member receipt');
      const { rows: peopleWithAvatars } = await db.query(
        `select id, avatar_path from public.search_profiles_with_avatars('sam')`,
      );
      assert.deepEqual(peopleWithAvatars, [{ id: userB, avatar_path: `${userB}/avatar.png` }]);
      await db.query(
        `select public.update_my_profile('Alex', 'Hello there', $1)`,
        [`${userA}/avatar.png`],
      );
      const { rows: avatarProfile } = await db.query(
        `select avatar_path from public.profiles where id = $1`,
        [userA],
      );
      assert.equal(avatarProfile[0].avatar_path, `${userA}/avatar.png`);

      const statusId = '00000000-0000-4000-8000-000000000101';
      await db.query(
        `select public.create_channel('Guildkeep updates', 'News and announcements')`,
      );
      const { rows: channels } = await db.query(
        `select chat_id, role, subscriber_count from public.list_my_channels()`,
      );
      assert.equal(channels.length, 1);
      assert.equal(channels[0].role, 'owner');
      assert.equal(channels[0].subscriber_count, 1);
      const createdChannelId = channels[0].chat_id;
      const { rows: publicChannelMessage } = await db.query(
        `insert into public.messages (chat_id, sender_id, body)
         values ($1, $2, 'orchid public channel message')
         returning id`,
        [createdChannelId, userA],
      );
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [outsider]);
      const { rows: publicChannelSearch } = await db.query(
        `select chat_id from public.search_messages('orchid')`,
      );
      assert.deepEqual(publicChannelSearch, [{ chat_id: createdChannelId }],
        'global search includes public channels visible to the caller');
      const { rows: publicChannelScopedSearch } = await db.query(
        `select chat_id from public.search_messages('orchid', $1)`,
        [createdChannelId],
      );
      assert.deepEqual(publicChannelScopedSearch, [{ chat_id: createdChannelId }],
        'public channel search is scoped and remains visible without membership');
      await db.exec('reset role');
      await db.query(`delete from public.messages where id = $1`, [publicChannelMessage[0].id]);
      await db.exec('set role authenticated');
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userA]);
      await db.query(
        `insert into storage.objects (bucket_id, name) values ('chat-avatars', $1)`,
        [`${createdChannelId}/${userA}/channel-avatar.png`],
      );
      const { rows: updatedChannel } = await db.query(
        `select chat_type, title, channel_description, avatar_path, channel_public
         from public.update_chat_settings($1, 'Guildkeep news', 'Official updates', $2,
           false, false, null, null, null, null, null)`,
        [createdChannelId, `${createdChannelId}/${userA}/channel-avatar.png`],
      );
      assert.deepEqual(updatedChannel, [{
        chat_type: 'channel',
        title: 'Guildkeep news',
        channel_description: 'Official updates',
        avatar_path: `${createdChannelId}/${userA}/channel-avatar.png`,
        channel_public: false,
      }]);
      const { rows: hiddenChannel } = await db.query(
        `select chat_id from public.discover_channels('Guildkeep')`,
      );
      assert.deepEqual(hiddenChannel, []);
      await db.query(
        `select public.update_chat_settings($1, 'Guildkeep news', 'Official updates', null,
          false, true, null, null, null, null, null)`,
        [createdChannelId],
      );
      await assert.rejects(
        db.query(`select * from public.run_group_command($1, '/rename Not a group')`, [createdChannelId]),
        /group commands can only be used in groups/i,
      );
      await db.query(
        `insert into public.messages (chat_id, sender_id, body)
         values ($1, $2, 'Channel announcement')`,
        [createdChannelId, userA],
      );
      await db.query(
        `insert into storage.objects (bucket_id, name)
         values ('chat-media', $1)`,
        [`${createdChannelId}/${userA}/channel.png`],
      );
      await db.query(
        `insert into storage.objects (bucket_id, name)
         values ('chat-media', $1)`,
        [`${userA}/${statusId}/status.png`],
      );
      await db.query(
        `select public.create_status($1, 'On my way', $2, 'image/png')`,
        [statusId, `${userA}/${statusId}/status.png`],
      );

      const { rows: createdGroups } = await db.query(
        `select public.create_group('Weekend plans', array['sam_two']) as chat_id`,
      );
      const groupId = createdGroups[0].chat_id;
      await db.query(`select public.set_chat_disappearing_timer($1, 604800)`, [groupId]);
      const { rows: listedGroups } = await db.query(
        `select chat_name, is_group, my_role, invite_code, participants
         from public.list_my_chats() where chat_id = $1`,
        [groupId],
      );
      assert.equal(listedGroups[0].chat_name, 'Weekend plans');
      assert.equal(listedGroups[0].is_group, true);
      assert.equal(listedGroups[0].my_role, 'owner');
      assert.match(listedGroups[0].invite_code, /^[a-f0-9]{32}$/);
      assert.equal(listedGroups[0].participants[0].username, 'sam_two');
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userB]);
      await assert.rejects(
        db.query(`select public.set_chat_disappearing_timer($1, 0)`, [groupId]),
        /only group admins can change/i,
      );
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userA]);
      await db.query(
        `insert into storage.objects (bucket_id, name) values ('chat-avatars', $1)`,
        [`${groupId}/${userA}/group-avatar.png`],
      );
      const { rows: updatedGroup } = await db.query(
        `select title, group_description, avatar_path, group_locked, announcement_mode,
            slowmode_seconds, antilink_enabled, group_rules
         from public.update_chat_settings($1, 'Weekend crew', 'Friends and plans', $2,
           false, null, false, false, 15, true, 'Be kind')`,
        [groupId, `${groupId}/${userA}/group-avatar.png`],
      );
      assert.deepEqual(updatedGroup, [{
        title: 'Weekend crew',
        group_description: 'Friends and plans',
        avatar_path: `${groupId}/${userA}/group-avatar.png`,
        group_locked: false,
        announcement_mode: false,
        slowmode_seconds: 15,
        antilink_enabled: true,
        group_rules: 'Be kind',
      }]);
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userB]);
      await assert.rejects(
        db.query(
          `select public.update_chat_settings($1, 'Member rename', '', null, false,
            null, null, null, null, null, null)`,
          [groupId],
        ),
        /only group or channel admins/i,
      );
      await assert.rejects(
        db.query(
          `insert into storage.objects (bucket_id, name) values ('chat-avatars', $1)`,
          [`${groupId}/${userB}/unauthorized.png`],
        ),
        /row-level security/i,
      );
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userA]);
      const { rows: locked } = await db.query(
        `select * from public.run_group_command($1, '/lock maintenance')`,
        [groupId],
      );
      assert.equal(locked[0].ok, true);
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userB]);
      await assert.rejects(
        db.query(
          `insert into public.messages (chat_id, sender_id, body)
           values ($1, $2, 'Members are locked')`,
          [groupId, userB],
        ),
        /row-level security|only group admins/i,
      );
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userA]);
      const { rows: opened } = await db.query(
        `select * from public.run_group_command($1, '/open')`,
        [groupId],
      );
      assert.equal(opened[0].ok, true);
      await db.query(`select * from public.run_group_command($1, '/antilink on')`, [groupId]);
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userB]);
      await assert.rejects(
        db.query(
          `insert into public.messages (chat_id, sender_id, body)
           values ($1, $2, 'Visit https://example.com')`,
          [groupId, userB],
        ),
        /links are disabled/i,
      );
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userA]);
      await db.query(`select * from public.run_group_command($1, '/antilink off')`, [groupId]);
      await db.query(`select * from public.run_group_command($1, '/slowmode 30')`, [groupId]);
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userB]);
      const { rows: memberMessage } = await db.query(
        `insert into public.messages (chat_id, sender_id, body)
         values ($1, $2, 'First member message') returning id`,
        [groupId, userB],
      );
      const memberMessageId = memberMessage[0].id;
      await assert.rejects(
        db.query(
          `insert into public.messages (chat_id, sender_id, body)
           values ($1, $2, 'Too soon')`,
          [groupId, userB],
        ),
        /slow mode is on/i,
      );
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userA]);
      await db.query(`select * from public.run_group_command($1, '/slowmode off')`, [groupId]);
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userB]);
      const { rows: groupReply } = await db.query(
        `insert into public.messages (chat_id, sender_id, body, reply_to_id)
         values ($1, $2, 'A reply inside this group', $3) returning reply_to_id`,
        [groupId, userB, memberMessageId],
      );
      assert.deepEqual(groupReply, [{ reply_to_id: memberMessageId }]);
      await assert.rejects(
        db.query(
          `insert into public.messages (chat_id, sender_id, body, reply_to_id)
           values ($1, $2, 'Cross-chat reply', $3)`,
          [groupId, userB, inserted[0].id],
        ),
        /reply target must belong to the same chat/i,
      );
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userA]);
      const { rows: groupMessage } = await db.query(
        `insert into public.messages (chat_id, sender_id, body)
         values ($1, $2, 'A group hello') returning id`,
        [groupId, userA],
      );
      const groupMessageId = groupMessage[0].id;
      await assert.rejects(
        db.query(
          `insert into public.message_reads (chat_id, user_id, last_read_sort_id)
           values ($1, $2, $3)`,
          [chatId, userA, groupMessageId],
        ),
        /read position must belong to the same chat/i,
      );
      const { rows: postedStatus } = await db.query(
        `select * from public.run_group_command($1, '/status Welcome to the group')`,
        [groupId],
      );
      assert.equal(postedStatus[0].ok, true);

      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userB]);
      const { rows: sharedReceipt } = await db.query(
        `select user_id, last_read_sort_id from public.message_reads where chat_id = $1`,
        [chatId],
      );
      assert.ok(sharedReceipt.some((receipt) => receipt.user_id === userA));
      const { rows: channelPosts } = await db.query(
        `select body from public.messages where chat_id = $1`,
        [createdChannelId],
      );
      assert.deepEqual(channelPosts, [{ body: 'Channel announcement' }]);
      const { rows: channelMedia } = await db.query(
        `select name from storage.objects where name = $1`,
        [`${createdChannelId}/${userA}/channel.png`],
      );
      assert.deepEqual(channelMedia, [{ name: `${createdChannelId}/${userA}/channel.png` }]);
      const { rows: channelAvatar } = await db.query(
        `select name from storage.objects where name = $1`,
        [`${createdChannelId}/${userA}/channel-avatar.png`],
      );
      assert.deepEqual(channelAvatar, [{ name: `${createdChannelId}/${userA}/channel-avatar.png` }]);
      const { rows: visibleStatuses } = await db.query(
        `select author_name, body from public.list_contact_statuses() where author_id = $1`,
        [userA],
      );
      assert.deepEqual(visibleStatuses, [{ author_name: 'Alex', body: 'On my way' }]);
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userA]);
      await db.query(`select public.update_status_visibility('only_me')`);
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userB]);
      const { rows: privateStatuses } = await db.query(
        `select body from public.list_contact_statuses() where author_id = $1`,
        [userA],
      );
      assert.deepEqual(privateStatuses, []);
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userA]);
      await db.query(`select public.update_status_visibility('contacts')`);
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userB]);
      await assert.rejects(
        db.query(`select public.delete_status($1)`, [statusId]),
        /status not found or you cannot delete it/i,
      );
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userA]);
      const { rows: deletedStatus } = await db.query(
        `select public.delete_status($1) as media_path`,
        [statusId],
      );
      assert.equal(deletedStatus[0].media_path, `${userA}/${statusId}/status.png`);
      const { rows: missingStatus } = await db.query(
        `select id from public.status_posts where id = $1`,
        [statusId],
      );
      assert.deepEqual(missingStatus, []);
      await db.query(`delete from storage.objects where name = $1`, [`${userA}/${statusId}/status.png`]);
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userB]);
      await db.query(`select public.subscribe_to_channel($1)`, [createdChannelId]);
      const { rows: subscribedChannels } = await db.query(`select * from public.list_my_channels()`);
      assert.equal(subscribedChannels.length, 1);
      assert.equal(subscribedChannels[0].role, 'member');
      const { rows: otherParticipantChat } = await db.query(
        `select public.create_direct_chat('alex_one') as chat_id`,
      );
      assert.equal(otherParticipantChat[0].chat_id, chatId);
      const { rows: visibleToMember } = await db.query(
        `select body from public.messages where chat_id = $1`,
        [chatId],
      );
      assert.deepEqual(
        visibleToMember.map((row) => row.body).sort(),
        ['', '', '', 'Edited message', 'Hello @sam_two from Alex', 'Reply to Alex'],
      );
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [outsider]);
      await assert.rejects(
        db.query(`select public.mark_chat_read($1)`, [chatId]),
        /not a member/i,
      );
      await db.query(
        `select set_config('realtime.topic', $1, false)`,
        [`chat-live:${chatId}`],
      );
      const { rows: outsiderLiveEvents } = await db.query(`select topic from realtime.messages`);
      assert.deepEqual(outsiderLiveEvents, [], 'non-members cannot receive private typing/presence events');
      await assert.rejects(
        db.query(
          `insert into realtime.messages (topic, extension, event, payload, private)
           values ($1, 'broadcast', 'typing', '{}', true)`,
          [`chat-live:${chatId}`],
        ),
        /row-level security/i,
      );
      await assert.rejects(
        db.query(
          `insert into public.messages (chat_id, sender_id, body, reply_to_id)
           values ($1, $2, 'Unauthorized reply', $3)`,
          [chatId, outsider, inserted[0].id],
        ),
        /row-level security|not a member/i,
      );
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userB]);
      await assert.rejects(
        db.query(`select public.delete_message($1)`, [mediaMessage[0].id]),
        /cannot delete this message/i,
      );
      await assert.rejects(
        db.query(`select public.edit_message($1, 'Not allowed')`, [inserted[0].id]),
        /edit your own message/i,
      );
      const { rows: memberDeniedAdminCommand } = await db.query(
        `select * from public.run_group_command($1, '/lock')`,
        [groupId],
      );
      assert.equal(memberDeniedAdminCommand[0].ok, false);
      const { rows: reacted } = await db.query(
        `select * from public.toggle_message_reaction($1, '❤️')`,
        [groupMessageId],
      );
      assert.deepEqual(reacted, [{ reaction: '❤️', count: 1, reacted_by_me: true }]);
      const { rows: groupReactions } = await db.query(
        `select message_id, reaction from public.list_chat_reactions($1)`,
        [groupId],
      );
      assert.deepEqual(groupReactions, [{ message_id: groupMessageId, reaction: '❤️' }]);
      const { rows: scopedReactions } = await db.query(
        `select chat_id from public.chat_reactions where message_id = $1`,
        [groupMessageId],
      );
      assert.deepEqual(scopedReactions, [{ chat_id: groupId }], 'chat_id should be populated from the message');
      const { rows: scopedChatQuery } = await db.query(
        `select message_id from public.chat_reactions where chat_id = $1`,
        [groupId],
      );
      assert.deepEqual(scopedChatQuery, [{ message_id: groupMessageId }]);
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userA]);
      const { rows: cannotDeleteOtherMemberReaction } = await db.query(
        `delete from public.chat_reactions where message_id = $1 returning user_id`,
        [groupMessageId],
      );
      assert.deepEqual(cannotDeleteOtherMemberReaction, [], 'members cannot remove another user’s reaction');
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userB]);
      await assert.rejects(
        db.query(
          `insert into public.chat_reactions (message_id, chat_id, user_id, reaction)
           values ($1, $2, $3, '👍')`,
          [groupMessageId, chatId, userB],
        ),
        /does not match message chat/i,
      );
      await db.exec('reset role');
      await assert.rejects(
        db.query(`update public.chat_reactions set chat_id = $1 where message_id = $2`, [
          chatId,
          groupMessageId,
        ]),
        /does not match message chat/i,
      );
      await db.exec('set role authenticated');
      const { rows: activeStatuses } = await db.query(
        `select body from public.get_group_statuses($1)`,
        [groupId],
      );
      assert.deepEqual(activeStatuses, [{ body: 'Welcome to the group' }]);
      const { rows: joinedGroup } = await db.query(
        `select public.join_group_by_invite($1) as chat_id`,
        [listedGroups[0].invite_code],
      );
      assert.equal(joinedGroup[0].chat_id, groupId);
      const { rows: participantProfile } = await db.query(
        `select username from public.profiles where id = $1`,
        [userA],
      );
      assert.deepEqual(participantProfile.map((row) => row.username), ['alex_one']);

      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userA]);
      await assert.rejects(
        db.query(`select public.leave_chat($1)`, [groupId]),
        /owner must transfer ownership/i,
      );
      await db.query(`select public.delete_message($1)`, [mediaMessage[0].id]);
      const { rows: deletedMediaMessage } = await db.query(
        `select body, media_path, deleted_at from public.messages where id = $1`,
        [mediaMessage[0].id],
      );
      assert.equal(deletedMediaMessage[0].body, '');
      assert.equal(deletedMediaMessage[0].media_path, null);
      assert.ok(deletedMediaMessage[0].deleted_at);
      await db.query(`delete from storage.objects where name = $1`, [`${chatId}/${userA}/image.png`]);
      const { rows: removedMedia } = await db.query(
        `select name from storage.objects where name = $1`,
        [`${chatId}/${userA}/image.png`],
      );
      assert.deepEqual(removedMedia, []);
      await db.query(`select public.delete_message($1)`, [inserted[0].id]);
      const { rows: softDeletedReplyTarget } = await db.query(
        `select reply.reply_to_id, target.deleted_at, target.body
         from public.messages reply
         join public.messages target on target.id = reply.reply_to_id
         where reply.id = $1`,
        [repliedMessage[0].id],
      );
      assert.equal(softDeletedReplyTarget[0].reply_to_id, inserted[0].id);
      assert.ok(softDeletedReplyTarget[0].deleted_at);
      assert.equal(softDeletedReplyTarget[0].body, '');
      await db.exec('reset role');
      await db.query(`delete from public.messages where id = $1`, [inserted[0].id]);
      const { rows: hardDeletedReplyTarget } = await db.query(
        `select reply_to_id from public.messages where id = $1`,
        [repliedMessage[0].id],
      );
      assert.deepEqual(hardDeletedReplyTarget, [{ reply_to_id: null }]);
      await db.exec('set role authenticated');
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userB]);
      await db.query(`select public.leave_chat($1)`, [createdChannelId]);
      const { rows: leftChannels } = await db.query(`select * from public.list_my_channels()`);
      assert.deepEqual(leftChannels, []);
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userA]);
      const { rows: kicked } = await db.query(
        `select * from public.run_group_command($1, '/kick @sam_two')`,
        [groupId],
      );
      assert.equal(kicked[0].ok, true);
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userB]);
      await assert.rejects(
        db.query(`select public.edit_message($1, 'Edited after removal')`, [memberMessageId]),
        /edit your own message/i,
      );
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userA]);
      await db.query(
        `update public.chat_member_settings set pinned = true
         where chat_id = $1 and user_id = $2`,
        [chatId, userA],
      );
      const { rows: pinnedChats } = await db.query(`select * from public.list_my_chats()`);
      assert.equal(pinnedChats.find((chat) => chat.chat_id === chatId).pinned, true);

      const profilePreviewGroup = (await db.query(
        `select public.create_group('Profile preview group', array['sam_two']) as chat_id`,
      )).rows[0].chat_id;
      const outsiderGroup = (await db.query(
        `select public.create_group('Not a common group', array['outside']) as chat_id`,
      )).rows[0].chat_id;
      const outsiderOnlyPath = `${outsiderGroup}/${userA}/outsider-only.png`;
      await db.query(
        `insert into public.messages (chat_id, sender_id, body, media_path, media_type, file_name)
         values ($1, $2, 'Secret from a non-common chat', $3, 'image/png', 'private.png')`,
        [outsiderGroup, userA, outsiderOnlyPath],
      );
      await db.query(
        `select * from public.run_group_command($1, '/kick @outside')`,
        [outsiderGroup],
      );
      await db.query(
        `insert into public.messages (chat_id, sender_id, body, media_path, media_type, file_name)
         values ($1, $2, 'Shared link https://example.test/plan', $3, 'image/png', 'shared.png')`,
        [profilePreviewGroup, userA, `${profilePreviewGroup}/${userA}/shared.png`],
      );
      await db.query(
        `insert into public.messages (chat_id, sender_id, body, media_path, media_type, file_name)
         values ($1, $2, '', $3, 'application/pdf', 'shared-notes.pdf')`,
        [profilePreviewGroup, userA, `${profilePreviewGroup}/${userA}/shared-notes.pdf`],
      );
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userB]);
      const { rows: firstPresenceTouch } = await db.query(
        `select public.touch_my_presence() as last_seen`,
      );
      const { rows: rateLimitedPresenceTouch } = await db.query(
        `select public.touch_my_presence() as last_seen`,
      );
      assert.deepEqual(
        rateLimitedPresenceTouch[0].last_seen,
        firstPresenceTouch[0].last_seen,
        'repeated presence updates within a minute retain the previous last-seen timestamp',
      );
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userA]);
      const { rows: previewRows } = await db.query(
        `select public.profile_preview($1) as preview`,
        [userB],
      );
      const preview = previewRows[0].preview;
      assert.deepEqual(Object.keys(preview).sort(), [
        'blocked', 'common_groups', 'last_seen_at', 'muted',
        'profile', 'shared_files', 'shared_links', 'shared_media',
      ]);
      assert.equal(preview.profile.username, 'sam_two');
      assert.ok(preview.last_seen_at);
      assert.deepEqual(preview.common_groups.map((group) => group.name), [
        'Pin permissions test',
        'Profile preview group',
      ]);
      assert.ok(preview.shared_media.some((item) => item.file_name === 'shared.png'));
      assert.ok(!preview.shared_media.some((item) => item.media_path === outsiderOnlyPath));
      assert.ok(preview.shared_links.some((item) => item.body.includes('https://example.test/plan')));
      assert.ok(preview.shared_files.some((item) => item.file_name === 'shared-notes.pdf'));
      const { rows: previewFunction } = await db.query(
        `select prosecdef, proconfig from pg_proc
         where oid = 'public.profile_preview(uuid)'::regprocedure`,
      );
      assert.equal(previewFunction[0].prosecdef, true, 'preview query must run behind server-side access checks');
      assert.ok(previewFunction[0].proconfig.includes('search_path=""'));
      await assert.rejects(
        db.query(`select public.profile_preview($1)`, [outsider]),
        /profile is not available/i,
      );
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userB]);
      await db.query(`select public.set_profile_preview_muted($1, true)`, [userA]);
      await db.query(`select public.set_profile_preview_blocked($1, true)`, [userA]);
      const { rows: mutedPreview } = await db.query(
        `select public.profile_preview($1) as preview`,
        [userA],
      );
      assert.equal(mutedPreview[0].preview.muted, true);
      assert.equal(mutedPreview[0].preview.blocked, true);
      const { rows: ownBlockState } = await db.query(
        `select public.is_profile_blocked_between($1, $2) as blocked`,
        [userA, userB],
      );
      assert.equal(ownBlockState[0].blocked, true);
      const { rows: unrelatedBlockState } = await db.query(
        `select public.is_profile_blocked_between($1, $2) as blocked`,
        [userA, outsider],
      );
      assert.equal(unrelatedBlockState[0].blocked, false);
      await assert.rejects(
        db.query(
          `insert into public.messages (chat_id, sender_id, body)
           values ($1, $2, 'Blocked direct message')`,
          [chatId, userB],
        ),
        /row-level security/i,
      );
      await db.query(`select public.set_profile_preview_blocked($1, false)`, [userA]);
      await db.query(
        `select public.report_profile_preview($1, $2, 'Group safety concern')`,
        [userA, profilePreviewGroup],
      );
      await assert.rejects(
        db.query(`select public.report_profile_preview($1, $2, '')`, [userA, outsiderGroup]),
        /shared group is required/i,
      );
      const { rows: otherUsersSettings } = await db.query(
        `select user_id from public.profile_preview_settings where user_id = $1`,
        [userA],
      );
      assert.deepEqual(otherUsersSettings, [], 'profile settings must remain private to their owner');
      await assert.rejects(
        db.query(`select * from public.profile_preview_reports`),
        /permission denied/i,
      );
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userA]);

      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [outsider]);
      const { rows: hiddenVoiceMessage } = await db.query(
        `select id from public.messages where id = $1`,
        [voiceMessage[0].id],
      );
      assert.deepEqual(hiddenVoiceMessage, [], 'voice-note metadata stays behind message membership RLS');
      const { rows: reactionsHiddenFromOutsider } = await db.query(
        `select message_id from public.chat_reactions where chat_id = $1`,
        [groupId],
      );
      assert.deepEqual(reactionsHiddenFromOutsider, [], 'non-members must not see chat-scoped reactions');
      const { rows: hiddenStatuses } = await db.query(
        `select body from public.list_contact_statuses() where author_id = $1`,
        [userA],
      );
      assert.deepEqual(hiddenStatuses, []);
      await assert.rejects(
        db.query(`select * from public.list_chat_reactions($1)`, [groupId]),
        /chat not found/i,
      );
      const { rows: outsiderChats } = await db.query(`select * from public.list_my_chats()`);
      assert.deepEqual(outsiderChats, []);
      const { rows: hiddenChat } = await db.query(
        `select id from public.chats where id = $1`,
        [chatId],
      );
      assert.deepEqual(hiddenChat, []);
      const { rows: privateProfiles } = await db.query(
        `select id from public.profiles where id in ($1, $2)`,
        [userA, userB],
      );
      assert.deepEqual(privateProfiles, []);
      const { rows: hiddenFromOutsider } = await db.query(
        `select body from public.messages where chat_id = $1`,
        [chatId],
      );
      assert.deepEqual(hiddenFromOutsider, []);
      await assert.rejects(
        db.query(
          `insert into public.messages (chat_id, sender_id, body)
           values ($1, $2, 'Should not be delivered')`,
          [chatId, outsider],
        ),
        /row-level security|not a member/i,
      );
      await db.exec('reset role');
      const expiryDownCronEnd = disappearingMessagesDownMigration.indexOf('\n$$;') + 4;
      assert.ok(expiryDownCronEnd > 0, 'rollback should unschedule the expiry job');
      await db.exec(disappearingMessagesDownMigration.slice(expiryDownCronEnd));
      const { rows: disabledExpiry } = await db.query(
        `select disappearing_after_seconds from public.chats where id = $1`,
        [chatId],
      );
      assert.deepEqual(disabledExpiry, [{ disappearing_after_seconds: 0 }]);
      const { rows: removedExpiryTrigger } = await db.query(
        `select tgname from pg_trigger where tgrelid = 'public.messages'::regclass
           and tgname = 'messages_set_expiration'`,
      );
      assert.deepEqual(removedExpiryTrigger, []);
      await db.exec(voiceNoteDownMigration);
      await db.exec(voiceNoteDownMigration);
      const { rows: removedVoiceColumns } = await db.query(
        `select column_name from information_schema.columns
         where table_schema = 'public' and table_name = 'messages'
           and column_name in ('voice_duration_ms', 'voice_waveform')`,
      );
      assert.deepEqual(removedVoiceColumns, []);
      await db.exec(messageSearchDownMigration);
      await db.exec(messageSearchDownMigration);
      const { rows: removedMessageSearch } = await db.query(
        `select column_name from information_schema.columns
         where table_schema = 'public' and table_name = 'messages' and column_name = 'search_vector'`,
      );
      assert.deepEqual(removedMessageSearch, []);
      await db.exec(readReceiptsDownMigration);
      await db.exec(readReceiptsDownMigration);
      const { rows: removedReadReceipts } = await db.query(
        `select to_regclass('public.message_reads') as receipts`,
      );
      assert.equal(removedReadReceipts[0].receipts, null);
      await db.exec(messageRepliesDownMigration);
      await db.exec(messageRepliesDownMigration);
      const { rows: removedReplyColumn } = await db.query(
        `select column_name from information_schema.columns
         where table_schema = 'public' and table_name = 'messages' and column_name = 'reply_to_id'`,
      );
      assert.deepEqual(removedReplyColumn, []);
      await db.exec(reactionScopingDownMigration);
      await db.exec(reactionScopingDownMigration);
      const { rows: removedReactionChatScope } = await db.query(
        `select column_name from information_schema.columns
         where table_schema = 'public' and table_name = 'chat_reactions' and column_name = 'chat_id'`,
      );
      assert.deepEqual(removedReactionChatScope, []);
      await db.exec(profilePreviewDownMigration);
      const { rows: removedProfilePreview } = await db.query(
        `select to_regclass('public.profile_preview_settings') as settings`,
      );
      assert.equal(removedProfilePreview[0].settings, null);
      const { rows: removedPresence } = await db.query(
        `select column_name from information_schema.columns
         where table_schema = 'public' and table_name = 'profiles' and column_name = 'last_seen_at'`,
      );
      assert.deepEqual(removedPresence, []);
    } finally {
      await db.close();
    }
  },
);
