create table if not exists public.message_reads (
  chat_id uuid not null,
  user_id uuid not null,
  last_read_sort_id uuid,
  updated_at timestamptz not null default now(),
  primary key (chat_id, user_id),
  foreign key (chat_id, user_id)
    references public.chat_members (chat_id, user_id) on delete cascade
);

create index if not exists message_reads_by_chat_user
  on public.message_reads (chat_id, user_id);

alter table public.message_reads enable row level security;
revoke all on public.message_reads from public, anon, authenticated;
grant select, insert, update on public.message_reads to authenticated;

drop policy if exists "Chat members can view shared read receipts" on public.message_reads;
create policy "Chat members can view shared read receipts"
  on public.message_reads for select to authenticated
  using (
    exists (
      select 1
      from public.chat_members viewer
      where viewer.chat_id = message_reads.chat_id
        and viewer.user_id = (select auth.uid())
    )
  );

drop policy if exists "Users can insert their own read receipt" on public.message_reads;
create policy "Users can insert their own read receipt"
  on public.message_reads for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.chat_members member
      where member.chat_id = message_reads.chat_id
        and member.user_id = (select auth.uid())
    )
  );

drop policy if exists "Users can update their own read receipt" on public.message_reads;
create policy "Users can update their own read receipt"
  on public.message_reads for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.chat_members member
      where member.chat_id = message_reads.chat_id
        and member.user_id = (select auth.uid())
    )
  );

create or replace function public.validate_message_read_sort_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.last_read_sort_id is not null and not exists (
    select 1
    from public.messages message
    where message.id = new.last_read_sort_id
      and message.chat_id = new.chat_id
  ) then
    raise exception 'Read position must belong to the same chat';
  end if;
  return new;
end;
$$;

revoke all on function public.validate_message_read_sort_id() from public, anon, authenticated;

drop trigger if exists message_reads_sort_id_same_chat on public.message_reads;
create trigger message_reads_sort_id_same_chat
  before insert or update of chat_id, last_read_sort_id on public.message_reads
  for each row execute function public.validate_message_read_sort_id();

create or replace function public.mark_chat_read(target_chat_id uuid)
returns public.message_reads
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  latest_message_id uuid;
  result public.message_reads;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.chat_members member
    where member.chat_id = target_chat_id and member.user_id = current_user_id
  ) then
    raise exception 'Chat not found or you are not a member';
  end if;

  select message.id into latest_message_id
  from public.messages message
  where message.chat_id = target_chat_id
  order by message.created_at desc, message.id desc
  limit 1;

  insert into public.message_reads (chat_id, user_id, last_read_sort_id, updated_at)
  values (target_chat_id, current_user_id, latest_message_id, now())
  on conflict (chat_id, user_id) do update
    set last_read_sort_id = excluded.last_read_sort_id,
        updated_at = excluded.updated_at
  returning * into result;

  update public.chat_member_settings
  set last_read_at = now()
  where chat_id = target_chat_id and user_id = current_user_id;

  return result;
end;
$$;

revoke all on function public.mark_chat_read(uuid) from public, anon;
grant execute on function public.mark_chat_read(uuid) to authenticated;

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
    and (last_seen_at is null or last_seen_at <= now() - interval '1 minute')
  returning last_seen_at into last_seen;

  if last_seen is null then
    select profile.last_seen_at into last_seen
    from public.profiles profile
    where profile.id = current_user_id;
  end if;
  return last_seen;
end;
$$;

create or replace function public.can_access_private_chat_topic(target_topic text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when target_topic ~ '^chat-live:[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    then exists (
      select 1
      from public.chat_members member
      where member.chat_id = substring(target_topic from 11)::uuid
        and member.user_id = (select auth.uid())
    )
    else false
  end;
$$;

revoke all on function public.can_access_private_chat_topic(text) from public, anon;
grant execute on function public.can_access_private_chat_topic(text) to authenticated;

alter table realtime.messages enable row level security;
drop policy if exists "Chat members can receive private live events" on realtime.messages;
create policy "Chat members can receive private live events"
  on realtime.messages for select to authenticated
  using (public.can_access_private_chat_topic(realtime.topic()));
drop policy if exists "Chat members can send private live events" on realtime.messages;
create policy "Chat members can send private live events"
  on realtime.messages for insert to authenticated
  with check (public.can_access_private_chat_topic(realtime.topic()));

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'message_reads'
  ) then
    alter publication supabase_realtime add table public.message_reads;
  end if;
end;
$$;
