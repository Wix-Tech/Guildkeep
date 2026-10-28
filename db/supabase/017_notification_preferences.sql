create table if not exists public.user_notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  mention_notifications_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.user_notification_preferences enable row level security;

drop policy if exists "Users can view their own notification preferences"
  on public.user_notification_preferences;
create policy "Users can view their own notification preferences"
  on public.user_notification_preferences for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.user_notification_preferences from public, anon;
grant select on public.user_notification_preferences to authenticated;

create or replace function public.get_my_mention_notifications_enabled()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  enabled boolean;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  select preference.mention_notifications_enabled into enabled
  from public.user_notification_preferences preference
  where preference.user_id = current_user_id;
  return coalesce(enabled, true);
end;
$$;

create or replace function public.update_my_mention_notifications_enabled(new_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if new_enabled is null then raise exception 'Choose whether mention alerts are enabled'; end if;
  insert into public.user_notification_preferences (user_id, mention_notifications_enabled)
  values (current_user_id, new_enabled)
  on conflict (user_id) do update
  set mention_notifications_enabled = excluded.mention_notifications_enabled,
      updated_at = now();
  return new_enabled;
end;
$$;

revoke all on function public.get_my_mention_notifications_enabled() from public, anon;
revoke all on function public.update_my_mention_notifications_enabled(boolean) from public, anon;

grant execute on function public.get_my_mention_notifications_enabled() to authenticated;
grant execute on function public.update_my_mention_notifications_enabled(boolean) to authenticated;
