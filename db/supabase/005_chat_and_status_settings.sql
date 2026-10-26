alter table public.chats
  add column if not exists avatar_path text,
  add column if not exists group_description text not null default '';

alter table public.profiles
  add column if not exists status_visibility text not null default 'contacts';

alter table public.profiles
  drop constraint if exists profiles_status_visibility_check;

alter table public.profiles
  add constraint profiles_status_visibility_check
    check (status_visibility in ('contacts', 'only_me'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-avatars', 'chat-avatars', true, 26214400,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Anyone can view public chat pictures" on storage.objects;
create policy "Anyone can view public chat pictures"
  on storage.objects for select to public
  using (bucket_id = 'chat-avatars');

drop policy if exists "Chat admins upload chat pictures" on storage.objects;
create policy "Chat admins upload chat pictures"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'chat-avatars'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and exists (
      select 1
      from public.chats chat
      join public.chat_members member on member.chat_id = chat.id
      where chat.id::text = (storage.foldername(name))[1]
        and chat.chat_type in ('group', 'channel')
        and member.user_id = (select auth.uid())
        and member.role in ('owner', 'admin')
    )
  );

drop policy if exists "Chat admins delete chat pictures" on storage.objects;
create policy "Chat admins delete chat pictures"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'chat-avatars'
    and exists (
      select 1
      from public.chats chat
      join public.chat_members member on member.chat_id = chat.id
      where chat.id::text = (storage.foldername(name))[1]
        and chat.chat_type in ('group', 'channel')
        and member.user_id = (select auth.uid())
        and member.role in ('owner', 'admin')
    )
  );

create or replace function public.update_chat_settings(
  target_chat_id uuid,
  new_title text,
  new_description text,
  new_avatar_path text default null,
  clear_avatar boolean default false,
  new_channel_public boolean default null,
  new_group_locked boolean default null,
  new_announcement_mode boolean default null,
  new_slowmode_seconds integer default null,
  new_antilink_enabled boolean default null,
  new_group_rules text default null
)
returns public.chats
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  chat_row public.chats;
  actor_role text;
  updated_chat public.chats;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;

  select chat.* into chat_row
  from public.chats chat
  join public.chat_members member on member.chat_id = chat.id
  where chat.id = target_chat_id and member.user_id = current_user_id
    and chat.chat_type in ('group', 'channel')
  for update of chat;
  if chat_row.id is null then raise exception 'Group or channel not found'; end if;

  select member.role into actor_role
  from public.chat_members member
  where member.chat_id = target_chat_id and member.user_id = current_user_id;
  if actor_role not in ('owner', 'admin') then
    raise exception 'Only group or channel admins can change these settings';
  end if;
  if new_title is null or char_length(btrim(new_title)) not between 2 and 80 then
    raise exception 'Name must be between 2 and 80 characters';
  end if;
  if char_length(coalesce(new_description, '')) > 1000 then
    raise exception 'Description must be 1000 characters or less';
  end if;
  if new_group_rules is not null and char_length(new_group_rules) > 2000 then
    raise exception 'Group rules must be 2000 characters or less';
  end if;
  if new_slowmode_seconds is not null and new_slowmode_seconds not between 0 and 86400 then
    raise exception 'Slow mode must be between 0 and 86400 seconds';
  end if;
  if new_avatar_path is not null and (
    new_avatar_path !~ (
      '^' || target_chat_id::text || '/' || current_user_id::text || '/[^/]+$'
    )
  ) then
    raise exception 'Invalid group or channel picture path';
  end if;

  update public.chats
  set title = btrim(new_title),
      group_description = case when chat_row.chat_type = 'group'
        then btrim(coalesce(new_description, '')) else group_description end,
      channel_description = case when chat_row.chat_type = 'channel'
        then btrim(coalesce(new_description, '')) else channel_description end,
      avatar_path = case
        when clear_avatar then null
        else coalesce(new_avatar_path, avatar_path)
      end,
      channel_public = case
        when chat_row.chat_type = 'channel' and new_channel_public is not null
          then new_channel_public
        else channel_public
      end,
      group_locked = case
        when chat_row.chat_type = 'group' and new_group_locked is not null
          then new_group_locked
        else group_locked
      end,
      announcement_mode = case
        when chat_row.chat_type = 'group' and new_announcement_mode is not null
          then new_announcement_mode
        else announcement_mode
      end,
      slowmode_seconds = case
        when chat_row.chat_type = 'group' and new_slowmode_seconds is not null
          then new_slowmode_seconds
        else slowmode_seconds
      end,
      antilink_enabled = case
        when chat_row.chat_type = 'group' and new_antilink_enabled is not null
          then new_antilink_enabled
        else antilink_enabled
      end,
      group_rules = case
        when chat_row.chat_type = 'group' and new_group_rules is not null
          then btrim(new_group_rules)
        else group_rules
      end,
      group_updated_at = case
        when chat_row.chat_type = 'group' then now()
        else group_updated_at
      end
  where id = target_chat_id
  returning * into updated_chat;
  return updated_chat;
end;
$$;

create or replace function public.leave_chat(target_chat_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  actor_role text;
  chat_kind text;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  select chat.chat_type, member.role into chat_kind, actor_role
  from public.chats chat
  join public.chat_members member on member.chat_id = chat.id
  where chat.id = target_chat_id and member.user_id = current_user_id;
  if actor_role is null or chat_kind not in ('group', 'channel') then
    raise exception 'Group or channel not found';
  end if;
  if actor_role = 'owner' then
    raise exception 'The owner must transfer ownership before leaving';
  end if;
  delete from public.chat_members
  where chat_id = target_chat_id and user_id = current_user_id;
end;
$$;

create or replace function public.update_status_visibility(new_visibility text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if new_visibility not in ('contacts', 'only_me') then
    raise exception 'Choose contacts or only me for status visibility';
  end if;
  update public.profiles set status_visibility = new_visibility
  where id = current_user_id;
  return new_visibility;
end;
$$;

create or replace function public.can_view_status(author_id uuid, status_expiry timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select status_expiry > now()
    and (
      author_id = (select auth.uid())
      or (
        exists (
          select 1 from public.profiles profile
          where profile.id = author_id and profile.status_visibility = 'contacts'
        )
        and exists (
          select 1 from public.chats direct_chat
          where direct_chat.chat_type = 'direct'
            and (
              (direct_chat.direct_user_low = author_id
                and direct_chat.direct_user_high = (select auth.uid()))
              or
              (direct_chat.direct_user_high = author_id
                and direct_chat.direct_user_low = (select auth.uid()))
            )
        )
      )
    );
$$;

drop policy if exists "Contacts can view active status posts" on public.status_posts;
create policy "Contacts can view active status posts"
  on public.status_posts for select to authenticated
  using (public.can_view_status(author_id, expires_at));

drop policy if exists "Contacts read status media" on storage.objects;
create policy "Contacts read status media"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'chat-media'
    and exists (
      select 1 from public.status_posts status
      where status.id::text = (storage.foldername(name))[2]
        and status.author_id::text = (storage.foldername(name))[1]
        and public.can_view_status(status.author_id, status.expires_at)
    )
  );

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
  where public.can_view_status(status.author_id, status.expires_at)
  order by status.created_at desc
  limit 100;
$$;

create or replace function public.delete_status(target_status_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  removed_media_path text;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  delete from public.status_posts status
  where status.id = target_status_id and status.author_id = current_user_id
  returning status.media_path into removed_media_path;
  if not found then raise exception 'Status not found or you cannot delete it'; end if;
  return removed_media_path;
end;
$$;

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
  chat_avatar_path text,
  group_description text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
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
      case when chat.chat_type = 'direct' then other_profile.avatar_path else chat.avatar_path end,
      chat.group_description
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

drop function if exists public.list_my_channels();
create function public.list_my_channels()
returns table (
  chat_id uuid, chat_name text, description text, role text,
  invite_code text, subscriber_count integer, last_message jsonb,
  chat_avatar_path text, channel_public boolean
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
      order by message.created_at desc, message.id desc limit 1),
    chat.avatar_path, chat.channel_public
  from public.chats chat
  join public.chat_members member on member.chat_id = chat.id and member.user_id = (select auth.uid())
  where chat.chat_type = 'channel'
  order by coalesce(
    (select max(message.created_at) from public.messages message where message.chat_id = chat.id),
    chat.created_at
  ) desc;
$$;

drop function if exists public.discover_channels(text);
create function public.discover_channels(search_text text default '')
returns table (
  chat_id uuid, chat_name text, description text,
  subscriber_count integer, is_subscribed boolean, chat_avatar_path text
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
    ),
    chat.avatar_path
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

revoke all on function public.update_chat_settings(uuid, text, text, text, boolean, boolean, boolean, boolean, integer, boolean, text) from public, anon;
revoke all on function public.leave_chat(uuid) from public, anon;
revoke all on function public.update_status_visibility(text) from public, anon;
revoke all on function public.can_view_status(uuid, timestamptz) from public, anon;
revoke all on function public.list_contact_statuses() from public, anon;
revoke all on function public.delete_status(uuid) from public, anon;
revoke all on function public.list_my_chats() from public, anon;
revoke all on function public.list_my_channels() from public, anon;
revoke all on function public.discover_channels(text) from public, anon;

grant execute on function public.update_chat_settings(uuid, text, text, text, boolean, boolean, boolean, boolean, integer, boolean, text) to authenticated;
grant execute on function public.leave_chat(uuid) to authenticated;
grant execute on function public.update_status_visibility(text) to authenticated;
grant execute on function public.can_view_status(uuid, timestamptz) to authenticated;
grant execute on function public.list_contact_statuses() to authenticated;
grant execute on function public.delete_status(uuid) to authenticated;
grant execute on function public.list_my_chats() to authenticated;
grant execute on function public.list_my_channels() to authenticated;
grant execute on function public.discover_channels(text) to authenticated;
