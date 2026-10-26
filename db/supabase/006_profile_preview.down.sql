drop policy if exists "Members can send their own messages" on public.messages;
create policy "Members can send their own messages"
  on public.messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and exists (
      select 1
      from public.chat_members member
      join public.chats chat on chat.id = member.chat_id
      where member.chat_id = public.messages.chat_id
        and member.user_id = (select auth.uid())
        and (chat.chat_type <> 'channel' or member.role in ('owner', 'admin'))
    )
  );

drop function if exists public.is_profile_blocked_between(uuid, uuid);
drop function if exists public.report_profile_preview(uuid, uuid, text);
drop function if exists public.set_profile_preview_blocked(uuid, boolean);
drop function if exists public.set_profile_preview_muted(uuid, boolean);
drop function if exists public.profile_preview(uuid);
drop function if exists public.touch_my_presence();

drop table if exists public.profile_preview_reports;
drop table if exists public.profile_preview_settings;
alter table public.profiles drop column if exists last_seen_at;
