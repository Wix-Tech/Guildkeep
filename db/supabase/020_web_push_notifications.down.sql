do $$
begin
  if to_regprocedure('cron.unschedule(bigint)') is not null
    and to_regclass('cron.job') is not null then
    execute 'select cron.unschedule(jobid) from cron.job where jobname = $1'
      using 'guildkeep-push-dispatch';
    execute 'select cron.unschedule(jobid) from cron.job where jobname = $1'
      using 'guildkeep-push-cleanup';
  end if;
end;
$$;

drop trigger if exists status_reactions_enqueue_push_notification on public.status_reactions;
drop trigger if exists messages_enqueue_push_notifications on public.messages;
drop function if exists public.enqueue_status_reaction_push_notification();
drop function if exists public.enqueue_message_push_notifications();
drop function if exists public.dispatch_pending_push_notifications();
drop function if exists public.claim_push_notification_jobs(bigint[]);
drop function if exists public.remove_my_push_subscription(text);
drop function if exists public.upsert_my_push_subscription(text, text, text);
drop function if exists public.update_my_push_notification_preferences(boolean, boolean, boolean, boolean);
drop function if exists public.get_my_push_notification_preferences();
drop table if exists public.push_notification_jobs;
drop table if exists public.push_subscriptions;
drop table if exists public.user_push_notification_preferences;
