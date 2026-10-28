do $$
declare
  scheduled_job record;
begin
  for scheduled_job in
    select jobid from cron.job where jobname = 'guildkeep-expire-messages'
  loop
    perform cron.unschedule(scheduled_job.jobid);
  end loop;
end;
$$;

update public.chats set disappearing_after_seconds = 0;
update public.messages set expires_at = null where expires_at is not null;

drop trigger if exists messages_set_expiration on public.messages;
drop function if exists public.set_message_expiration();
drop function if exists public.get_chat_disappearing_timer(uuid);
drop function if exists public.set_chat_disappearing_timer(uuid, integer);
