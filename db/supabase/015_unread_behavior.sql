alter table public.chat_member_settings
  add column if not exists muted boolean not null default false;

grant update (muted) on public.chat_member_settings to authenticated;
