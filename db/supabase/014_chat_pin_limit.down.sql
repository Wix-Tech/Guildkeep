do $$
begin
  if to_regclass('public.chat_pins') is not null then
    drop trigger if exists chat_pins_enforce_limit on public.chat_pins;
  end if;
end;
$$;

drop function if exists public.enforce_chat_pin_limit();
