create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique
    check (username ~ '^[a-z0-9_]{3,24}$'),
  display_name text not null
    check (char_length(display_name) between 1 and 60),
  created_at timestamptz not null default now()
);

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_username text;
  requested_name text;
begin
  requested_username := lower(coalesce(
    new.raw_user_meta_data ->> 'username',
    'ember_' || substr(replace(new.id::text, '-', ''), 1, 12)
  ));
  requested_name := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
    requested_username
  );

  insert into public.profiles (id, username, display_name)
  values (new.id, requested_username, left(requested_name, 60));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.create_profile_for_new_user();

insert into public.profiles (id, username, display_name)
select
  users.id,
  lower(coalesce(
    users.raw_user_meta_data ->> 'username',
    'ember_' || substr(replace(users.id::text, '-', ''), 1, 12)
  )),
  left(coalesce(
    nullif(btrim(users.raw_user_meta_data ->> 'display_name'), ''),
    users.raw_user_meta_data ->> 'username',
    'ember_' || substr(replace(users.id::text, '-', ''), 1, 12)
  ), 60)
from auth.users users
on conflict (id) do nothing;

create table if not exists public.chats (
  id uuid primary key default gen_random_uuid(),
  title text not null default '',
  is_group boolean not null default false,
  direct_user_low uuid references public.profiles (id) on delete cascade,
  direct_user_high uuid references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  check (
    (is_group and direct_user_low is null and direct_user_high is null)
    or
    (not is_group and direct_user_low is not null and direct_user_high is not null
      and direct_user_low < direct_user_high)
  )
);

create unique index if not exists chats_direct_pair_unique
  on public.chats (direct_user_low, direct_user_high)
  where direct_user_low is not null;

create table if not exists public.chat_members (
  chat_id uuid not null references public.chats (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (chat_id, user_id)
);

create index if not exists chat_members_by_user on public.chat_members (user_id, chat_id);

create table if not exists public.chat_member_settings (
  chat_id uuid not null,
  user_id uuid not null,
  pinned boolean not null default false,
  last_read_at timestamptz not null default now(),
  primary key (chat_id, user_id),
  foreign key (chat_id, user_id)
    references public.chat_members (chat_id, user_id) on delete cascade
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now(),
  foreign key (chat_id, sender_id)
    references public.chat_members (chat_id, user_id) on delete cascade
);

create index if not exists messages_by_chat_time
  on public.messages (chat_id, created_at desc);

create or replace function public.can_view_profile(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_user_id = (select auth.uid())
    or exists (
      select 1
      from public.chat_members viewer
      join public.chat_members target on target.chat_id = viewer.chat_id
      where viewer.user_id = (select auth.uid())
        and target.user_id = target_user_id
    );
$$;

alter table public.profiles enable row level security;
alter table public.chats enable row level security;
alter table public.chat_members enable row level security;
alter table public.chat_member_settings enable row level security;
alter table public.messages enable row level security;

drop policy if exists "Authenticated users can view profiles" on public.profiles;
drop policy if exists "Users can view chat participants" on public.profiles;
create policy "Users can view chat participants"
  on public.profiles for select to authenticated
  using (public.can_view_profile(id));

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

drop policy if exists "Users can view their own memberships" on public.chat_members;
create policy "Users can view their own memberships"
  on public.chat_members for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Members can view their chats" on public.chats;
create policy "Members can view their chats"
  on public.chats for select to authenticated
  using (
    exists (
      select 1 from public.chat_members member
      where member.chat_id = id and member.user_id = (select auth.uid())
    )
  );

drop policy if exists "Users can view their chat settings" on public.chat_member_settings;
create policy "Users can view their chat settings"
  on public.chat_member_settings for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Users can update their chat settings" on public.chat_member_settings;
create policy "Users can update their chat settings"
  on public.chat_member_settings for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "Members can view chat messages" on public.messages;
create policy "Members can view chat messages"
  on public.messages for select to authenticated
  using (
    exists (
      select 1 from public.chat_members member
      where member.chat_id = public.messages.chat_id and member.user_id = (select auth.uid())
    )
  );

drop policy if exists "Members can send their own messages" on public.messages;
create policy "Members can send their own messages"
  on public.messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and exists (
      select 1 from public.chat_members member
      where member.chat_id = public.messages.chat_id and member.user_id = (select auth.uid())
    )
  );

revoke all on public.profiles, public.chats, public.chat_members,
  public.chat_member_settings, public.messages from public, anon, authenticated;

grant usage on schema public to authenticated;
grant select on public.profiles, public.chats, public.chat_members,
  public.chat_member_settings, public.messages to authenticated;
grant update (username, display_name) on public.profiles to authenticated;
grant update (pinned, last_read_at) on public.chat_member_settings to authenticated;
grant insert (chat_id, sender_id, body) on public.messages to authenticated;
revoke all on function public.can_view_profile(uuid) from public, anon;
grant execute on function public.can_view_profile(uuid) to authenticated;

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
  created_at timestamptz
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
      case
        when chat.is_group then chat.title
        else coalesce(other_profile.display_name, 'Direct chat')
      end,
      chat.is_group,
      settings.pinned,
      settings.last_read_at,
      (
        select jsonb_build_object(
          'id', message.id,
          'body', message.body,
          'sender_id', message.sender_id,
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
            'id', member_profile.id,
            'username', member_profile.username,
            'display_name', member_profile.display_name
          ) order by member_profile.display_name),
          '[]'::jsonb
        )
        from public.chat_members member
        join public.profiles member_profile on member_profile.id = member.user_id
        where member.chat_id = chat.id
          and member.user_id <> (select auth.uid())
      ),
      chat.created_at
    from public.chats chat
    join public.chat_member_settings settings
      on settings.chat_id = chat.id and settings.user_id = (select auth.uid())
    left join public.profiles other_profile
      on other_profile.id = case
        when chat.direct_user_low = (select auth.uid()) then chat.direct_user_high
        else chat.direct_user_low
      end
    where exists (
      select 1 from public.chat_members member
      where member.chat_id = chat.id and member.user_id = (select auth.uid())
    )
    order by settings.pinned desc,
      coalesce(
        (select max(message.created_at) from public.messages message where message.chat_id = chat.id),
        chat.created_at
      ) desc;
end;
$$;

create or replace function public.create_direct_chat(target_username text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_user_id uuid;
  lower_user_id uuid;
  higher_user_id uuid;
  result_chat_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;
  if target_username is null or target_username !~ '^[a-zA-Z0-9_]{3,24}$' then
    raise exception 'Enter a valid username';
  end if;

  select profile.id into target_user_id
  from public.profiles profile
  where profile.username = lower(target_username);

  if target_user_id is null then
    raise exception 'No account found for that username';
  end if;
  if target_user_id = current_user_id then
    raise exception 'You cannot start a chat with yourself';
  end if;

  lower_user_id := least(current_user_id, target_user_id);
  higher_user_id := greatest(current_user_id, target_user_id);

  insert into public.chats (direct_user_low, direct_user_high)
  values (lower_user_id, higher_user_id)
  on conflict (direct_user_low, direct_user_high)
    where direct_user_low is not null
  do update set title = public.chats.title
  returning id into result_chat_id;

  insert into public.chat_members (chat_id, user_id)
  values (result_chat_id, current_user_id), (result_chat_id, target_user_id)
  on conflict do nothing;

  insert into public.chat_member_settings (chat_id, user_id)
  values (result_chat_id, current_user_id), (result_chat_id, target_user_id)
  on conflict do nothing;

  return result_chat_id;
end;
$$;

revoke all on function public.list_my_chats() from public, anon;
revoke all on function public.create_direct_chat(text) from public, anon;
grant execute on function public.list_my_chats() to authenticated;
grant execute on function public.create_direct_chat(text) to authenticated;

alter table public.messages replica identity full;
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise exception 'Create the Supabase Realtime publication before applying this migration';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end;
$$;
