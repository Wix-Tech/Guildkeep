create table if not exists public.chat_pins (
  chat_id uuid not null references public.chats (id) on delete cascade,
  message_id uuid not null references public.messages (id) on delete cascade,
  pinned_by uuid not null references public.profiles (id) on delete cascade,
  pinned_at timestamptz not null default now(),
  primary key (chat_id, message_id)
);

create index if not exists chat_pins_by_chat_time
  on public.chat_pins (chat_id, pinned_at desc);

create or replace function public.can_manage_chat_pins(target_chat_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.chats chat
    join public.chat_members member on member.chat_id = chat.id
    where chat.id = target_chat_id
      and member.user_id = (select auth.uid())
      and (
        chat.chat_type = 'direct'
        or (chat.chat_type in ('group', 'channel') and member.role in ('owner', 'admin'))
      )
  );
$$;

revoke all on function public.can_manage_chat_pins(uuid) from public, anon;
grant execute on function public.can_manage_chat_pins(uuid) to authenticated;

create or replace function public.validate_chat_pin_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.messages message
    where message.id = new.message_id
      and message.chat_id = new.chat_id
      and message.deleted_at is null
  ) then
    raise exception 'Pinned message must be an active message in the same chat';
  end if;
  return new;
end;
$$;

revoke all on function public.validate_chat_pin_message() from public, anon, authenticated;

drop trigger if exists chat_pins_validate_message on public.chat_pins;
create trigger chat_pins_validate_message
  before insert or update of chat_id, message_id on public.chat_pins
  for each row execute function public.validate_chat_pin_message();

create or replace function public.remove_deleted_message_pin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.deleted_at is null and new.deleted_at is not null then
    delete from public.chat_pins where message_id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function public.remove_deleted_message_pin() from public, anon, authenticated;

drop trigger if exists messages_remove_pin_on_delete on public.messages;
create trigger messages_remove_pin_on_delete
  after update of deleted_at on public.messages
  for each row execute function public.remove_deleted_message_pin();

alter table public.chat_pins enable row level security;
revoke all on public.chat_pins from public, anon, authenticated;
grant select, insert, delete on public.chat_pins to authenticated;

drop policy if exists "Chat members can view message pins" on public.chat_pins;
create policy "Chat members can view message pins"
  on public.chat_pins for select to authenticated
  using (
    exists (
      select 1
      from public.chat_members member
      where member.chat_id = chat_pins.chat_id
        and member.user_id = (select auth.uid())
    )
    or exists (
      select 1
      from public.chats chat
      where chat.id = chat_pins.chat_id
        and chat.chat_type = 'channel'
        and chat.channel_public
    )
  );

drop policy if exists "Authorized chat members can pin messages" on public.chat_pins;
create policy "Authorized chat members can pin messages"
  on public.chat_pins for insert to authenticated
  with check (
    pinned_by = (select auth.uid())
    and public.can_manage_chat_pins(chat_id)
  );

drop policy if exists "Authorized chat members can unpin messages" on public.chat_pins;
create policy "Authorized chat members can unpin messages"
  on public.chat_pins for delete to authenticated
  using (public.can_manage_chat_pins(chat_id));

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_pins'
  ) then
    alter publication supabase_realtime add table public.chat_pins;
  end if;
end;
$$;
