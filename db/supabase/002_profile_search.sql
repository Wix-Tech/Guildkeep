create or replace function public.search_profiles(search_term text)
returns table (
  id uuid,
  username text,
  display_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  normalized_term text;
  escaped_term text;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  normalized_term := lower(regexp_replace(btrim(coalesce(search_term, '')), '^@', ''));
  if char_length(normalized_term) < 2
    or char_length(normalized_term) > 40
    or normalized_term ~ '[[:cntrl:]]'
  then
    return;
  end if;

  escaped_term := replace(
    replace(
      replace(normalized_term, '\', '\\'),
      '%', '\%'
    ),
    '_', '\_'
  );
  return query
    select profile.id, profile.username, profile.display_name
    from public.profiles profile
    where profile.id <> current_user_id
      and (
        profile.username ilike escaped_term || '%' escape '\'
        or profile.display_name ilike escaped_term || '%' escape '\'
      )
    order by
      case when profile.username ilike escaped_term || '%' escape '\' then 0 else 1 end,
      profile.display_name
    limit 20;
end;
$$;

revoke all on function public.search_profiles(text) from public, anon;
grant execute on function public.search_profiles(text) to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise exception 'Create the Supabase Realtime publication before applying this migration';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_members'
  ) then
    alter publication supabase_realtime add table public.chat_members;
  end if;
end;
$$;
