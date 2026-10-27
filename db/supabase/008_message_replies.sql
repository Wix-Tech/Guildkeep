alter table public.messages
  add column if not exists reply_to_id uuid;

alter table public.messages
  drop constraint if exists messages_reply_to_id_fkey;

alter table public.messages
  add constraint messages_reply_to_id_fkey
  foreign key (reply_to_id) references public.messages (id) on delete set null;

grant insert (reply_to_id) on public.messages to authenticated;

create index if not exists messages_by_chat_reply_timeline
  on public.messages (chat_id, reply_to_id, created_at desc);

create or replace function public.enforce_message_reply_chat()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.reply_to_id is not null and not exists (
    select 1
    from public.messages target
    where target.id = new.reply_to_id
      and target.chat_id = new.chat_id
  ) then
    raise exception 'Reply target must belong to the same chat';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_message_reply_chat() from public, anon, authenticated;

drop trigger if exists messages_reply_target_same_chat on public.messages;
create trigger messages_reply_target_same_chat
  before insert or update of chat_id, reply_to_id on public.messages
  for each row execute function public.enforce_message_reply_chat();
