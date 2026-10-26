alter table public.profiles
  add column if not exists avatar_path text;

alter table public.chats
  add column if not exists chat_type text not null default 'direct',
  add column if not exists channel_description text not null default '',
  add column if not exists channel_public boolean not null default true;

update public.chats
set chat_type = case when is_group then 'group' else 'direct' end;

alter table public.chats
  drop constraint if exists chats_check;

alter table public.chats
  add constraint chats_type_participants_check check (
    (chat_type = 'direct' and not is_group
      and direct_user_low is not null and direct_user_high is not null
      and direct_user_low < direct_user_high)
    or
    (chat_type in ('group', 'channel') and is_group
      and direct_user_low is null and direct_user_high is null)
  ),
  add constraint chats_chat_type_check
    check (chat_type in ('direct', 'group', 'channel'));

alter table public.messages
  add column if not exists media_path text,
  add column if not exists media_type text,
  add column if not exists file_name text,
  add column if not exists voice_note boolean not null default false,
  add column if not exists edited_at timestamptz,
  add column if not exists deleted_at timestamptz,
  add column if not exists forwarded_from uuid references public.messages (id) on delete set null;

alter table public.messages
  drop constraint if exists messages_body_check;

alter table public.messages
  add constraint messages_content_check check (
    (deleted_at is not null and body = '' and media_path is null)
    or
    (deleted_at is null and (
      char_length(body) between 1 and 4000
      or (char_length(body) = 0 and media_path is not null)
    ))
  );

grant insert (chat_id, sender_id, body, media_path, media_type, file_name, voice_note)
  on public.messages to authenticated;

create table if not exists public.status_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles (id) on delete cascade,
  body text not null default '',
  media_path text,
  media_type text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  check (char_length(body) <= 700),
  check (char_length(body) > 0 or media_path is not null)
);

create index if not exists status_posts_by_author_time
  on public.status_posts (author_id, expires_at desc);

alter table public.status_posts enable row level security;
revoke all on public.status_posts from public, anon, authenticated;
grant select on public.status_posts to authenticated;

drop policy if exists "Contacts can view active status posts" on public.status_posts;
create policy "Contacts can view active status posts"
  on public.status_posts for select to authenticated
  using (
    expires_at > now()
    and (
      author_id = (select auth.uid())
      or exists (
        select 1 from public.chats direct_chat
        where direct_chat.chat_type = 'direct'
          and (
            (direct_chat.direct_user_low = status_posts.author_id
              and direct_chat.direct_user_high = (select auth.uid()))
            or
            (direct_chat.direct_user_high = status_posts.author_id
              and direct_chat.direct_user_low = (select auth.uid()))
          )
      )
    )
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('profile-avatars', 'profile-avatars', true, 26214400,
    array['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  ('chat-media', 'chat-media', false, 26214400,
    array['image/jpeg', 'image/png', 'image/webp', 'image/gif',
      'video/mp4', 'video/webm', 'audio/webm', 'audio/ogg', 'audio/mp4',
      'audio/mpeg', 'audio/wav', 'audio/x-wav', 'application/pdf'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.is_public_channel(channel_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.chats chat
    where chat.id::text = channel_id
      and chat.chat_type = 'channel'
      and chat.channel_public
  );
$$;

drop policy if exists "Users upload their own Guildkeep avatars" on storage.objects;
create policy "Users upload their own Guildkeep avatars"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Users update their own Guildkeep avatars" on storage.objects;
create policy "Users update their own Guildkeep avatars"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Users delete their own Guildkeep avatars" on storage.objects;
create policy "Users delete their own Guildkeep avatars"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Chat members read chat media" on storage.objects;
create policy "Chat members read chat media"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'chat-media'
    and (
      exists (
        select 1
        from public.chats chat
        join public.chat_members member on member.chat_id = chat.id
        where chat.id::text = (storage.foldername(name))[1]
          and member.user_id = (select auth.uid())
        )
      or public.is_public_channel((storage.foldername(name))[1])
    )
  );

drop policy if exists "Chat members upload their own chat media" on storage.objects;
create policy "Chat members upload their own chat media"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'chat-media'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and exists (
      select 1
      from public.chats chat
      join public.chat_members member on member.chat_id = chat.id
      where chat.id::text = (storage.foldername(name))[1]
        and member.user_id = (select auth.uid())
        and (chat.chat_type <> 'channel' or member.role in ('owner', 'admin'))
    )
  );

drop policy if exists "Users delete their own chat uploads" on storage.objects;
create policy "Users delete their own chat uploads"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'chat-media'
    and exists (
      select 1
      from public.chats chat
      join public.chat_members member on member.chat_id = chat.id
      where chat.id::text = (storage.foldername(name))[1]
        and member.user_id = (select auth.uid())
        and (
          (storage.foldername(name))[2] = (select auth.uid())::text
          or (chat.chat_type in ('group', 'channel') and member.role in ('owner', 'admin'))
        )
    )
  );

drop policy if exists "Users delete their own status media" on storage.objects;
create policy "Users delete their own status media"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'chat-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (storage.foldername(name))[2] ~ '^[0-9a-fA-F-]{36}$'
  );

drop policy if exists "Contacts read status media" on storage.objects;
create policy "Contacts read status media"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'chat-media'
    and exists (
      select 1
      from public.status_posts status
      where status.id::text = (storage.foldername(name))[2]
        and status.author_id::text = (storage.foldername(name))[1]
        and status.expires_at > now()
        and (
          status.author_id = (select auth.uid())
          or exists (
            select 1
            from public.chats direct_chat
            where direct_chat.chat_type = 'direct'
              and (
                (direct_chat.direct_user_low = status.author_id
                  and direct_chat.direct_user_high = (select auth.uid()))
                or
                (direct_chat.direct_user_high = status.author_id
                  and direct_chat.direct_user_low = (select auth.uid()))
              )
          )
        )
    )
  );

drop policy if exists "Users upload their own status media" on storage.objects;
create policy "Users upload their own status media"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'chat-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (storage.foldername(name))[2] ~ '^[0-9a-fA-F-]{36}$'
  );

drop policy if exists "Users delete their own status media" on storage.objects;
create policy "Users delete their own status media"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'chat-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (storage.foldername(name))[2] ~ '^[0-9a-fA-F-]{36}$'
  );

grant update (avatar_path) on public.profiles to authenticated;

drop function if exists public.list_my_chats();
create function public.list_my_chats()
returns table (
  chat_id uuid,
  chat_name text,
  is_group boolean,
  pinned boolean,
  last_read_at timestamptz,
  last_message jsonb,
  unread_count integer,
  participants jsonb,
  created_at timestamptz,
  my_role text,
  invite_code text,
  group_locked boolean,
  announcement_mode boolean,
  slowmode_seconds integer,
  antilink_enabled boolean,
  group_rules text,
  chat_type text,
  chat_avatar_path text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  return query
    select
      chat.id,
      case when chat.chat_type = 'group' then chat.title
        else coalesce(other_profile.display_name, 'Direct chat') end,
      chat.is_group,
      settings.pinned,
      settings.last_read_at,
      (
        select jsonb_build_object(
          'id', message.id, 'body', message.body, 'sender_id', message.sender_id,
          'created_at', message.created_at
        )
        from public.messages message
        where message.chat_id = chat.id
        order by message.created_at desc, message.id desc
        limit 1
      ),
      (
        select count(*)::integer
        from public.messages message
        where message.chat_id = chat.id
          and message.sender_id <> (select auth.uid())
          and message.created_at > settings.last_read_at
      ),
      (
        select coalesce(
          jsonb_agg(jsonb_build_object(
            'id', profile.id, 'username', profile.username,
            'display_name', profile.display_name, 'avatar_path', profile.avatar_path,
            'role', member.role
          ) order by profile.display_name),
          '[]'::jsonb
        )
        from public.chat_members member
        join public.profiles profile on profile.id = member.user_id
        where member.chat_id = chat.id and member.user_id <> (select auth.uid())
      ),
      chat.created_at,
      current_member.role,
      case when chat.chat_type = 'group' then chat.invite_code else null end,
      chat.group_locked,
      chat.announcement_mode,
      chat.slowmode_seconds,
      chat.antilink_enabled,
      chat.group_rules,
      chat.chat_type,
      case when chat.chat_type = 'direct' then other_profile.avatar_path else null end
    from public.chats chat
    join public.chat_members current_member
      on current_member.chat_id = chat.id and current_member.user_id = (select auth.uid())
    join public.chat_member_settings settings
      on settings.chat_id = chat.id and settings.user_id = (select auth.uid())
    left join public.profiles other_profile on other_profile.id = case
      when chat.direct_user_low = (select auth.uid()) then chat.direct_user_high
      else chat.direct_user_low end
    where chat.chat_type in ('direct', 'group')
    order by settings.pinned desc,
      coalesce(
        (select max(message.created_at) from public.messages message where message.chat_id = chat.id),
        chat.created_at
      ) desc;
end;
$$;

create or replace function public.update_my_profile(
  new_display_name text,
  new_bio text,
  new_avatar_path text
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  updated_profile public.profiles;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;
  if new_display_name is null or char_length(btrim(new_display_name)) not between 1 and 60 then
    raise exception 'Display name must be between 1 and 60 characters';
  end if;
  if char_length(coalesce(new_bio, '')) > 160 then
    raise exception 'Bio must be 160 characters or less';
  end if;
  if new_avatar_path is not null and (
    new_avatar_path !~ ('^' || current_user_id::text || '/[^/]+$')
  ) then
    raise exception 'Invalid profile picture path';
  end if;

  update public.profiles
  set display_name = btrim(new_display_name),
      bio = btrim(coalesce(new_bio, '')),
      avatar_path = coalesce(new_avatar_path, avatar_path)
  where id = current_user_id
  returning * into updated_profile;
  return updated_profile;
end;
$$;

create or replace function public.search_profiles_with_avatars(search_term text)
returns table (id uuid, username text, display_name text, avatar_path text)
language sql
stable
security definer
set search_path = ''
as $$
  select result.id, result.username, result.display_name, profile.avatar_path
  from public.search_profiles(search_term) result
  join public.profiles profile on profile.id = result.id;
$$;

create or replace function public.create_group(group_title text, member_usernames text[] default '{}')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  new_chat_id uuid;
  requested_count integer := coalesce(cardinality(member_usernames), 0);
  found_count integer;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if group_title is null or char_length(btrim(group_title)) not between 2 and 80 then
    raise exception 'Group name must be between 2 and 80 characters';
  end if;
  if requested_count > 49 then raise exception 'A group can have at most 50 members'; end if;
  if exists (
    select 1 from unnest(coalesce(member_usernames, '{}')) username
    where username !~ '^[A-Za-z0-9_]{3,24}$'
  ) then raise exception 'One or more usernames are invalid'; end if;

  select count(distinct profile.id)::integer into found_count
  from public.profiles profile
  where profile.username = any(
    array(select distinct lower(username) from unnest(coalesce(member_usernames, '{}')) username)
  ) and profile.id <> current_user_id;
  if found_count <> (
    select count(distinct lower(username))
    from unnest(coalesce(member_usernames, '{}')) username
  ) then raise exception 'One or more usernames were not found'; end if;

  insert into public.chats (title, is_group, chat_type, invite_code)
  values (btrim(group_title), true, 'group', replace(gen_random_uuid()::text, '-', ''))
  returning id into new_chat_id;
  insert into public.chat_members (chat_id, user_id, role)
  values (new_chat_id, current_user_id, 'owner');
  insert into public.chat_members (chat_id, user_id, role)
  select new_chat_id, profile.id, 'member'
  from public.profiles profile
  where profile.username = any(
    array(select distinct lower(username) from unnest(coalesce(member_usernames, '{}')) username)
  ) and profile.id <> current_user_id
  on conflict do nothing;
  insert into public.chat_member_settings (chat_id, user_id)
  select new_chat_id, member.user_id from public.chat_members member
  where member.chat_id = new_chat_id;
  insert into public.group_admin_audit (chat_id, actor_id, command, detail)
  values (new_chat_id, current_user_id, 'create', btrim(group_title));
  return new_chat_id;
end;
$$;

create or replace function public.create_channel(channel_title text, channel_about text default '')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  new_chat_id uuid;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if channel_title is null or char_length(btrim(channel_title)) not between 2 and 80 then
    raise exception 'Channel name must be between 2 and 80 characters';
  end if;
  if char_length(coalesce(channel_about, '')) > 1000 then
    raise exception 'Channel description must be 1000 characters or less';
  end if;
  insert into public.chats (title, is_group, chat_type, channel_description, channel_public, invite_code)
  values (
    btrim(channel_title), true, 'channel', btrim(coalesce(channel_about, '')), true,
    replace(gen_random_uuid()::text, '-', '')
  )
  returning id into new_chat_id;
  insert into public.chat_members (chat_id, user_id, role)
  values (new_chat_id, current_user_id, 'owner');
  insert into public.chat_member_settings (chat_id, user_id)
  values (new_chat_id, current_user_id);
  return new_chat_id;
end;
$$;

create or replace function public.list_my_channels()
returns table (
  chat_id uuid, chat_name text, description text, role text,
  invite_code text, subscriber_count integer, last_message jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select chat.id, chat.title, chat.channel_description, member.role, chat.invite_code,
    (select count(*)::integer from public.chat_members subscriber where subscriber.chat_id = chat.id),
    (select jsonb_build_object('body', message.body, 'created_at', message.created_at)
      from public.messages message where message.chat_id = chat.id
      order by message.created_at desc, message.id desc limit 1)
  from public.chats chat
  join public.chat_members member on member.chat_id = chat.id and member.user_id = (select auth.uid())
  where chat.chat_type = 'channel'
  order by coalesce(
    (select max(message.created_at) from public.messages message where message.chat_id = chat.id),
    chat.created_at
  ) desc;
$$;

create or replace function public.discover_channels(search_text text default '')
returns table (
  chat_id uuid, chat_name text, description text,
  subscriber_count integer, is_subscribed boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select chat.id, chat.title, chat.channel_description,
    (select count(*)::integer from public.chat_members member where member.chat_id = chat.id),
    exists (
      select 1 from public.chat_members member
      where member.chat_id = chat.id and member.user_id = (select auth.uid())
    )
  from public.chats chat
  where chat.chat_type = 'channel' and chat.channel_public
    and (
      coalesce(btrim(search_text), '') = ''
      or chat.title ilike '%' || replace(replace(replace(btrim(search_text), '!', '!!'), '%', '!%'), '_', '!_') || '%' escape '!'
      or chat.channel_description ilike '%' || replace(replace(replace(btrim(search_text), '!', '!!'), '%', '!%'), '_', '!_') || '%' escape '!'
    )
  order by chat.title
  limit 100;
$$;

create or replace function public.subscribe_to_channel(target_channel_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.chats channel
    where channel.id = target_channel_id and channel.chat_type = 'channel' and channel.channel_public
  ) then raise exception 'Channel not found'; end if;
  insert into public.chat_members (chat_id, user_id, role)
  values (target_channel_id, current_user_id, 'member')
  on conflict do nothing;
  insert into public.chat_member_settings (chat_id, user_id)
  values (target_channel_id, current_user_id)
  on conflict do nothing;
  return target_channel_id;
end;
$$;

create or replace function public.join_channel_by_invite(invite_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_channel_id uuid;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  select channel.id into target_channel_id from public.chats channel
  where channel.chat_type = 'channel' and channel.invite_code = invite_token;
  if target_channel_id is null then raise exception 'This channel invite is no longer valid'; end if;
  insert into public.chat_members (chat_id, user_id, role)
  values (target_channel_id, current_user_id, 'member')
  on conflict do nothing;
  insert into public.chat_member_settings (chat_id, user_id)
  values (target_channel_id, current_user_id)
  on conflict do nothing;
  return target_channel_id;
end;
$$;

create or replace function public.create_status(
  status_id uuid,
  status_text text,
  status_media_path text default null,
  status_media_type text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if char_length(coalesce(status_text, '')) > 700 then
    raise exception 'Status text must be 700 characters or less';
  end if;
  if char_length(coalesce(status_text, '')) = 0 and status_media_path is null then
    raise exception 'Add text or media to your status';
  end if;
  if status_media_path is null and status_media_type is not null then
    raise exception 'Status media metadata requires a media file';
  end if;
  if status_media_path is not null and (
    status_media_path !~ ('^' || current_user_id::text || '/' || status_id::text || '/[^/]+$')
    or status_media_type is null
    or status_media_type not in ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm')
  ) then
    raise exception 'Invalid status media';
  end if;
  insert into public.status_posts (id, author_id, body, media_path, media_type)
  values (status_id, current_user_id, coalesce(status_text, ''), status_media_path, status_media_type);
  return status_id;
end;
$$;

create or replace function public.list_contact_statuses()
returns table (
  id uuid, author_id uuid, author_name text, username text, avatar_path text,
  body text, media_path text, media_type text, created_at timestamptz, expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select status.id, profile.id, profile.display_name, profile.username, profile.avatar_path,
    status.body, status.media_path, status.media_type, status.created_at, status.expires_at
  from public.status_posts status
  join public.profiles profile on profile.id = status.author_id
  where status.expires_at > now()
    and (
      status.author_id = (select auth.uid())
      or exists (
        select 1 from public.chats direct_chat
        where direct_chat.chat_type = 'direct'
          and (
            (direct_chat.direct_user_low = status.author_id
              and direct_chat.direct_user_high = (select auth.uid()))
            or
            (direct_chat.direct_user_high = status.author_id
              and direct_chat.direct_user_low = (select auth.uid()))
          )
      )
    )
  order by status.created_at desc
  limit 100;
$$;

create or replace function public.delete_message(target_message_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  message_row public.messages;
  chat_row public.chats;
  actor_role text;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  select message.* into message_row from public.messages message
  where message.id = target_message_id for update;
  if message_row.id is null then raise exception 'Message not found'; end if;
  select chat.* into chat_row from public.chats chat where chat.id = message_row.chat_id;
  select member.role into actor_role from public.chat_members member
  where member.chat_id = message_row.chat_id and member.user_id = current_user_id;
  if actor_role is null then raise exception 'Message not found'; end if;
  if message_row.sender_id <> current_user_id and not (
    chat_row.chat_type in ('group', 'channel') and actor_role in ('owner', 'admin')
  ) then raise exception 'You cannot delete this message'; end if;
  update public.messages set body = '', media_path = null, media_type = null,
    file_name = null, voice_note = false, deleted_at = now()
  where id = target_message_id;
  delete from public.chat_reactions where message_id = target_message_id;
end;
$$;

create or replace function public.edit_message(target_message_id uuid, replacement_body text)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  updated_message public.messages;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if char_length(btrim(coalesce(replacement_body, ''))) not between 1 and 4000 then
    raise exception 'Edited message must be between 1 and 4000 characters';
  end if;
  update public.messages as message
  set body = btrim(replacement_body), edited_at = now()
  where message.id = target_message_id and message.sender_id = current_user_id
    and message.deleted_at is null
    and message.created_at > now() - interval '15 minutes'
    and exists (
      select 1 from public.chat_members member
      where member.chat_id = message.chat_id and member.user_id = current_user_id
    )
  returning * into updated_message;
  if updated_message.id is null then
    raise exception 'You can edit your own message for 15 minutes after sending it';
  end if;
  return updated_message;
end;
$$;

create or replace function public.forward_message(
  source_message_id uuid,
  destination_chat_id uuid,
  destination_media_path text default null
)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  source_message public.messages;
  target_chat public.chats;
  forwarded public.messages;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  select message.* into source_message from public.messages message
  where message.id = source_message_id and message.deleted_at is null;
  if source_message.id is null or not (
    exists (
      select 1 from public.chat_members member
      where member.chat_id = source_message.chat_id and member.user_id = current_user_id
    )
    or exists (
      select 1 from public.chats channel
      where channel.id = source_message.chat_id
        and channel.chat_type = 'channel' and channel.channel_public
    )
  ) then raise exception 'Source message not found'; end if;
  select chat.* into target_chat from public.chats chat
  join public.chat_members member on member.chat_id = chat.id and member.user_id = current_user_id
  where chat.id = destination_chat_id;
  if target_chat.id is null then raise exception 'Destination chat not found'; end if;
  if target_chat.chat_type = 'channel' and not exists (
    select 1 from public.chat_members member
    where member.chat_id = destination_chat_id and member.user_id = current_user_id
      and member.role in ('owner', 'admin')
  ) then raise exception 'Only channel admins can publish forwarded messages'; end if;
  if source_message.media_path is not null and (
    destination_media_path is null
    or destination_media_path !~ ('^' || destination_chat_id::text || '/' || current_user_id::text || '/[^/]+$')
  ) then raise exception 'Forwarded media must be copied into the destination chat'; end if;

  insert into public.messages (
    chat_id, sender_id, body, media_path, media_type, file_name, voice_note, forwarded_from
  )
  values (
    destination_chat_id, current_user_id, source_message.body, destination_media_path,
    source_message.media_type, source_message.file_name, source_message.voice_note, source_message.id
  )
  returning * into forwarded;
  return forwarded;
end;
$$;

create or replace function public.enforce_group_message_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  chat_row public.chats;
  sender_role text;
  last_message_at timestamptz;
begin
  select chat.* into chat_row
  from public.chats chat where chat.id = new.chat_id for update;
  if chat_row.id is null then raise exception 'Chat not found'; end if;
  select member.role into sender_role from public.chat_members member
  where member.chat_id = new.chat_id and member.user_id = new.sender_id;
  if sender_role is null then raise exception 'You are not a member of this chat'; end if;

  if chat_row.chat_type = 'channel' then
    if sender_role not in ('owner', 'admin') then
      raise exception 'Only channel admins can publish';
    end if;
  elsif chat_row.chat_type = 'group' then
    if (chat_row.group_locked or chat_row.announcement_mode)
      and sender_role not in ('owner', 'admin')
    then raise exception 'Only group admins can send messages right now'; end if;
    if chat_row.antilink_enabled and sender_role = 'member'
      and new.body ~* '(https?://|www[.]|[a-z0-9-]+[.][a-z]{2,24}([/?#:]|$))'
    then raise exception 'Links are disabled in this group'; end if;
    if chat_row.slowmode_seconds > 0 and sender_role = 'member' then
      select max(message.created_at) into last_message_at from public.messages message
      where message.chat_id = new.chat_id and message.sender_id = new.sender_id;
      if last_message_at is not null
        and last_message_at > now() - make_interval(secs => chat_row.slowmode_seconds)
      then raise exception 'Slow mode is on. Please wait before sending another message'; end if;
    end if;
  end if;

  if new.media_path is not null and (
    new.media_path !~ ('^' || new.chat_id::text || '/' || new.sender_id::text || '/[^/]+$')
    or new.media_type is null
    or new.media_type not in (
      'image/jpeg', 'image/png', 'image/webp', 'image/gif',
      'video/mp4', 'video/webm',
      'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-wav',
      'application/pdf'
    )
    or new.file_name is null
    or char_length(new.file_name) > 255
  ) then raise exception 'Invalid chat media path or metadata'; end if;
  if new.media_path is null and (new.media_type is not null or new.file_name is not null or new.voice_note) then
    raise exception 'Media metadata requires a media file';
  end if;
  if new.voice_note and new.media_type not like 'audio/%' then
    raise exception 'Voice notes must use an audio file';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_group_message_rules on public.messages;
create trigger enforce_group_message_rules
  before insert on public.messages
  for each row execute function public.enforce_group_message_rules();

create or replace function public.reject_channel_group_commands()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.chat_type = 'channel'
    and new.group_updated_at is distinct from old.group_updated_at
  then
    raise exception 'Group commands can only be used in groups';
  end if;
  return new;
end;
$$;

drop trigger if exists reject_channel_group_commands on public.chats;
create trigger reject_channel_group_commands
  before update on public.chats
  for each row execute function public.reject_channel_group_commands();

drop policy if exists "Members can view chat messages" on public.messages;
create policy "Members can view chat messages"
  on public.messages for select to authenticated
  using (
    exists (
      select 1 from public.chat_members member
      where member.chat_id = public.messages.chat_id and member.user_id = (select auth.uid())
    )
    or public.is_public_channel(public.messages.chat_id::text)
  );

drop policy if exists "Members can send their own messages" on public.messages;
create policy "Members can send their own messages"
  on public.messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and exists (
      select 1
      from public.chat_members member
      join public.chats chat on chat.id = member.chat_id
      where member.chat_id = public.messages.chat_id
        and member.user_id = (select auth.uid())
        and (chat.chat_type <> 'channel' or member.role in ('owner', 'admin'))
    )
  );

alter table public.chats replica identity full;
alter table public.chat_members replica identity full;
alter table public.messages replica identity full;
alter table public.status_posts replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'status_posts'
  ) then
    alter publication supabase_realtime add table public.status_posts;
  end if;
end;
$$;

revoke all on function public.list_my_chats() from public, anon;
revoke all on function public.update_my_profile(text, text) from public, anon;
revoke all on function public.update_my_profile(text, text, text) from public, anon;
revoke all on function public.search_profiles_with_avatars(text) from public, anon;
revoke all on function public.create_group(text, text[]) from public, anon;
revoke all on function public.create_channel(text, text) from public, anon;
revoke all on function public.list_my_channels() from public, anon;
revoke all on function public.discover_channels(text) from public, anon;
revoke all on function public.subscribe_to_channel(uuid) from public, anon;
revoke all on function public.join_channel_by_invite(text) from public, anon;
revoke all on function public.create_status(uuid, text, text, text) from public, anon;
revoke all on function public.list_contact_statuses() from public, anon;
revoke all on function public.delete_message(uuid) from public, anon;
revoke all on function public.edit_message(uuid, text) from public, anon;
revoke all on function public.forward_message(uuid, uuid, text) from public, anon;
revoke all on function public.is_public_channel(text) from public, anon;
grant execute on function public.list_my_chats() to authenticated;
grant execute on function public.update_my_profile(text, text, text) to authenticated;
grant execute on function public.search_profiles_with_avatars(text) to authenticated;
grant execute on function public.create_group(text, text[]) to authenticated;
grant execute on function public.create_channel(text, text) to authenticated;
grant execute on function public.list_my_channels() to authenticated;
grant execute on function public.discover_channels(text) to authenticated;
grant execute on function public.subscribe_to_channel(uuid) to authenticated;
grant execute on function public.join_channel_by_invite(text) to authenticated;
grant execute on function public.create_status(uuid, text, text, text) to authenticated;
grant execute on function public.list_contact_statuses() to authenticated;
grant execute on function public.delete_message(uuid) to authenticated;
grant execute on function public.edit_message(uuid, text) to authenticated;
grant execute on function public.forward_message(uuid, uuid, text) to authenticated;
grant execute on function public.is_public_channel(text) to authenticated;
