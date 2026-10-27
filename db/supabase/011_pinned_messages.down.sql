drop trigger if exists messages_remove_pin_on_delete on public.messages;
drop function if exists public.remove_deleted_message_pin();
drop trigger if exists chat_pins_validate_message on public.chat_pins;
drop function if exists public.validate_chat_pin_message();
drop policy if exists "Authorized chat members can unpin messages" on public.chat_pins;
drop policy if exists "Authorized chat members can pin messages" on public.chat_pins;
drop policy if exists "Chat members can view message pins" on public.chat_pins;
drop function if exists public.can_manage_chat_pins(uuid);
drop table if exists public.chat_pins;
