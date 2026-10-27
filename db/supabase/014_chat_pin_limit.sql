-- Apply after the existing Supabase migrations. Non-admin users are limited
-- to five pins per chat; group and channel admins may exceed that limit.
create or replace function public.enforce_chat_pin_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  chat_kind text;
  pin_count integer;
begin
  select chat.chat_type into chat_kind
  from public.chats chat
  where chat.id = new.chat_id
  for update;
  if chat_kind is null then raise exception 'Chat not found'; end if;
  if not public.can_manage_chat_pins(new.chat_id) then
    raise exception 'You cannot pin messages in this chat';
  end if;

  if chat_kind in ('group', 'channel') and exists (
    select 1
    from public.chat_members member
    where member.chat_id = new.chat_id
      and member.user_id = (select auth.uid())
      and member.role in ('owner', 'admin')
  ) then
    return new;
  end if;

  select count(*) into pin_count
  from public.chat_pins pin
  where pin.chat_id = new.chat_id;
  if pin_count >= 5 then
    raise exception 'A maximum of 5 messages can be pinned in this chat';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_chat_pin_limit() from public, anon, authenticated;

drop trigger if exists chat_pins_enforce_limit on public.chat_pins;
create trigger chat_pins_enforce_limit
  before insert on public.chat_pins
  for each row execute function public.enforce_chat_pin_limit();
