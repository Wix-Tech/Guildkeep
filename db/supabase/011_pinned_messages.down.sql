drop trigger if exists messages_remove_pin_on_delete on public.messages;
drop function if exists public.remove_deleted_message_pin();
drop table if exists public.chat_pins;
drop function if exists public.validate_chat_pin_message();
drop function if exists public.can_manage_chat_pins(uuid);
