import { createClient } from '@supabase/supabase-js';

const config = import.meta.env;
const projectUrl = config.VITE_SUPABASE_URL?.trim();
const publishableKey = config.VITE_SUPABASE_ANON_KEY?.trim();

export const isConfigured = Boolean(projectUrl && publishableKey);
export const supabase = isConfigured
  ? createClient(projectUrl, publishableKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true,
      },
    })
  : null;

function client() {
  if (!supabase) throw new Error('Supabase is not configured for this build.');
  return supabase;
}

export async function signUp({ email, password, username, displayName }) {
  const { data, error } = await client().auth.signUp({
    email,
    password,
    options: { data: { username, display_name: displayName } },
  });
  if (error) throw error;
  return data;
}

export async function signIn({ email, password }) {
  const { data, error } = await client().auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await client().auth.signOut();
  if (error) throw error;
}

export async function getSession() {
  const { data, error } = await client().auth.getSession();
  if (error) throw error;
  return data.session;
}

export function onAuthChange(callback) {
  const { data } = client().auth.onAuthStateChange((event, session) => callback(event, session));
  return () => data.subscription.unsubscribe();
}

export async function getProfile(userId) {
  const { data, error } = await client()
    .from('profiles')
    .select('id, username, display_name, bio, avatar_path, status_visibility')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return data;
}

export async function getProfilePreview(userId) {
  const { data, error } = await client().rpc('profile_preview', {
    target_user_id: userId,
  });
  if (error) throw error;
  return data;
}

export async function touchMyPresence() {
  const { data, error } = await client().rpc('touch_my_presence');
  if (error) throw error;
  return data;
}

export async function setProfilePreviewMuted(userId, muted) {
  const { data, error } = await client().rpc('set_profile_preview_muted', {
    target_user_id: userId,
    new_muted: muted,
  });
  if (error) throw error;
  return data;
}

export async function setProfilePreviewBlocked(userId, blocked) {
  const { data, error } = await client().rpc('set_profile_preview_blocked', {
    target_user_id: userId,
    new_blocked: blocked,
  });
  if (error) throw error;
  return data;
}

export async function reportProfilePreview(userId, chatId, reason = '') {
  const { data, error } = await client().rpc('report_profile_preview', {
    target_user_id: userId,
    context_chat_id: chatId,
    report_reason: reason,
  });
  if (error) throw error;
  return data;
}

export async function listChats() {
  const { data, error } = await client().rpc('list_my_chats');
  if (error) throw error;
  return data ?? [];
}

export async function listMessages(chatId) {
  const { data, error } = await client()
    .from('messages')
    .select('id, chat_id, sender_id, body, created_at, media_path, media_type, file_name, voice_note, edited_at, deleted_at, forwarded_from, sender:profiles!messages_sender_id_fkey(display_name, username, avatar_path)')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data ?? []).reverse();
}

export async function sendMessage(chatId, senderId, body, media = null) {
  const { data, error } = await client()
    .from('messages')
    .insert({
      chat_id: chatId,
      sender_id: senderId,
      body,
      media_path: media?.path ?? null,
      media_type: media?.type ?? null,
      file_name: media?.name ?? null,
      voice_note: Boolean(media?.voiceNote),
    })
    .select('id, chat_id, sender_id, body, created_at, media_path, media_type, file_name, voice_note, edited_at, deleted_at, forwarded_from')
    .single();
  if (error) throw error;
  return data;
}

export async function createDirectChat(username) {
  const { data, error } = await client().rpc('create_direct_chat', {
    target_username: username,
  });
  if (error) throw error;
  return data;
}

export async function searchProfiles(searchTerm) {
  const { data, error } = await client().rpc('search_profiles_with_avatars', {
    search_term: searchTerm,
  });
  if (error) throw error;
  return data ?? [];
}

export async function setChatPinned(chatId, userId, pinned) {
  const { error } = await client()
    .from('chat_member_settings')
    .update({ pinned })
    .eq('chat_id', chatId)
    .eq('user_id', userId);
  if (error) throw error;
}

export async function updateMyProfile(displayName, bio, avatarPath = null) {
  const { data, error } = await client().rpc('update_my_profile', {
    new_display_name: displayName,
    new_bio: bio,
    new_avatar_path: avatarPath,
  });
  if (error) throw error;
  return data;
}

const storage = () => client().storage;

export async function uploadMedia(bucket, path, file, contentType = file.type) {
  const { data, error } = await storage().from(bucket).upload(path, file, {
    contentType,
    upsert: false,
  });
  if (error) throw error;
  return data.path;
}

export async function signedMediaUrl(bucket, path) {
  const { data, error } = await storage().from(bucket).createSignedUrl(path, 3600);
  if (error) throw error;
  return data.signedUrl;
}

export async function signedMediaUrls(bucket, paths) {
  if (!paths.length) return [];
  const { data, error } = await storage().from(bucket).createSignedUrls(paths, 3600);
  if (error) throw error;
  return data ?? [];
}

export function publicAvatarUrl(path) {
  return storage().from('profile-avatars').getPublicUrl(path).data.publicUrl;
}

export function publicChatAvatarUrl(path) {
  return storage().from('chat-avatars').getPublicUrl(path).data.publicUrl;
}

export async function removeMedia(bucket, path) {
  const { error } = await storage().from(bucket).remove([path]);
  if (error) throw error;
}

export async function downloadMedia(bucket, path) {
  const { data, error } = await storage().from(bucket).download(path);
  if (error) throw error;
  return data;
}

export async function createChannel(title, description) {
  const { data, error } = await client().rpc('create_channel', {
    channel_title: title,
    channel_about: description,
  });
  if (error) throw error;
  return data;
}

export async function listMyChannels() {
  const { data, error } = await client().rpc('list_my_channels');
  if (error) throw error;
  return data ?? [];
}

export async function discoverChannels(searchTerm = '') {
  const { data, error } = await client().rpc('discover_channels', {
    search_text: searchTerm,
  });
  if (error) throw error;
  return data ?? [];
}

export async function subscribeToChannel(chatId) {
  const { data, error } = await client().rpc('subscribe_to_channel', {
    target_channel_id: chatId,
  });
  if (error) throw error;
  return data;
}

export async function joinChannelByInvite(inviteCode) {
  const { data, error } = await client().rpc('join_channel_by_invite', {
    invite_token: inviteCode,
  });
  if (error) throw error;
  return data;
}

export async function updateChatSettings(chatId, settings) {
  const { data, error } = await client().rpc('update_chat_settings', {
    target_chat_id: chatId,
    new_title: settings.title,
    new_description: settings.description,
    new_avatar_path: settings.avatarPath,
    clear_avatar: settings.clearAvatar,
    new_channel_public: settings.channelPublic,
    new_group_locked: settings.groupLocked,
    new_announcement_mode: settings.announcementMode,
    new_slowmode_seconds: settings.slowmodeSeconds,
    new_antilink_enabled: settings.antilinkEnabled,
    new_group_rules: settings.groupRules,
  });
  if (error) throw error;
  return data;
}

export async function leaveChat(chatId) {
  const { error } = await client().rpc('leave_chat', {
    target_chat_id: chatId,
  });
  if (error) throw error;
}

export async function updateStatusVisibility(visibility) {
  const { data, error } = await client().rpc('update_status_visibility', {
    new_visibility: visibility,
  });
  if (error) throw error;
  return data;
}

export async function createStatus(statusId, body, mediaPath = null, mediaType = null) {
  const { data, error } = await client().rpc('create_status', {
    status_id: statusId,
    status_text: body,
    status_media_path: mediaPath,
    status_media_type: mediaType,
  });
  if (error) throw error;
  return data;
}

export async function deleteStatus(statusId) {
  const { data, error } = await client().rpc('delete_status', {
    target_status_id: statusId,
  });
  if (error) throw error;
  return data;
}

export async function listContactStatuses() {
  const { data, error } = await client().rpc('list_contact_statuses');
  if (error) throw error;
  return data ?? [];
}

export async function editMessage(messageId, body) {
  const { data, error } = await client().rpc('edit_message', {
    target_message_id: messageId,
    replacement_body: body,
  });
  if (error) throw error;
  return data;
}

export async function deleteMessage(messageId) {
  const { error } = await client().rpc('delete_message', {
    target_message_id: messageId,
  });
  if (error) throw error;
}

export async function forwardMessage(messageId, chatId, mediaPath = null) {
  const { data, error } = await client().rpc('forward_message', {
    source_message_id: messageId,
    destination_chat_id: chatId,
    destination_media_path: mediaPath,
  });
  if (error) throw error;
  return data;
}

export async function createGroup(title, usernames) {
  const { data, error } = await client().rpc('create_group', {
    group_title: title,
    member_usernames: usernames,
  });
  if (error) throw error;
  return data;
}

export async function joinGroupByInvite(inviteCode) {
  const { data, error } = await client().rpc('join_group_by_invite', {
    invite_token: inviteCode,
  });
  if (error) throw error;
  return data;
}

export async function runGroupCommand(chatId, command) {
  const { data, error } = await client().rpc('run_group_command', {
    target_chat_id: chatId,
    command_text: command,
  });
  if (error) throw error;
  return data?.[0] ?? { ok: false, message: 'The command returned no result.' };
}

export async function listGroupStatuses(chatId) {
  const { data, error } = await client().rpc('get_group_statuses', {
    target_chat_id: chatId,
  });
  if (error) throw error;
  return data ?? [];
}

export async function toggleMessageReaction(messageId, reaction) {
  const { data, error } = await client().rpc('toggle_message_reaction', {
    target_message_id: messageId,
    selected_reaction: reaction,
  });
  if (error) throw error;
  return data ?? [];
}

export async function listChatReactions(chatId) {
  const { data, error } = await client().rpc('list_chat_reactions', {
    target_chat_id: chatId,
  });
  if (error) throw error;
  return data ?? [];
}

export async function markChatRead(chatId, userId) {
  const { error } = await client()
    .from('chat_member_settings')
    .update({ last_read_at: new Date().toISOString() })
    .eq('chat_id', chatId)
    .eq('user_id', userId);
  if (error) throw error;
}

export function subscribeToMessages(chatId, onMessage, onStatus) {
  const channel = client()
    .channel(`chat:${chatId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'messages',
        filter: `chat_id=eq.${chatId}`,
      },
      (payload) => onMessage({ ...payload.new, eventType: payload.eventType }),
    )
    .subscribe(onStatus);
  return () => client().removeChannel(channel);
}

export function subscribeToChatChanges(chatId, onChange) {
  const channel = client()
    .channel(`chat-state:${chatId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'chats',
        filter: `id=eq.${chatId}`,
      },
      onChange,
    )
    .subscribe();
  return () => client().removeChannel(channel);
}

export function subscribeToMemberships(userId, onMembership) {
  const channel = client()
    .channel(`memberships:${userId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'chat_members',
        filter: `user_id=eq.${userId}`,
      },
      onMembership,
    )
    .subscribe();
  return () => client().removeChannel(channel);
}

export function subscribeToReactions(chatId, onReaction) {
  const channel = client()
    .channel(`chat-reactions:${chatId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'chat_reactions',
        filter: `chat_id=eq.${chatId}`,
      },
      onReaction,
    )
    .subscribe();
  return () => client().removeChannel(channel);
}
