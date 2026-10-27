drop trigger if exists messages_reply_target_same_chat on public.messages;
drop function if exists public.enforce_message_reply_chat();
drop index if exists public.messages_by_chat_reply_timeline;
alter table public.messages
  drop constraint if exists messages_reply_to_id_fkey;
alter table public.messages
  drop column if exists reply_to_id;
