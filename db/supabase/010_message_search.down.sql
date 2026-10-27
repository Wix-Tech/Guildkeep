drop function if exists public.search_messages(text, uuid, integer, integer);
drop index if exists public.messages_search_vector_gin;
alter table public.messages drop column if exists search_vector;
