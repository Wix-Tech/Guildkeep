drop policy if exists "Chat members can receive private live events" on realtime.messages;
drop policy if exists "Chat members can send private live events" on realtime.messages;

drop function if exists public.can_access_private_chat_topic(text);
drop function if exists public.mark_chat_read(uuid);
drop trigger if exists message_reads_sort_id_same_chat on public.message_reads;
drop function if exists public.validate_message_read_sort_id();
drop table if exists public.message_reads;

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
