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
    select 1
    from public.chat_members member
    where member.chat_id = target_chat_id
      and member.user_id = current_user_id
  ) then
    raise exception 'Chat not found or you are not a member';
  end if;

  select message.created_at into incoming_message_at
  from public.messages message
  where message.chat_id = target_chat_id
    and message.sender_id <> current_user_id
    and message.deleted_at is null
  order by message.created_at desc, message.id desc
  limit 1;

  if incoming_message_at is null then
    raise exception 'No received messages to mark unread';
  end if;
  unread_cursor := incoming_message_at - interval '1 microsecond';

  insert into public.chat_member_settings (chat_id, user_id, last_read_at)
  values (target_chat_id, current_user_id, unread_cursor)
  on conflict (chat_id, user_id) do update
    set last_read_at = excluded.last_read_at;

  return unread_cursor;
end;
$$;

revoke all on function public.mark_chat_unread(uuid) from public, anon;
grant execute on function public.mark_chat_unread(uuid) to authenticated;
