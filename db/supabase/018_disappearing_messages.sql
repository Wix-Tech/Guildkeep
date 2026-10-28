create extension if not exists pg_cron;

alter table public.chats
  add column if not exists disappearing_after_seconds integer not null default 0
    check (disappearing_after_seconds in (0, 86400, 604800, 7776000));

alter table public.messages
  add column if not exists expires_at timestamptz;

create index if not exists messages_by_expiry
  on public.messages (expires_at)
  where expires_at is not null;

create or replace function public.set_message_expiration()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  timer_seconds integer;
begin
  select chat.disappearing_after_seconds into timer_seconds
  from public.chats chat
  where chat.id = new.chat_id;

  new.expires_at := case
    when timer_seconds > 0 then new.created_at + timer_seconds * interval '1 second'
    else null
  end;
  return new;
end;
$$;

revoke all on function public.set_message_expiration() from public, anon, authenticated;

drop trigger if exists messages_set_expiration on public.messages;
create trigger messages_set_expiration
  before insert on public.messages
  for each row execute function public.set_message_expiration();

drop policy if exists "Members can view chat messages" on public.messages;
create policy "Members can view chat messages"
  on public.messages for select to authenticated
  using (
    (expires_at is null or expires_at > now())
    and (
      exists (
        select 1 from public.chat_members member
        where member.chat_id = public.messages.chat_id and member.user_id = (select auth.uid())
      )
      or public.is_public_channel(public.messages.chat_id::text)
    )
  );

create or replace function public.get_chat_disappearing_timer(target_chat_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  timer_seconds integer;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  select chat.disappearing_after_seconds into timer_seconds
  from public.chats chat
  join public.chat_members member on member.chat_id = chat.id
  where chat.id = target_chat_id
    and member.user_id = (select auth.uid())
    and chat.chat_type in ('direct', 'group');
  if not found then raise exception 'Direct chat or group not found'; end if;
  return timer_seconds;
end;
$$;

create or replace function public.set_chat_disappearing_timer(
  target_chat_id uuid,
  new_timer_seconds integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  chat_kind text;
  actor_role text;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if new_timer_seconds is null or new_timer_seconds not in (0, 86400, 604800, 7776000) then
    raise exception 'Choose Off, 24 hours, 7 days, or 90 days';
  end if;

  select chat.chat_type, member.role into chat_kind, actor_role
  from public.chats chat
  join public.chat_members member on member.chat_id = chat.id
  where chat.id = target_chat_id and member.user_id = current_user_id
  for update of chat;
  if not found or chat_kind not in ('direct', 'group') then
    raise exception 'Direct chat or group not found';
  end if;
  if chat_kind = 'group' and actor_role not in ('owner', 'admin') then
    raise exception 'Only group admins can change the disappearing-message timer';
  end if;

  update public.chats
  set disappearing_after_seconds = new_timer_seconds
  where id = target_chat_id;
  return new_timer_seconds;
end;
$$;

revoke all on function public.get_chat_disappearing_timer(uuid) from public, anon;
revoke all on function public.set_chat_disappearing_timer(uuid, integer) from public, anon;
grant execute on function public.get_chat_disappearing_timer(uuid) to authenticated;
grant execute on function public.set_chat_disappearing_timer(uuid, integer) to authenticated;

create table if not exists public.expired_message_media (
  media_path text primary key,
  chat_id uuid not null references public.chats (id) on delete cascade,
  expired_at timestamptz not null default now()
);

create index if not exists expired_message_media_by_chat_time
  on public.expired_message_media (chat_id, expired_at);

alter table public.expired_message_media enable row level security;
revoke all on public.expired_message_media from public, anon, authenticated;
grant select, delete on public.expired_message_media to service_role;

create or replace function public.is_expired_message_media(target_media_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1
      from public.expired_message_media expired
      join public.chat_members member on member.chat_id = expired.chat_id
      where expired.media_path = target_media_path
        and member.user_id = (select auth.uid())
        and not exists (
          select 1 from public.messages active_message
          where active_message.media_path = target_media_path
            and (active_message.expires_at is null or active_message.expires_at > now())
        )
    )
    or exists (
      select 1
      from public.messages message
      join public.chat_members member on member.chat_id = message.chat_id
      where message.media_path = target_media_path
        and message.expires_at <= now()
        and member.user_id = (select auth.uid())
        and not exists (
          select 1 from public.messages active_message
          where active_message.media_path = target_media_path
            and active_message.id <> message.id
            and (active_message.expires_at is null or active_message.expires_at > now())
        )
    );
$$;

revoke all on function public.is_expired_message_media(text) from public, anon;
grant execute on function public.is_expired_message_media(text) to authenticated;

drop policy if exists "Chat members read chat media" on storage.objects;
create policy "Chat members read chat media"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'chat-media'
    and not public.is_expired_message_media(name)
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

create or replace function public.expire_due_messages()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  expired_message record;
  expired_count integer := 0;
begin
  for expired_message in
    select message.id, message.chat_id, message.media_path
    from public.messages message
    where message.expires_at is not null
      and message.expires_at <= now()
    order by message.expires_at, message.id
    limit 500
    for update skip locked
  loop
    if expired_message.media_path is not null and not exists (
      select 1 from public.messages active_message
      where active_message.media_path = expired_message.media_path
        and active_message.id <> expired_message.id
        and (active_message.expires_at is null or active_message.expires_at > now())
    ) then
      insert into public.expired_message_media (media_path, chat_id)
      values (expired_message.media_path, expired_message.chat_id)
      on conflict (media_path) do nothing;
    end if;
    delete from public.messages where id = expired_message.id;
    expired_count := expired_count + 1;
  end loop;
  return expired_count;
end;
$$;

revoke all on function public.expire_due_messages() from public, anon, authenticated;

create or replace function public.list_my_chats()
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
          and (message.expires_at is null or message.expires_at > now())
        order by message.created_at desc, message.id desc
        limit 1
      ),
      (
        select count(*)::integer
        from public.messages message
        where message.chat_id = chat.id
          and message.sender_id <> (select auth.uid())
          and message.created_at > settings.last_read_at
          and (message.expires_at is null or message.expires_at > now())
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
        (select max(message.created_at)
         from public.messages message
         where message.chat_id = chat.id
           and (message.expires_at is null or message.expires_at > now())),
        chat.created_at
      ) desc;
end;
$$;

create or replace function public.search_messages(
  search_term text,
  target_chat_id uuid default null,
  page_size integer default 25,
  page_offset integer default 0
)
returns table (
  message_id uuid,
  chat_id uuid,
  chat_name text,
  chat_type text,
  sender_id uuid,
  body text,
  created_at timestamptz,
  snippet text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  search_terms text[];
  search_query tsquery;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if search_term is null or char_length(btrim(search_term)) < 2 or char_length(search_term) > 100 then
    raise exception 'Search query must be between 2 and 100 characters';
  end if;
  if page_size is null or page_size < 1 or page_size > 50
    or page_offset is null or page_offset < 0 or page_offset > 5000 then
    raise exception 'Invalid search page';
  end if;
  select array_agg(quote_literal(token) || ':*' order by token)
    into search_terms
  from (
    select distinct token
    from regexp_split_to_table(lower(search_term), '[^[:alnum:]_]+') as split(token)
    where char_length(token) between 2 and 40
    order by token
    limit 9
  ) terms;
  if coalesce(cardinality(search_terms), 0) = 0 then
    raise exception 'Search query must contain a word of at least 2 characters';
  end if;
  if cardinality(search_terms) > 8 then
    raise exception 'Search query can contain at most 8 words';
  end if;
  search_query := to_tsquery('simple'::regconfig, array_to_string(search_terms, ' & '));
  if target_chat_id is not null and not exists (
    select 1 from public.chats chat
    where chat.id = target_chat_id
      and (
        exists (select 1 from public.chat_members member
          where member.chat_id = chat.id and member.user_id = current_user_id)
        or (chat.chat_type = 'channel' and chat.channel_public)
      )
  ) then raise exception 'Chat not found or access denied'; end if;

  return query
    select message.id, message.chat_id,
      case when chat.chat_type = 'direct' then (
        select profile.display_name
        from public.chat_members member
        join public.profiles profile on profile.id = member.user_id
        where member.chat_id = chat.id and member.user_id <> current_user_id limit 1
      ) else chat.title end,
      chat.chat_type, message.sender_id, message.body, message.created_at,
      ts_headline('simple'::regconfig, message.body, search_query,
        'StartSel=<mark>,StopSel=</mark>,MaxWords=28,MinWords=10,ShortWord=1')
    from public.messages message
    join public.chats chat on chat.id = message.chat_id
    where (target_chat_id is null or message.chat_id = target_chat_id)
      and (message.expires_at is null or message.expires_at > now())
      and message.search_vector @@ search_query
      and (
        exists (select 1 from public.chat_members member
          where member.chat_id = message.chat_id and member.user_id = current_user_id)
        or (chat.chat_type = 'channel' and chat.channel_public)
      )
    order by message.created_at desc, message.id desc
    limit page_size offset page_offset;
end;
$$;

create or replace function public.list_my_mentions()
returns table (
  message_id uuid,
  chat_id uuid,
  chat_name text,
  sender_name text,
  sender_username text,
  body text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  return query
    select mention.message_id, mention.chat_id,
      case when chat.chat_type = 'direct' then (
        select profile.display_name
        from public.chat_members member
        join public.profiles profile on profile.id = member.user_id
        where member.chat_id = chat.id and member.user_id <> current_user_id limit 1
      ) else chat.title end,
      sender.display_name, sender.username, message.body, mention.created_at
    from public.message_mentions mention
    join public.messages message on message.id = mention.message_id
      and message.chat_id = mention.chat_id
    join public.chats chat on chat.id = mention.chat_id
    join public.profiles sender on sender.id = message.sender_id
    join public.chat_member_settings settings on settings.chat_id = mention.chat_id
      and settings.user_id = current_user_id
    where mention.user_id = current_user_id
      and chat.chat_type in ('direct', 'group')
      and message.deleted_at is null
      and (message.expires_at is null or message.expires_at > now())
      and message.created_at > settings.last_read_at
    order by mention.created_at desc, mention.message_id desc
    limit 50;
end;
$$;

create or replace function public.profile_preview(target_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  preview jsonb;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if target_user_id is null or target_user_id = current_user_id
    or not public.can_view_profile(target_user_id) then
    raise exception 'Profile is not available';
  end if;

  select jsonb_build_object(
    'profile', jsonb_build_object(
      'id', profile.id,
      'username', profile.username,
      'display_name', profile.display_name,
      'bio', profile.bio,
      'avatar_path', profile.avatar_path
    ),
    'last_seen_at', profile.last_seen_at,
    'muted', coalesce(settings.muted, false),
    'blocked', coalesce(settings.blocked, false),
    'common_groups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', shared_group.id,
        'name', shared_group.title
      ) order by shared_group.title)
      from public.chats shared_group
      join public.chat_members viewer_member
        on viewer_member.chat_id = shared_group.id
        and viewer_member.user_id = current_user_id
      join public.chat_members target_member
        on target_member.chat_id = shared_group.id
        and target_member.user_id = $1
      where shared_group.chat_type = 'group'
    ), '[]'::jsonb),
    'shared_media', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', item.id,
        'chat_id', item.chat_id,
        'chat_name', item.chat_name,
        'media_path', item.media_path,
        'media_type', item.media_type,
        'file_name', item.file_name,
        'body', item.body,
        'created_at', item.created_at
      ) order by item.created_at desc)
      from (
        select message.id, message.chat_id,
          case when chat.chat_type = 'group' then chat.title else 'Direct chat' end as chat_name,
          message.media_path, message.media_type, message.file_name, message.body, message.created_at
        from public.messages message
        join public.chats chat on chat.id = message.chat_id
        join public.chat_members viewer_member
          on viewer_member.chat_id = chat.id and viewer_member.user_id = current_user_id
        join public.chat_members target_member
          on target_member.chat_id = chat.id and target_member.user_id = $1
        where message.deleted_at is null
          and (message.expires_at is null or message.expires_at > now())
          and message.media_path is not null
          and (message.media_type like 'image/%' or message.media_type like 'video/%')
        order by message.created_at desc, message.id desc
        limit 90
      ) item
    ), '[]'::jsonb),
    'shared_links', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', item.id,
        'chat_id', item.chat_id,
        'chat_name', item.chat_name,
        'body', item.body,
        'created_at', item.created_at
      ) order by item.created_at desc)
      from (
        select message.id, message.chat_id,
          case when chat.chat_type = 'group' then chat.title else 'Direct chat' end as chat_name,
          message.body, message.created_at
        from public.messages message
        join public.chats chat on chat.id = message.chat_id
        join public.chat_members viewer_member
          on viewer_member.chat_id = chat.id and viewer_member.user_id = current_user_id
        join public.chat_members target_member
          on target_member.chat_id = chat.id and target_member.user_id = $1
        where message.deleted_at is null
          and (message.expires_at is null or message.expires_at > now())
          and message.body ~* 'https?://[^[:space:]]+'
        order by message.created_at desc, message.id desc
        limit 90
      ) item
    ), '[]'::jsonb),
    'shared_files', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', item.id,
        'chat_id', item.chat_id,
        'chat_name', item.chat_name,
        'media_path', item.media_path,
        'media_type', item.media_type,
        'file_name', item.file_name,
        'created_at', item.created_at
      ) order by item.created_at desc)
      from (
        select message.id, message.chat_id,
          case when chat.chat_type = 'group' then chat.title else 'Direct chat' end as chat_name,
          message.media_path, message.media_type, message.file_name, message.created_at
        from public.messages message
        join public.chats chat on chat.id = message.chat_id
        join public.chat_members viewer_member
          on viewer_member.chat_id = chat.id and viewer_member.user_id = current_user_id
        join public.chat_members target_member
          on target_member.chat_id = chat.id and target_member.user_id = $1
        where message.deleted_at is null
          and (message.expires_at is null or message.expires_at > now())
          and message.media_path is not null
          and message.media_type not like 'image/%'
          and message.media_type not like 'video/%'
        order by message.created_at desc, message.id desc
        limit 90
      ) item
    ), '[]'::jsonb)
  ) into preview
  from public.profiles profile
  left join public.profile_preview_settings settings
    on settings.user_id = current_user_id and settings.target_user_id = $1
  where profile.id = $1;

  return preview;
end;
$$;

create or replace function public.toggle_message_reaction(
  target_message_id uuid,
  selected_reaction text
)
returns table (reaction text, count integer, reacted_by_me boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_chat_id uuid;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if selected_reaction not in ('👍', '❤️', '😂', '😮', '😢', '🙏') then
    raise exception 'Unsupported reaction';
  end if;

  select message.chat_id into target_chat_id
  from public.messages message
  where message.id = target_message_id
    and (message.expires_at is null or message.expires_at > now())
  for update;
  if target_chat_id is null or not exists (
    select 1 from public.chat_members member
    where member.chat_id = target_chat_id and member.user_id = current_user_id
  ) then raise exception 'Message not found'; end if;

  if exists (
    select 1 from public.chat_reactions reaction_row
    where reaction_row.message_id = target_message_id
      and reaction_row.user_id = current_user_id
      and reaction_row.reaction = selected_reaction
  ) then
    delete from public.chat_reactions reaction_row
    where reaction_row.message_id = target_message_id
      and reaction_row.user_id = current_user_id
      and reaction_row.reaction = selected_reaction;
  else
    insert into public.chat_reactions (message_id, user_id, reaction)
    values (target_message_id, current_user_id, selected_reaction);
  end if;

  return query
    select reaction_row.reaction, count(*)::integer,
      bool_or(reaction_row.user_id = current_user_id)
    from public.chat_reactions reaction_row
    where reaction_row.message_id = target_message_id
    group by reaction_row.reaction
    order by min(reaction_row.created_at);
end;
$$;

create or replace function public.list_chat_reactions(target_chat_id uuid)
returns table (message_id uuid, user_id uuid, reaction text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.chat_members member
    where member.chat_id = target_chat_id and member.user_id = (select auth.uid())
  ) then raise exception 'Chat not found'; end if;
  return query
    select reaction_row.message_id, reaction_row.user_id, reaction_row.reaction
    from public.chat_reactions reaction_row
    join public.messages message on message.id = reaction_row.message_id
    where message.chat_id = target_chat_id
      and (message.expires_at is null or message.expires_at > now());
end;
$$;

create or replace function public.mark_chat_unread(target_chat_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  incoming_message_at timestamptz;
  unread_cursor timestamptz;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.chat_members member
    where member.chat_id = target_chat_id and member.user_id = current_user_id
  ) then raise exception 'Chat not found or you are not a member'; end if;

  select message.created_at into incoming_message_at
  from public.messages message
  where message.chat_id = target_chat_id
    and message.sender_id <> current_user_id
    and message.deleted_at is null
    and (message.expires_at is null or message.expires_at > now())
  order by message.created_at desc, message.id desc
  limit 1;
  if incoming_message_at is null then raise exception 'No received messages to mark unread'; end if;
  unread_cursor := incoming_message_at - interval '1 microsecond';
  insert into public.chat_member_settings (chat_id, user_id, last_read_at)
  values (target_chat_id, current_user_id, unread_cursor)
  on conflict (chat_id, user_id) do update set last_read_at = excluded.last_read_at;
  return unread_cursor;
end;
$$;

drop policy if exists "Chat members can view message pins" on public.chat_pins;
create policy "Chat members can view message pins"
  on public.chat_pins for select to authenticated
  using (
    exists (
      select 1 from public.messages message
      where message.id = chat_pins.message_id
        and (message.expires_at is null or message.expires_at > now())
    )
    and (
      exists (
        select 1 from public.chat_members member
        where member.chat_id = chat_pins.chat_id and member.user_id = (select auth.uid())
      )
      or exists (
        select 1 from public.chats chat
        where chat.id = chat_pins.chat_id
          and chat.chat_type = 'channel' and chat.channel_public
      )
    )
  );

do $$
declare
  scheduled_job record;
begin
  for scheduled_job in
    select jobid from cron.job where jobname = 'guildkeep-expire-messages'
  loop
    perform cron.unschedule(scheduled_job.jobid);
  end loop;
  perform cron.schedule(
    'guildkeep-expire-messages',
    '* * * * *',
    'select public.expire_due_messages();'
  );
end;
$$;

notify pgrst, 'reload schema';
