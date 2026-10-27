alter table public.messages
  add column if not exists search_vector tsvector
  generated always as (to_tsvector('simple'::regconfig, coalesce(body, ''))) stored;

create index if not exists messages_search_vector_gin
  on public.messages using gin (search_vector);

create or replace function public.search_messages(
  search_term text,
  target_chat_id uuid default null,
  page_size integer default 25,
  page_offset integer default 0
)
returns table (
  message_id uuid,
  chat_id uuid,
  chat_name text,
  chat_type text,
  sender_id uuid,
  body text,
  created_at timestamptz,
  snippet text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  search_terms text[];
  search_query tsquery;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;
  if search_term is null or char_length(btrim(search_term)) < 2
    or char_length(search_term) > 100 then
    raise exception 'Search query must be between 2 and 100 characters';
  end if;
  if page_size is null or page_size < 1 or page_size > 50
    or page_offset is null or page_offset < 0 or page_offset > 5000 then
    raise exception 'Invalid search page';
  end if;

  select array_agg(quote_literal(token) || ':*' order by token)
    into search_terms
  from (
    select distinct token
    from regexp_split_to_table(lower(search_term), '[^[:alnum:]_]+') as split(token)
    where char_length(token) between 2 and 40
    order by token
    limit 9
  ) terms;

  if coalesce(cardinality(search_terms), 0) = 0 then
    raise exception 'Search query must contain a word of at least 2 characters';
  end if;
  if cardinality(search_terms) > 8 then
    raise exception 'Search query can contain at most 8 words';
  end if;
  search_query := to_tsquery('simple'::regconfig, array_to_string(search_terms, ' & '));

  if target_chat_id is not null and not exists (
    select 1
    from public.chats chat
    where chat.id = target_chat_id
      and (
        exists (
          select 1
          from public.chat_members member
          where member.chat_id = chat.id
            and member.user_id = current_user_id
        )
        or (chat.chat_type = 'channel' and chat.channel_public)
      )
  ) then
    raise exception 'Chat not found or access denied';
  end if;

  if target_chat_id is not null then
    return query
    select
      message.id,
      message.chat_id,
      case
        when chat.chat_type = 'direct' then (
          select profile.display_name
          from public.chat_members member
          join public.profiles profile on profile.id = member.user_id
          where member.chat_id = chat.id and member.user_id <> current_user_id
          limit 1
        )
        else chat.title
      end,
      chat.chat_type,
      message.sender_id,
      message.body,
      message.created_at,
      ts_headline(
        'simple'::regconfig,
        message.body,
        search_query,
        'StartSel=<mark>,StopSel=</mark>,MaxWords=28,MinWords=10,ShortWord=1'
      )
    from public.messages message
    join public.chats chat on chat.id = message.chat_id
    where message.chat_id = target_chat_id
      and message.search_vector @@ search_query
    order by message.created_at desc, message.id desc
    limit page_size
    offset page_offset;
  else
    return query
    select
      message.id,
      message.chat_id,
      case
        when chat.chat_type = 'direct' then (
          select profile.display_name
          from public.chat_members member
          join public.profiles profile on profile.id = member.user_id
          where member.chat_id = chat.id and member.user_id <> current_user_id
          limit 1
        )
        else chat.title
      end,
      chat.chat_type,
      message.sender_id,
      message.body,
      message.created_at,
      ts_headline(
        'simple'::regconfig,
        message.body,
        search_query,
        'StartSel=<mark>,StopSel=</mark>,MaxWords=28,MinWords=10,ShortWord=1'
      )
    from public.messages message
    join public.chats chat on chat.id = message.chat_id
    where message.search_vector @@ search_query
      and (
        exists (
          select 1
          from public.chat_members member
          where member.chat_id = message.chat_id
            and member.user_id = current_user_id
        )
        or (chat.chat_type = 'channel' and chat.channel_public)
      )
    order by message.created_at desc, message.id desc
    limit page_size
    offset page_offset;
  end if;
end;
$$;

revoke all on function public.search_messages(text, uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.search_messages(text, uuid, integer, integer) to authenticated;
