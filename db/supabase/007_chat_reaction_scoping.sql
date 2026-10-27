alter table public.chat_reactions
  add column if not exists chat_id uuid;

update public.chat_reactions reaction
set chat_id = message.chat_id
from public.messages message
where message.id = reaction.message_id
  and reaction.chat_id is distinct from message.chat_id;

create unique index if not exists messages_id_chat_id
  on public.messages (id, chat_id);

alter table public.chat_reactions
  alter column chat_id set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.chat_reactions'::regclass
      and conname = 'chat_reactions_message_chat_fkey'
  ) then
    alter table public.chat_reactions
      add constraint chat_reactions_message_chat_fkey
      foreign key (message_id, chat_id)
      references public.messages (id, chat_id)
      on delete cascade;
  end if;
end;
$$;

create or replace function public.set_chat_reaction_chat_id()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  message_chat_id uuid;
begin
  select message.chat_id into message_chat_id
  from public.messages message
  where message.id = new.message_id;

  if message_chat_id is null then
    raise exception 'Message not found';
  end if;
  if new.chat_id is not null and new.chat_id <> message_chat_id then
    raise exception 'Reaction chat does not match message chat';
  end if;

  new.chat_id := message_chat_id;
  return new;
end;
$$;

drop trigger if exists chat_reactions_set_chat_id on public.chat_reactions;
create trigger chat_reactions_set_chat_id
  before insert or update of message_id, chat_id on public.chat_reactions
  for each row execute function public.set_chat_reaction_chat_id();

create index if not exists chat_reactions_by_chat_message
  on public.chat_reactions (chat_id, message_id);

drop policy if exists "Members can view chat reactions" on public.chat_reactions;
create policy "Members can view chat reactions"
  on public.chat_reactions for select to authenticated
  using (
    exists (
      select 1 from public.chat_members member
      where member.chat_id = chat_reactions.chat_id
        and member.user_id = (select auth.uid())
    )
  );

drop policy if exists "Members can react as themselves" on public.chat_reactions;
create policy "Members can react as themselves"
  on public.chat_reactions for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.chat_members member
      where member.chat_id = chat_reactions.chat_id
        and member.user_id = (select auth.uid())
    )
  );

drop policy if exists "Users can remove their own reactions" on public.chat_reactions;
create policy "Users can remove their own reactions"
  on public.chat_reactions for delete to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.chat_members member
      where member.chat_id = chat_reactions.chat_id
        and member.user_id = (select auth.uid())
    )
  );

alter table public.chat_reactions replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'chat_reactions'
    ) then
    alter publication supabase_realtime add table public.chat_reactions;
  end if;
end;
$$;
