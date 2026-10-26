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
        create schema auth;
        create schema storage;
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
        alter table storage.objects enable row level security;
        create function storage.foldername(object_name text) returns text[]
          language sql immutable
          as $$ select (string_to_array(object_name, '/'))[1:array_length(string_to_array(object_name, '/'), 1) - 1] $$;
        grant usage on schema auth to authenticated;
        grant execute on function auth.uid() to authenticated;
        grant usage on schema storage to authenticated;
        grant all on storage.buckets, storage.objects to authenticated;
        grant execute on function storage.foldername(text) to authenticated;
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
         values ($1, $2, 'Hello from Alex')
         returning id`,
        [chatId, userA],
      );
      assert.ok(inserted[0].id);
      const { rows: mediaMessage } = await db.query(
        `insert into public.messages (
           chat_id, sender_id, body, media_path, media_type, file_name
         ) values ($1, $2, '', $3, 'image/png', 'image.png')
         returning id`,
        [chatId, userA, `${chatId}/${userA}/image.png`],
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
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userA]);
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
      const { rows: groupMessage } = await db.query(
        `insert into public.messages (chat_id, sender_id, body)
         values ($1, $2, 'A group hello') returning id`,
        [groupId, userA],
      );
      const groupMessageId = groupMessage[0].id;
      const { rows: postedStatus } = await db.query(
        `select * from public.run_group_command($1, '/status Welcome to the group')`,
        [groupId],
      );
      assert.equal(postedStatus[0].ok, true);

      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userB]);
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
      assert.deepEqual(visibleToMember.map((row) => row.body), ['Hello from Alex', '', 'Edited message']);
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
      assert.equal(pinnedChats[0].pinned, true);

      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [outsider]);
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
    } finally {
      await db.close();
    }
  },
);
