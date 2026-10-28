create extension if not exists pg_net with schema extensions;

create table if not exists public.user_push_notification_preferences (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  direct_messages_enabled boolean not null default true,
  mentions_enabled boolean not null default true,
  group_channel_messages_enabled boolean not null default true,
  status_reactions_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique check (
    endpoint ~* '^https://([a-z0-9-]+\.)*(fcm\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)(/|$)'
  ),
  p256dh text not null check (length(p256dh) between 40 and 200),
  auth text not null check (length(auth) between 16 and 100),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists push_subscriptions_by_user
  on public.push_subscriptions (user_id);

create table if not exists public.push_notification_jobs (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null check (length(title) between 1 and 120),
  body text not null check (length(body) <= 220),
  data jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'failed')),
  attempts integer not null default 0 check (attempts between 0 and 5),
  processing_at timestamptz,
  delivered_subscription_ids uuid[] not null default '{}',
  last_error text,
  created_at timestamptz not null default now()
);

create index if not exists push_notification_jobs_pending
  on public.push_notification_jobs (created_at)
  where status in ('pending', 'processing');

alter table public.user_push_notification_preferences enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.push_notification_jobs enable row level security;

revoke all on public.user_push_notification_preferences from public, anon, authenticated;
revoke all on public.push_subscriptions from public, anon, authenticated;
revoke all on public.push_notification_jobs from public, anon, authenticated;
grant select, insert, update, delete on public.push_subscriptions to service_role;
grant select, update, delete on public.push_notification_jobs to service_role;

create or replace function public.get_my_push_notification_preferences()
returns table (
  direct_messages_enabled boolean,
  mentions_enabled boolean,
  group_channel_messages_enabled boolean,
  status_reactions_enabled boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  return query
    select coalesce(preference.direct_messages_enabled, true),
      coalesce(preference.mentions_enabled, true),
      coalesce(preference.group_channel_messages_enabled, true),
      coalesce(preference.status_reactions_enabled, true)
    from (select current_user_id as user_id) my_user
    left join public.user_push_notification_preferences preference
      on preference.user_id = my_user.user_id;
end;
$$;

create or replace function public.update_my_push_notification_preferences(
  new_direct_messages_enabled boolean,
  new_mentions_enabled boolean,
  new_group_channel_messages_enabled boolean,
  new_status_reactions_enabled boolean
)
returns table (
  direct_messages_enabled boolean,
  mentions_enabled boolean,
  group_channel_messages_enabled boolean,
  status_reactions_enabled boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if new_direct_messages_enabled is null
    or new_mentions_enabled is null
    or new_group_channel_messages_enabled is null
    or new_status_reactions_enabled is null then
    raise exception 'Choose notification preferences for every event type';
  end if;
  return query
    insert into public.user_push_notification_preferences (
      user_id,
      direct_messages_enabled,
      mentions_enabled,
      group_channel_messages_enabled,
      status_reactions_enabled,
      updated_at
    )
    values (
      current_user_id,
      new_direct_messages_enabled,
      new_mentions_enabled,
      new_group_channel_messages_enabled,
      new_status_reactions_enabled,
      now()
    )
    on conflict (user_id) do update
      set direct_messages_enabled = excluded.direct_messages_enabled,
          mentions_enabled = excluded.mentions_enabled,
          group_channel_messages_enabled = excluded.group_channel_messages_enabled,
          status_reactions_enabled = excluded.status_reactions_enabled,
          updated_at = now()
    returning
      user_push_notification_preferences.direct_messages_enabled,
      user_push_notification_preferences.mentions_enabled,
      user_push_notification_preferences.group_channel_messages_enabled,
      user_push_notification_preferences.status_reactions_enabled;
end;
$$;

create or replace function public.upsert_my_push_subscription(
  target_endpoint text,
  target_p256dh text,
  target_auth text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  subscription_id uuid;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if target_endpoint is null or target_endpoint !~*
    '^https://([a-z0-9-]+\.)*(fcm\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)(/|$)'
    or length(target_endpoint) > 2048
    or target_p256dh is null or length(target_p256dh) not between 40 and 200
    or target_auth is null or length(target_auth) not between 16 and 100 then
    raise exception 'Invalid push subscription';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  values (current_user_id, target_endpoint, target_p256dh, target_auth)
  on conflict (endpoint) do update
    set user_id = excluded.user_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        last_seen_at = now()
  returning id into subscription_id;
  return subscription_id;
end;
$$;

create or replace function public.remove_my_push_subscription(target_endpoint text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  removed_count integer;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if target_endpoint is null or length(target_endpoint) > 2048 then
    raise exception 'Invalid push subscription endpoint';
  end if;
  delete from public.push_subscriptions subscription
  where subscription.user_id = current_user_id
    and subscription.endpoint = target_endpoint;
  get diagnostics removed_count = row_count;
  return removed_count > 0;
end;
$$;

revoke all on function public.get_my_push_notification_preferences() from public, anon;
revoke all on function public.update_my_push_notification_preferences(boolean, boolean, boolean, boolean) from public, anon;
revoke all on function public.upsert_my_push_subscription(text, text, text) from public, anon;
revoke all on function public.remove_my_push_subscription(text) from public, anon;
grant execute on function public.get_my_push_notification_preferences() to authenticated;
grant execute on function public.update_my_push_notification_preferences(boolean, boolean, boolean, boolean) to authenticated;
grant execute on function public.upsert_my_push_subscription(text, text, text) to authenticated;
grant execute on function public.remove_my_push_subscription(text) to authenticated;

create or replace function public.claim_push_notification_jobs(target_job_ids bigint[])
returns table (
  id bigint,
  user_id uuid,
  title text,
  body text,
  data jsonb,
  attempts integer,
  delivered_subscription_ids uuid[]
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Service role required';
  end if;
  return query
    update public.push_notification_jobs job
    set status = 'processing',
        attempts = job.attempts + 1,
        processing_at = now()
    where job.id = any(coalesce(target_job_ids, '{}'::bigint[]))
      and job.attempts < 5
      and (
        job.status = 'pending'
        or (job.status = 'processing' and job.processing_at < now() - interval '3 minutes')
      )
    returning job.id, job.user_id, job.title, job.body, job.data,
      job.attempts, job.delivered_subscription_ids;
end;
$$;

revoke all on function public.claim_push_notification_jobs(bigint[]) from public, anon, authenticated;
grant execute on function public.claim_push_notification_jobs(bigint[]) to service_role;

create or replace function public.dispatch_pending_push_notifications()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  configured_project_url text;
  webhook_secret text;
  job record;
  dispatched_count integer := 0;
begin
  if to_regclass('vault.decrypted_secrets') is null
    or to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    return 0;
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1'
    into configured_project_url using 'guildkeep_supabase_url';
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1'
    into webhook_secret using 'guildkeep_push_webhook_secret';
  if configured_project_url is null
    or configured_project_url !~ '^https://[a-z0-9-]+[.]supabase[.]co/?$'
    or length(coalesce(webhook_secret, '')) < 32 then
    return 0;
  end if;

  for job in
    select pending.id
    from public.push_notification_jobs pending
    where pending.attempts < 5
      and (
        pending.status = 'pending'
        or (pending.status = 'processing'
          and pending.processing_at < now() - interval '3 minutes')
      )
    order by pending.created_at
    limit 100
  loop
    begin
      perform net.http_post(
        url := rtrim(configured_project_url, '/') || '/functions/v1/push-notifications',
        body := jsonb_build_object('job_ids', jsonb_build_array(job.id)),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-push-webhook-secret', webhook_secret
        ),
        timeout_milliseconds := 2000
      );
      dispatched_count := dispatched_count + 1;
    exception when others then
      update public.push_notification_jobs pending
      set last_error = 'Push dispatch will be retried.'
      where pending.id = job.id;
    end;
  end loop;
  return dispatched_count;
end;
$$;

revoke all on function public.dispatch_pending_push_notifications() from public, anon, authenticated;

create or replace function public.enqueue_message_push_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  chat_kind text;
  chat_title text;
  sender_name text;
  message_preview text;
begin
  if new.deleted_at is not null then return new; end if;
  select chat.chat_type, coalesce(chat.title, '')
    into chat_kind, chat_title
  from public.chats chat
  where chat.id = new.chat_id;
  if chat_kind not in ('direct', 'group', 'channel') then return new; end if;

  select profile.display_name into sender_name
  from public.profiles profile
  where profile.id = new.sender_id;
  message_preview := left(
    btrim(regexp_replace(
      coalesce(new.body, ''),
      '\[\[guildkeep-(sticker|gif):[^\]]+\]\]',
      '',
      'g'
    )),
    180
  );
  if message_preview = '' then
    message_preview := case
      when new.voice_note then 'Sent a voice message'
      when new.media_path is not null then coalesce(new.file_name, 'Sent an attachment')
      else 'Sent a message'
    end;
  end if;

  insert into public.push_notification_jobs (user_id, title, body, data)
  select member.user_id,
    left(case
      when chat_kind = 'direct' then coalesce(sender_name, 'New message')
      when mention_match.is_mention then coalesce(sender_name, 'New mention') || ' mentioned you · ' || chat_title
      else coalesce(sender_name, 'New message') || ' · ' || chat_title
    end, 120),
    message_preview,
    jsonb_build_object(
      'type', 'message',
      'chat_id', new.chat_id,
      'message_id', new.id
    )
  from public.chat_members member
  join public.profiles recipient on recipient.id = member.user_id
  join public.chat_member_settings settings
    on settings.chat_id = member.chat_id and settings.user_id = member.user_id
  left join public.user_push_notification_preferences preference
    on preference.user_id = member.user_id
  left join public.user_notification_preferences mention_preference
    on mention_preference.user_id = member.user_id
  cross join lateral (
    select chat_kind in ('group', 'channel')
      and new.body ~* (
        '(^|[^[:alnum:]_])@' || recipient.username || '([^[:alnum:]_]|$)'
      ) as is_mention
  ) mention_match
  where member.chat_id = new.chat_id
    and member.user_id <> new.sender_id
    and coalesce(settings.muted, false) = false
    and exists (
      select 1 from public.push_subscriptions subscription
      where subscription.user_id = member.user_id
    )
    and (
      (chat_kind = 'direct'
        and coalesce(preference.direct_messages_enabled, true))
      or (
        chat_kind in ('group', 'channel')
        and mention_match.is_mention
        and coalesce(preference.mentions_enabled, true)
        and coalesce(mention_preference.mention_notifications_enabled, true)
      )
      or (
        chat_kind in ('group', 'channel')
        and not mention_match.is_mention
        and coalesce(preference.group_channel_messages_enabled, true)
      )
    );
  perform public.dispatch_pending_push_notifications();
  return new;
end;
$$;

create or replace function public.enqueue_status_reaction_push_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  status_author_id uuid;
  status_body text;
  reactor_name text;
begin
  if tg_op = 'UPDATE' and old.reaction is not distinct from new.reaction then
    return new;
  end if;
  select status.author_id, status.body into status_author_id, status_body
  from public.status_posts status
  where status.id = new.status_id
    and status.expires_at > now();
  if status_author_id is null or status_author_id = new.user_id then return new; end if;
  select profile.display_name into reactor_name
  from public.profiles profile
  where profile.id = new.user_id;
  insert into public.push_notification_jobs (user_id, title, body, data)
  select status_author_id,
    coalesce(reactor_name, 'Someone') || ' reacted to your status',
    left(new.reaction || case
      when nullif(btrim(status_body), '') is null then ''
      else ' · ' || btrim(status_body)
    end, 220),
    jsonb_build_object('type', 'status_reaction', 'status_id', new.status_id)
  from public.profiles author
  left join public.user_push_notification_preferences preference
    on preference.user_id = author.id
  where author.id = status_author_id
    and coalesce(preference.status_reactions_enabled, true)
    and exists (
      select 1 from public.push_subscriptions subscription
      where subscription.user_id = status_author_id
    );
  perform public.dispatch_pending_push_notifications();
  return new;
end;
$$;

revoke all on function public.enqueue_message_push_notifications() from public, anon, authenticated;
revoke all on function public.enqueue_status_reaction_push_notification() from public, anon, authenticated;

drop trigger if exists messages_enqueue_push_notifications on public.messages;
create trigger messages_enqueue_push_notifications
  after insert on public.messages
  for each row execute function public.enqueue_message_push_notifications();

drop trigger if exists status_reactions_enqueue_push_notification on public.status_reactions;
create trigger status_reactions_enqueue_push_notification
  after insert or update on public.status_reactions
  for each row execute function public.enqueue_status_reaction_push_notification();

do $$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is not null then
    if to_regclass('cron.job') is not null then
      execute 'select cron.unschedule(jobid) from cron.job where jobname = $1'
        using 'guildkeep-push-dispatch';
      execute 'select cron.unschedule(jobid) from cron.job where jobname = $1'
        using 'guildkeep-push-cleanup';
    end if;
    execute 'select cron.schedule($1, $2, $3)'
      using 'guildkeep-push-dispatch', '* * * * *',
        'select public.dispatch_pending_push_notifications();';
    execute 'select cron.schedule($1, $2, $3)'
      using 'guildkeep-push-cleanup', '17 * * * *',
        'delete from public.push_notification_jobs where created_at < now() - interval ''7 days'';';
  end if;
end;
$$;
