drop trigger if exists chat_reactions_set_chat_id on public.chat_reactions;
drop function if exists public.set_chat_reaction_chat_id();

drop policy if exists "Members can view chat reactions" on public.chat_reactions;
create policy "Members can view chat reactions"
  on public.chat_reactions for select to authenticated
  using (
    exists (
      select 1
      from public.messages message
      join public.chat_members member on member.chat_id = message.chat_id
      where message.id = chat_reactions.message_id
        and member.user_id = (select auth.uid())
    )
  );

drop policy if exists "Members can react as themselves" on public.chat_reactions;
create policy "Members can react as themselves"
  on public.chat_reactions for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.messages message
      join public.chat_members member on member.chat_id = message.chat_id
      where message.id = chat_reactions.message_id
        and member.user_id = (select auth.uid())
    )
  );

drop policy if exists "Users can remove their own reactions" on public.chat_reactions;
create policy "Users can remove their own reactions"
  on public.chat_reactions for delete to authenticated
  using (user_id = (select auth.uid()));

alter table public.chat_reactions
  drop constraint if exists chat_reactions_message_chat_fkey,
  drop column if exists chat_id;

drop index if exists public.chat_reactions_by_chat_message;
drop index if exists public.messages_id_chat_id;
