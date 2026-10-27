drop trigger if exists messages_capture_mentions on public.messages;
drop function if exists public.capture_message_mentions();
drop function if exists public.list_my_mentions();
drop table if exists public.message_mentions;
