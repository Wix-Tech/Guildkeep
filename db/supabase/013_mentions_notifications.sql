create table if not exists public.message_mentions (
  chat_id uuid not null references public.chats (id) on delete cascade,
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null,
  primary key (chat_id, message_id, user_id)
);

create index if not exists message_mentions_by_user_time
  on public.message_mentions (user_id, created_at desc);

alter table public.message_mentions enable row level security;
revoke all on public.message_mentions from public, anon, authenticated;
grant select on public.message_mentions to authenticated;

drop policy if exists "Recipients can view their message mentions" on public.message_mentions;
create policy "Recipients can view their message mentions"
  on public.message_mentions for select to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.capture_message_mentions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  mention_parts text[];
  chat_kind text;
begin
  if tg_op = 'UPDATE' then
    delete from public.message_mentions where message_id = old.id;
  end if;
  if new.deleted_at is not null then return new; end if;

  select chat.chat_type into chat_kind
  from public.chats chat
  where chat.id = new.chat_id;
  if chat_kind not in ('direct', 'group') then return new; end if;

  for mention_parts in
    select regexp_matches(
      new.body,
      '(^|[^[:alnum:]_])@([a-zA-Z0-9_]{3,24})',
      'g'
    )
  loop
    insert into public.message_mentions (chat_id, message_id, user_id, created_at)
    select new.chat_id, new.id, profile.id, new.created_at
    from public.profiles profile
    join public.chat_members member
      on member.user_id = profile.id and member.chat_id = new.chat_id
    where profile.username = lower(mention_parts[2])
      and profile.id <> new.sender_id
    on conflict do nothing;
  end loop;
  return new;
end;
$$;

revoke all on function public.capture_message_mentions() from public, anon, authenticated;

drop trigger if exists messages_capture_mentions on public.messages;
create trigger messages_capture_mentions
  after insert or update of body, deleted_at on public.messages
  for each row execute function public.capture_message_mentions();

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
        where member.chat_id = chat.id
          and member.user_id <> current_user_id
        limit 1
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
      and message.created_at > settings.last_read_at
    order by mention.created_at desc, mention.message_id desc
    limit 50;
end;
$$;

revoke all on function public.list_my_mentions() from public, anon;
grant execute on function public.list_my_mentions() to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'message_mentions'
  ) then
    alter publication supabase_realtime add table public.message_mentions;
  end if;
end;
$$;
