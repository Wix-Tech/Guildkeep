drop function if exists public.get_my_navigation_unread_counts();
drop function if exists public.mark_my_status_reaction_notifications_read();
drop function if exists public.list_my_status_reaction_notifications();
drop function if exists public.list_status_reactions(uuid[]);
drop function if exists public.toggle_status_reaction(uuid, text);
drop table if exists public.status_reactions;
