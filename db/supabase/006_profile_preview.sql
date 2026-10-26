alter table public.profiles
  add column if not exists last_seen_at timestamptz;

create table if not exists public.profile_preview_settings (
  user_id uuid not null references public.profiles (id) on delete cascade,
  target_user_id uuid not null references public.profiles (id) on delete cascade,
  muted boolean not null default false,
  blocked boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, target_user_id),
  check (user_id <> target_user_id)
);

create table if not exists public.profile_preview_reports (
  id bigint generated always as identity primary key,
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  target_user_id uuid not null references public.profiles (id) on delete cascade,
  context_chat_id uuid not null references public.chats (id) on delete cascade,
  reason text not null default '',
  created_at timestamptz not null default now(),
  check (reporter_id <> target_user_id),
  check (char_length(reason) <= 1000)
);

create index if not exists profile_preview_reports_by_chat
  on public.profile_preview_reports (context_chat_id, created_at desc);

alter table public.profile_preview_settings enable row level security;
alter table public.profile_preview_reports enable row level security;
revoke all on public.profile_preview_settings, public.profile_preview_reports
  from public, anon, authenticated;

drop policy if exists "Users manage their profile preview settings"
  on public.profile_preview_settings;
create policy "Users manage their profile preview settings"
  on public.profile_preview_settings for all to authenticated
  using (user_id = (select auth.uid()) and public.can_view_profile(target_user_id))
  with check (user_id = (select auth.uid()) and public.can_view_profile(target_user_id));

grant select, insert, update, delete on public.profile_preview_settings to authenticated;

create or replace function public.touch_my_presence()
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  last_seen timestamptz;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;

  update public.profiles
  set last_seen_at = now()
  where id = current_user_id
  returning last_seen_at into last_seen;
  return last_seen;
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
        where message.deleted_at is null and message.body ~* 'https?://[^[:space:]]+'
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

create or replace function public.set_profile_preview_muted(
  target_user_id uuid,
  new_muted boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if target_user_id is null or target_user_id = current_user_id
    or not public.can_view_profile(target_user_id) then
    raise exception 'Profile is not available';
  end if;

  insert into public.profile_preview_settings (user_id, target_user_id, muted)
  values (current_user_id, $1, coalesce(new_muted, false))
  on conflict on constraint profile_preview_settings_pkey do update
    set muted = excluded.muted, updated_at = now();
  return coalesce(new_muted, false);
end;
$$;

create or replace function public.set_profile_preview_blocked(
  target_user_id uuid,
  new_blocked boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if target_user_id is null or target_user_id = current_user_id
    or not public.can_view_profile(target_user_id) then
    raise exception 'Profile is not available';
  end if;

  insert into public.profile_preview_settings (user_id, target_user_id, blocked)
  values (current_user_id, $1, coalesce(new_blocked, false))
  on conflict on constraint profile_preview_settings_pkey do update
    set blocked = excluded.blocked, updated_at = now();
  return coalesce(new_blocked, false);
end;
$$;

create or replace function public.report_profile_preview(
  target_user_id uuid,
  context_chat_id uuid,
  report_reason text default ''
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  report_id bigint;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if target_user_id is null or target_user_id = current_user_id
    or char_length(coalesce(report_reason, '')) > 1000
    or not exists (
      select 1
      from public.chats chat
      join public.chat_members viewer_member
        on viewer_member.chat_id = chat.id and viewer_member.user_id = current_user_id
      join public.chat_members target_member
        on target_member.chat_id = chat.id and target_member.user_id = target_user_id
      where chat.id = context_chat_id and chat.chat_type = 'group'
    ) then
    raise exception 'A shared group is required to submit this report';
  end if;

  insert into public.profile_preview_reports
    (reporter_id, target_user_id, context_chat_id, reason)
  values (current_user_id, $1, $2, btrim(coalesce($3, '')))
  returning id into report_id;
  return report_id;
end;
$$;

create or replace function public.is_profile_blocked_between(first_user_id uuid, second_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profile_preview_settings setting
    where setting.blocked
      and (
        first_user_id = (select auth.uid())
        or second_user_id = (select auth.uid())
      )
      and (
        (setting.user_id = first_user_id and setting.target_user_id = second_user_id)
        or (setting.user_id = second_user_id and setting.target_user_id = first_user_id)
      )
  );
$$;

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
        and (
          chat.chat_type <> 'direct'
          or not public.is_profile_blocked_between(
            (select auth.uid()),
            case when chat.direct_user_low = (select auth.uid())
              then chat.direct_user_high else chat.direct_user_low end
          )
        )
    )
  );

revoke all on function public.touch_my_presence() from public, anon;
revoke all on function public.profile_preview(uuid) from public, anon;
revoke all on function public.set_profile_preview_muted(uuid, boolean) from public, anon;
revoke all on function public.set_profile_preview_blocked(uuid, boolean) from public, anon;
revoke all on function public.report_profile_preview(uuid, uuid, text) from public, anon;
revoke all on function public.is_profile_blocked_between(uuid, uuid) from public, anon, authenticated;
grant execute on function public.touch_my_presence() to authenticated;
grant execute on function public.profile_preview(uuid) to authenticated;
grant execute on function public.set_profile_preview_muted(uuid, boolean) to authenticated;
grant execute on function public.set_profile_preview_blocked(uuid, boolean) to authenticated;
grant execute on function public.report_profile_preview(uuid, uuid, text) to authenticated;
grant execute on function public.is_profile_blocked_between(uuid, uuid) to authenticated;
