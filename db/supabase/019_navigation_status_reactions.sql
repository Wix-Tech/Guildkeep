create table if not exists public.status_reactions (
  status_id uuid not null references public.status_posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  reaction text not null check (reaction in ('👍', '❤️', '😂', '😮', '😢', '🙏')),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  primary key (status_id, user_id)
);

create index if not exists status_reactions_by_status
  on public.status_reactions (status_id, created_at desc);

create index if not exists status_reactions_unread_by_user
  on public.status_reactions (read_at, created_at desc);

alter table public.status_reactions enable row level security;
alter table public.status_reactions replica identity full;
revoke all on public.status_reactions from public, anon, authenticated;
grant select on public.status_reactions to authenticated;

drop policy if exists "Contacts can view reactions to visible statuses" on public.status_reactions;
create policy "Contacts can view reactions to visible statuses"
  on public.status_reactions for select to authenticated
  using (
    exists (
      select 1
      from public.status_posts status
      where status.id = status_reactions.status_id
        and public.can_view_status(status.author_id, status.expires_at)
    )
  );

create or replace function public.toggle_status_reaction(
  target_status_id uuid,
  selected_reaction text
)
returns table (reaction text, count integer, reacted_by_me boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  status_author_id uuid;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if selected_reaction not in ('👍', '❤️', '😂', '😮', '😢', '🙏') then
    raise exception 'Unsupported reaction';
  end if;

  select status.author_id into status_author_id
  from public.status_posts status
  where status.id = target_status_id
    and public.can_view_status(status.author_id, status.expires_at)
  for update;
  if status_author_id is null then raise exception 'Status not found'; end if;
  if status_author_id = current_user_id then
    raise exception 'You cannot react to your own status';
  end if;

  if exists (
    select 1 from public.status_reactions reaction_row
    where reaction_row.status_id = target_status_id
      and reaction_row.user_id = current_user_id
      and reaction_row.reaction = selected_reaction
  ) then
    delete from public.status_reactions reaction_row
    where reaction_row.status_id = target_status_id
      and reaction_row.user_id = current_user_id;
  else
    insert into public.status_reactions (status_id, user_id, reaction, created_at, read_at)
    values (target_status_id, current_user_id, selected_reaction, now(), null)
    on conflict (status_id, user_id) do update
      set reaction = excluded.reaction,
          created_at = excluded.created_at,
          read_at = null;
  end if;

  return query
    select reaction_row.reaction, count(*)::integer,
      bool_or(reaction_row.user_id = current_user_id)
    from public.status_reactions reaction_row
    where reaction_row.status_id = target_status_id
    group by reaction_row.reaction
    order by min(reaction_row.created_at);
end;
$$;

create or replace function public.list_status_reactions(target_status_ids uuid[])
returns table (
  status_id uuid,
  user_id uuid,
  author_id uuid,
  username text,
  display_name text,
  reaction text,
  created_at timestamptz,
  read_at timestamptz
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
    select reaction_row.status_id, reaction_row.user_id, status.author_id,
      profile.username, profile.display_name, reaction_row.reaction,
      reaction_row.created_at, reaction_row.read_at
    from public.status_reactions reaction_row
    join public.status_posts status on status.id = reaction_row.status_id
    join public.profiles profile on profile.id = reaction_row.user_id
    where public.can_view_status(status.author_id, status.expires_at)
      and (target_status_ids is null or status.id = any(target_status_ids))
    order by reaction_row.created_at, reaction_row.status_id;
end;
$$;

create or replace function public.list_my_status_reaction_notifications()
returns table (
  status_id uuid,
  reactor_name text,
  reactor_username text,
  reaction text,
  status_body text,
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
    select status.id, reactor.display_name, reactor.username,
      reaction_row.reaction, status.body, reaction_row.created_at
    from public.status_reactions reaction_row
    join public.status_posts status on status.id = reaction_row.status_id
    join public.profiles reactor on reactor.id = reaction_row.user_id
    where status.author_id = current_user_id
      and status.expires_at > now()
      and reaction_row.read_at is null
    order by reaction_row.created_at desc, reaction_row.status_id
    limit 50;
end;
$$;

create or replace function public.mark_my_status_reaction_notifications_read()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  marked_count integer;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  update public.status_reactions reaction_row
  set read_at = now()
  from public.status_posts status
  where status.id = reaction_row.status_id
    and status.author_id = current_user_id
    and status.expires_at > now()
    and reaction_row.read_at is null;
  get diagnostics marked_count = row_count;
  return marked_count;
end;
$$;

create or replace function public.get_my_navigation_unread_counts()
returns table (direct_unread integer, group_unread integer, channel_unread integer)
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
    select
      coalesce(sum(chat_unreads.unread_count) filter (where chat_unreads.chat_type = 'direct'), 0)::integer,
      coalesce(sum(chat_unreads.unread_count) filter (where chat_unreads.chat_type = 'group'), 0)::integer,
      coalesce(sum(chat_unreads.unread_count) filter (where chat_unreads.chat_type = 'channel'), 0)::integer
    from (
      select chat.chat_type,
        (
          select count(*)::integer
          from public.messages message
          where message.chat_id = chat.id
            and message.sender_id <> current_user_id
            and message.deleted_at is null
            and message.created_at > settings.last_read_at
            and (message.expires_at is null or message.expires_at > now())
        ) as unread_count
      from public.chats chat
      join public.chat_members member
        on member.chat_id = chat.id and member.user_id = current_user_id
      join public.chat_member_settings settings
        on settings.chat_id = chat.id and settings.user_id = current_user_id
      where chat.chat_type in ('direct', 'group', 'channel')
    ) chat_unreads;
end;
$$;

revoke all on function public.toggle_status_reaction(uuid, text) from public, anon;
revoke all on function public.list_status_reactions(uuid[]) from public, anon;
revoke all on function public.list_my_status_reaction_notifications() from public, anon;
revoke all on function public.mark_my_status_reaction_notifications_read() from public, anon;
revoke all on function public.get_my_navigation_unread_counts() from public, anon;
grant execute on function public.toggle_status_reaction(uuid, text) to authenticated;
grant execute on function public.list_status_reactions(uuid[]) to authenticated;
grant execute on function public.list_my_status_reaction_notifications() to authenticated;
grant execute on function public.mark_my_status_reaction_notifications_read() to authenticated;
grant execute on function public.get_my_navigation_unread_counts() to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'status_reactions'
  ) then
    alter publication supabase_realtime add table public.status_reactions;
  end if;
end;
$$;

notify pgrst, 'reload schema';
