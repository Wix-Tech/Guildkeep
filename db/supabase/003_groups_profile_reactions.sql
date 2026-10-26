alter table public.profiles
  add column if not exists bio text not null default '';

alter table public.chats
  add column if not exists group_locked boolean not null default false,
  add column if not exists announcement_mode boolean not null default false,
  add column if not exists antilink_enabled boolean not null default false,
  add column if not exists slowmode_seconds integer not null default 0
    check (slowmode_seconds between 0 and 86400),
  add column if not exists group_rules text not null default '',
  add column if not exists invite_code text unique,
  add column if not exists group_updated_at timestamptz not null default now();

alter table public.chat_members
  add column if not exists role text not null default 'member'
    check (role in ('member', 'admin', 'owner'));

create table if not exists public.chat_reactions (
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  reaction text not null check (reaction in ('👍', '❤️', '😂', '😮', '😢', '🙏')),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, reaction)
);

create index if not exists chat_reactions_by_message
  on public.chat_reactions (message_id);

create table if not exists public.group_statuses (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 700),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);

create index if not exists group_statuses_active
  on public.group_statuses (chat_id, expires_at desc);

create table if not exists public.group_admin_audit (
  id bigint generated always as identity primary key,
  chat_id uuid not null references public.chats (id) on delete cascade,
  actor_id uuid not null references public.profiles (id) on delete cascade,
  command text not null,
  detail text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists group_admin_audit_by_chat
  on public.group_admin_audit (chat_id, created_at desc);

alter table public.chat_reactions enable row level security;
alter table public.group_statuses enable row level security;
alter table public.group_admin_audit enable row level security;

revoke all on public.chat_reactions, public.group_statuses, public.group_admin_audit
  from public, anon, authenticated;
grant select, insert, delete on public.chat_reactions to authenticated;

drop policy if exists "Members can view chat reactions" on public.chat_reactions;
create policy "Members can view chat reactions"
  on public.chat_reactions for select to authenticated
  using (
    exists (
      select 1
      from public.messages message
      join public.chat_members member on member.chat_id = message.chat_id
      where message.id = chat_reactions.message_id
        and member.user_id = (select auth.uid())
    )
  );

drop policy if exists "Members can react as themselves" on public.chat_reactions;
create policy "Members can react as themselves"
  on public.chat_reactions for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.messages message
      join public.chat_members member on member.chat_id = message.chat_id
      where message.id = chat_reactions.message_id
        and member.user_id = (select auth.uid())
    )
  );

drop policy if exists "Users can remove their own reactions" on public.chat_reactions;
create policy "Users can remove their own reactions"
  on public.chat_reactions for delete to authenticated
  using (user_id = (select auth.uid()));

grant update (bio) on public.profiles to authenticated;

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
  group_rules text
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
      case when chat.is_group then chat.title
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
            'id', profile.id,
            'username', profile.username,
            'display_name', profile.display_name,
            'role', member.role
          ) order by profile.display_name),
          '[]'::jsonb
        )
        from public.chat_members member
        join public.profiles profile on profile.id = member.user_id
        where member.chat_id = chat.id
          and member.user_id <> (select auth.uid())
      ),
      chat.created_at,
      current_member.role,
      case when chat.is_group then chat.invite_code else null end,
      chat.group_locked,
      chat.announcement_mode,
      chat.slowmode_seconds,
      chat.antilink_enabled,
      chat.group_rules
    from public.chats chat
    join public.chat_members current_member
      on current_member.chat_id = chat.id and current_member.user_id = (select auth.uid())
    join public.chat_member_settings settings
      on settings.chat_id = chat.id and settings.user_id = (select auth.uid())
    left join public.profiles other_profile
      on other_profile.id = case
        when chat.direct_user_low = (select auth.uid()) then chat.direct_user_high
        else chat.direct_user_low
      end
    order by settings.pinned desc,
      coalesce(
        (select max(message.created_at) from public.messages message where message.chat_id = chat.id),
        chat.created_at
      ) desc;
end;
$$;

create or replace function public.update_my_profile(new_display_name text, new_bio text)
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

  update public.profiles
  set display_name = btrim(new_display_name), bio = btrim(coalesce(new_bio, ''))
  where id = current_user_id
  returning * into updated_profile;
  return updated_profile;
end;
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
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;
  if group_title is null or char_length(btrim(group_title)) not between 2 and 80 then
    raise exception 'Group name must be between 2 and 80 characters';
  end if;
  if requested_count > 49 then
    raise exception 'A group can have at most 50 members';
  end if;
  if exists (
    select 1 from unnest(coalesce(member_usernames, '{}')) username
    where username !~ '^[A-Za-z0-9_]{3,24}$'
  ) then
    raise exception 'One or more usernames are invalid';
  end if;

  select count(distinct profile.id)::integer into found_count
  from public.profiles profile
  where profile.username = any(
    array(select distinct lower(username) from unnest(coalesce(member_usernames, '{}')) username)
  )
    and profile.id <> current_user_id;
  if found_count <> (
    select count(distinct lower(username))
    from unnest(coalesce(member_usernames, '{}')) username
  ) then
    raise exception 'One or more usernames were not found';
  end if;

  insert into public.chats (title, is_group, invite_code)
  values (
    btrim(group_title),
    true,
    replace(gen_random_uuid()::text, '-', '')
  )
  returning id into new_chat_id;

  insert into public.chat_members (chat_id, user_id, role)
  values (new_chat_id, current_user_id, 'owner');
  insert into public.chat_members (chat_id, user_id, role)
  select new_chat_id, profile.id, 'member'
  from public.profiles profile
  where profile.username = any(
    array(select distinct lower(username) from unnest(coalesce(member_usernames, '{}')) username)
  )
    and profile.id <> current_user_id
  on conflict do nothing;

  insert into public.chat_member_settings (chat_id, user_id)
  select new_chat_id, member.user_id
  from public.chat_members member
  where member.chat_id = new_chat_id;

  insert into public.group_admin_audit (chat_id, actor_id, command, detail)
  values (new_chat_id, current_user_id, 'create', btrim(group_title));
  return new_chat_id;
end;
$$;

create or replace function public.join_group_by_invite(invite_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_chat_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;
  if invite_token is null or invite_token !~ '^[a-f0-9]{32}$' then
    raise exception 'Invalid group invite link';
  end if;

  select chat.id into target_chat_id
  from public.chats chat
  where chat.is_group and chat.invite_code = invite_token
  for update;
  if target_chat_id is null then
    raise exception 'This group invite link is no longer valid';
  end if;
  if not exists (
    select 1 from public.chat_members member
    where member.chat_id = target_chat_id and member.user_id = current_user_id
  ) and (
    select count(*) from public.chat_members member where member.chat_id = target_chat_id
  ) >= 50 then
    raise exception 'This group is full';
  end if;

  insert into public.chat_members (chat_id, user_id, role)
  values (target_chat_id, current_user_id, 'member')
  on conflict do nothing;
  insert into public.chat_member_settings (chat_id, user_id)
  values (target_chat_id, current_user_id)
  on conflict do nothing;
  update public.chats set group_updated_at = now() where id = target_chat_id;
  return target_chat_id;
end;
$$;

create or replace function public.toggle_message_reaction(target_message_id uuid, selected_reaction text)
returns table (reaction text, count integer, reacted_by_me boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_chat_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;
  if selected_reaction not in ('👍', '❤️', '😂', '😮', '😢', '🙏') then
    raise exception 'Unsupported reaction';
  end if;

  select message.chat_id into target_chat_id
  from public.messages message
  where message.id = target_message_id
  for update;
  if target_chat_id is null or not exists (
    select 1 from public.chat_members member
    where member.chat_id = target_chat_id and member.user_id = current_user_id
  ) then
    raise exception 'Message not found';
  end if;

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
  ) then
    raise exception 'Chat not found';
  end if;

  return query
    select reaction_row.message_id, reaction_row.user_id, reaction_row.reaction
    from public.chat_reactions reaction_row
    join public.messages message on message.id = reaction_row.message_id
    where message.chat_id = target_chat_id;
end;
$$;

create or replace function public.run_group_command(target_chat_id uuid, command_text text)
returns table (ok boolean, message text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  group_row public.chats;
  actor_role text;
  command_name text;
  argument text;
  target_username text;
  target_user_id uuid;
  target_role text;
  toggle_value text;
  duration_seconds integer;
  invite_value text;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;
  if command_text is null or char_length(btrim(command_text)) > 1000 then
    raise exception 'Enter a valid group command';
  end if;

  select chat.* into group_row
  from public.chats chat
  join public.chat_members member on member.chat_id = chat.id and member.user_id = current_user_id
  where chat.id = target_chat_id and chat.is_group
  for update of chat;
  if group_row.id is null then
    raise exception 'Group not found';
  end if;
  select member.role into actor_role
  from public.chat_members member
  where member.chat_id = target_chat_id and member.user_id = current_user_id;

  command_name := lower(split_part(ltrim(command_text), ' ', 1));
  command_name := regexp_replace(command_name, '^[/!.]', '');
  argument := btrim(substr(ltrim(command_text), length(split_part(ltrim(command_text), ' ', 1)) + 1));

  if command_name = 'help' then
    if actor_role in ('owner', 'admin') then
      return query select true, '/help, /lock [reason], /open, /announce on|off, /slowmode off|seconds, /antilink on|off, /status <text>, /setrules <text>, /add @username, /kick @username, /promote @username, /demote @username, /rename <name>, /invite';
    else
      return query select true, '/help, /rules';
    end if;
    return;
  end if;

  if command_name = 'rules' then
    return query select true, case when group_row.group_rules = ''
      then 'No group rules have been set.' else group_row.group_rules end;
    return;
  end if;

  if actor_role not in ('owner', 'admin') then
    return query select false, 'Only group admins can use that command.';
    return;
  end if;

  if command_name = 'lock' then
    if group_row.group_locked then
      return query select false, 'The group is already locked.';
      return;
    end if;
    update public.chats set group_locked = true where id = target_chat_id;
    message := 'Group locked. Only admins can send messages.';
  elsif command_name = 'open' then
    if not group_row.group_locked and not group_row.announcement_mode then
      return query select false, 'The group is already open.';
      return;
    end if;
    update public.chats
      set group_locked = false, announcement_mode = false
      where id = target_chat_id;
    message := 'Group opened. Members can send messages again.';
  elsif command_name = 'announce' then
    toggle_value := lower(argument);
    if toggle_value not in ('on', 'off') then
      return query select false, 'Usage: /announce on|off';
      return;
    end if;
    update public.chats
      set announcement_mode = (toggle_value = 'on'),
        group_locked = case when toggle_value = 'on' then true else group_locked end
      where id = target_chat_id;
    message := 'Announcement mode ' || toggle_value || '.';
  elsif command_name = 'antilink' then
    toggle_value := lower(argument);
    if toggle_value not in ('on', 'off') then
      return query select false, 'Usage: /antilink on|off';
      return;
    end if;
    update public.chats set antilink_enabled = (toggle_value = 'on')
    where id = target_chat_id;
    message := 'Anti-link ' || toggle_value || '.';
  elsif command_name = 'slowmode' then
    if lower(argument) in ('off', '0') then
      duration_seconds := 0;
    else
      begin
        duration_seconds := argument::integer;
      exception when invalid_text_representation then
        return query select false, 'Usage: /slowmode off|seconds (max 86400)';
        return;
      end;
      if duration_seconds < 1 or duration_seconds > 86400 then
        return query select false, 'Slow mode must be between 1 and 86400 seconds.';
        return;
      end if;
    end if;
    update public.chats set slowmode_seconds = duration_seconds where id = target_chat_id;
    message := case when duration_seconds = 0 then 'Slow mode is off.'
      else 'Slow mode set to ' || duration_seconds || ' seconds.' end;
  elsif command_name = 'setrules' then
    if argument = '' or char_length(argument) > 2000 then
      return query select false, 'Usage: /setrules <rules, up to 2000 characters>';
      return;
    end if;
    update public.chats set group_rules = argument where id = target_chat_id;
    message := 'Group rules updated.';
  elsif command_name = 'status' then
    if argument = '' or char_length(argument) > 700 then
      return query select false, 'Usage: /status <text, up to 700 characters>';
      return;
    end if;
    insert into public.group_statuses (chat_id, author_id, body)
    values (target_chat_id, current_user_id, argument);
    message := 'Group status posted. It will expire after 24 hours.';
  elsif command_name = 'rename' then
    if char_length(argument) not between 2 and 80 then
      return query select false, 'Usage: /rename <group name, 2–80 characters>';
      return;
    end if;
    update public.chats set title = argument where id = target_chat_id;
    message := 'Group renamed to ' || argument || '.';
  elsif command_name = 'invite' then
    update public.chats set invite_code = replace(gen_random_uuid()::text, '-', '')
    where id = target_chat_id returning invite_code into invite_value;
    message := 'Invite link: ' || invite_value;
  elsif command_name in ('add', 'kick', 'promote', 'demote') then
    target_username := lower(regexp_replace(split_part(argument, ' ', 1), '^@', ''));
    if target_username !~ '^[a-z0-9_]{3,24}$' then
      return query select false, 'Usage: /' || command_name || ' @username';
      return;
    end if;
    select profile.id into target_user_id
    from public.profiles profile
    where profile.username = target_username;
    if target_user_id is null then
      return query select false, 'No account found for @' || target_username || '.';
      return;
    end if;
    select member.role into target_role
    from public.chat_members member
    where member.chat_id = target_chat_id and member.user_id = target_user_id;

    if command_name = 'add' then
      if target_role is not null then
        return query select false, 'That person is already in this group.';
        return;
      end if;
      if (select count(*) from public.chat_members member where member.chat_id = target_chat_id) >= 50 then
        return query select false, 'This group has reached its 50-member limit.';
        return;
      end if;
      insert into public.chat_members (chat_id, user_id, role)
      values (target_chat_id, target_user_id, 'member');
      insert into public.chat_member_settings (chat_id, user_id)
      values (target_chat_id, target_user_id);
      message := '@' || target_username || ' added to the group.';
    elsif command_name = 'kick' then
      if target_role is null then
        return query select false, 'That person is not a member of this group.';
        return;
      end if;
      if target_role = 'owner' or (target_role = 'admin' and actor_role <> 'owner') then
        return query select false, 'You do not have permission to remove that member.';
        return;
      end if;
      delete from public.chat_members
      where chat_id = target_chat_id and user_id = target_user_id;
      message := '@' || target_username || ' removed from the group.';
    elsif command_name = 'promote' then
      if actor_role <> 'owner' then
        return query select false, 'Only the group owner can promote admins.';
        return;
      end if;
      if target_role is null or target_role = 'owner' then
        return query select false, 'Choose a current group member to promote.';
        return;
      end if;
      update public.chat_members set role = 'admin'
      where chat_id = target_chat_id and user_id = target_user_id;
      message := '@' || target_username || ' is now an admin.';
    else
      if actor_role <> 'owner' then
        return query select false, 'Only the group owner can change admin roles.';
        return;
      end if;
      if target_role <> 'admin' then
        return query select false, 'That person is not a group admin.';
        return;
      end if;
      update public.chat_members set role = 'member'
      where chat_id = target_chat_id and user_id = target_user_id;
      message := '@' || target_username || ' is no longer an admin.';
    end if;
  else
    return query select false, 'Unknown group command. Try /help.';
    return;
  end if;

  insert into public.group_admin_audit (chat_id, actor_id, command, detail)
  values (target_chat_id, current_user_id, command_name, argument);
  update public.chats set group_updated_at = now() where id = target_chat_id;
  return query select true, message;
end;
$$;

create or replace function public.get_group_statuses(target_chat_id uuid)
returns table (id uuid, body text, author_name text, created_at timestamptz, expires_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select status.id, status.body, profile.display_name, status.created_at, status.expires_at
  from public.group_statuses status
  join public.chat_members member
    on member.chat_id = status.chat_id and member.user_id = (select auth.uid())
  join public.profiles profile on profile.id = status.author_id
  where status.chat_id = target_chat_id and status.expires_at > now()
  order by status.created_at desc
  limit 20;
$$;

revoke all on function public.list_my_chats() from public, anon;
revoke all on function public.update_my_profile(text, text) from public, anon;
revoke all on function public.create_group(text, text[]) from public, anon;
revoke all on function public.join_group_by_invite(text) from public, anon;
revoke all on function public.toggle_message_reaction(uuid, text) from public, anon;
revoke all on function public.list_chat_reactions(uuid) from public, anon;
revoke all on function public.run_group_command(uuid, text) from public, anon;
revoke all on function public.get_group_statuses(uuid) from public, anon;
grant execute on function public.list_my_chats() to authenticated;
grant execute on function public.update_my_profile(text, text) to authenticated;
grant execute on function public.create_group(text, text[]) to authenticated;
grant execute on function public.join_group_by_invite(text) to authenticated;
grant execute on function public.toggle_message_reaction(uuid, text) to authenticated;
grant execute on function public.list_chat_reactions(uuid) to authenticated;
grant execute on function public.run_group_command(uuid, text) to authenticated;
grant execute on function public.get_group_statuses(uuid) to authenticated;

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
  if not exists (
    select 1 from public.chats chat
    where chat.id = new.chat_id and chat.is_group
  ) then
    return new;
  end if;

  select chat.* into chat_row
  from public.chats chat where chat.id = new.chat_id for update;
  if chat_row.id is null then
    return new;
  end if;

  select member.role into sender_role
  from public.chat_members member
  where member.chat_id = new.chat_id and member.user_id = new.sender_id;
  if sender_role is null then
    raise exception 'You are not a member of this group';
  end if;

  if (chat_row.group_locked or chat_row.announcement_mode)
    and sender_role not in ('owner', 'admin')
  then
    raise exception 'Only group admins can send messages right now';
  end if;

  if chat_row.antilink_enabled
    and sender_role = 'member'
    and new.body ~* '(https?://|www[.]|[a-z0-9-]+[.][a-z]{2,24}([/?#:]|$))'
  then
    raise exception 'Links are disabled in this group';
  end if;

  if chat_row.slowmode_seconds > 0 and sender_role = 'member' then
    select max(message.created_at) into last_message_at
    from public.messages message
    where message.chat_id = new.chat_id and message.sender_id = new.sender_id;
    if last_message_at is not null
      and last_message_at > now() - make_interval(secs => chat_row.slowmode_seconds)
    then
      raise exception 'Slow mode is on. Please wait before sending another message';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_group_message_rules on public.messages;
create trigger enforce_group_message_rules
  before insert on public.messages
  for each row execute function public.enforce_group_message_rules();

alter table public.chat_reactions replica identity full;
alter table public.group_statuses replica identity full;
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_reactions'
  ) then
    alter publication supabase_realtime add table public.chat_reactions;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chats'
  ) then
    alter publication supabase_realtime add table public.chats;
  end if;
end;
$$;
