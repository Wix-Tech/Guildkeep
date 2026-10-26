import './live-styles.css';
import brandLogoUrl from '../brand/logo.svg';
import {
  createDirectChat,
  createGroup,
  createChannel,
  createStatus,
  deleteMessage,
  deleteStatus,
  discoverChannels,
  downloadMedia,
  editMessage,
  forwardMessage,
  getProfile,
  getSession,
  isConfigured,
  joinGroupByInvite,
  joinChannelByInvite,
  leaveChat,
  listChats,
  listGroupStatuses,
  listChatReactions,
  listContactStatuses,
  listMessages,
  listMyChannels,
  markChatRead,
  onAuthChange,
  runGroupCommand,
  sendMessage,
  searchProfiles,
  setChatPinned,
  signedMediaUrl,
  publicAvatarUrl,
  publicChatAvatarUrl,
  removeMedia,
  uploadMedia,
  subscribeToChannel,
  subscribeToReactions,
  subscribeToChatChanges,
  signIn,
  signOut,
  signUp,
  subscribeToMessages,
  subscribeToMemberships,
  toggleMessageReaction,
  updateMyProfile,
  updateChatSettings,
  updateStatusVisibility,
} from './supabase-chat.mjs';

const $ = (id) => document.getElementById(id);
const state = {
  session: null,
  profile: null,
  chats: [],
  activeChatId: null,
  messages: [],
  unsubscribeMessages: null,
  unsubscribeChat: null,
  unsubscribeMemberships: null,
  unsubscribeReactions: null,
  authMode: 'signin',
  loadingMessages: false,
  initializingUserId: null,
  peopleSearchSequence: 0,
  sidebarPeopleSearchSequence: 0,
  sidebarPeople: [],
  sidebarPeoplePending: false,
  peopleSearchResults: [],
  groupMemberSearchSequence: 0,
  groupMemberResults: [],
  selectedGroupMembers: new Map(),
  reactions: new Map(),
  pendingInviteHandled: false,
  currentView: 'chats',
  channels: [],
  discoveredChannels: [],
  statuses: [],
  selectedMessageId: null,
  messagePressTimer: null,
  voiceRecorder: null,
  voiceChunks: [],
  voiceStartedAt: 0,
  voiceTimer: null,
  pendingProfileAvatar: null,
};

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (character) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
  );

function setStatus(element, message, isError = false) {
  element.textContent = message;
  element.classList.toggle('is-error', isError);
}

function showToast(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => toast.classList.remove('show'), 2400);
}

function friendlyError(error) {
  const message = String(error?.message ?? error ?? 'Something went wrong.');
  if (/invalid login credentials/i.test(message)) return 'Email or password is incorrect.';
  if (/user already registered/i.test(message)) return 'That email already has an account.';
  if (/username.*(unique|duplicate)|duplicate key/i.test(message)) return 'That username is already taken.';
  return message;
}

function setAuthMode(mode) {
  state.authMode = mode;
  const signup = mode === 'signup';
  $('auth-title').textContent = signup ? 'Create your account' : 'Welcome back';
  $('auth-intro').textContent = signup
    ? 'Choose a username so people can start a chat with you.'
    : 'Sign in to continue your conversations.';
  $('display-name-field').hidden = !signup;
  $('username-field').hidden = !signup;
  $('auth-form').elements.display_name.required = signup;
  $('auth-form').elements.username.required = signup;
  $('auth-form').elements.password.autocomplete = signup ? 'new-password' : 'current-password';
  $('auth-submit').textContent = signup ? 'Create account' : 'Sign in';
  $('auth-toggle').textContent = signup ? 'Already have an account? Sign in' : 'Create an account';
  setStatus($('auth-status'), '');
}

document.querySelectorAll('.brand-logo').forEach((image) => {
  image.src = brandLogoUrl;
});

function clearWorkspace() {
  state.unsubscribeMessages?.();
  state.unsubscribeChat?.();
  state.unsubscribeMemberships?.();
  state.unsubscribeReactions?.();
  state.unsubscribeMessages = null;
  state.unsubscribeChat = null;
  state.unsubscribeMemberships = null;
  state.unsubscribeReactions = null;
  state.session = null;
  state.initializingUserId = null;
  state.profile = null;
  state.chats = [];
  state.activeChatId = null;
  state.activeChat = null;
  state.messages = [];
  state.pendingMessages = [];
  state.loadingMessages = false;
  $('chat-list').replaceChildren();
  $('profile-label').textContent = '';
  $('conversation').classList.remove('is-open');
  $('conversation').innerHTML = `
    <div id="conversation-content" class="welcome">
      <div class="welcome-icon" aria-hidden="true">✦</div>
      <h2>Your conversations, together</h2>
      <p>Start a chat by username, send a message, and keep the conversation in sync.</p>
    </div>`;
}

function initials(name) {
  return String(name ?? '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('') || '?';
}

function colorHue(id) {
  let hash = 0;
  for (const character of String(id ?? '')) hash = (hash * 31 + character.charCodeAt(0)) % 360;
  return hash;
}

function avatar(name, id, avatarPath = null) {
  const image = avatarPath
    ? `<img src="${esc(publicAvatarUrl(avatarPath))}" alt="" loading="lazy" />`
    : esc(initials(name));
  return `<span class="avatar" style="--hue:${colorHue(id)}">${image}</span>`;
}

function chatAvatar(name, id, avatarPath = null) {
  const image = avatarPath
    ? `<img src="${esc(publicChatAvatarUrl(avatarPath))}" alt="" loading="lazy" />`
    : esc(initials(name));
  return `<span class="avatar" style="--hue:${colorHue(id)}">${image}</span>`;
}

function chatTimestamp(chat) {
  const timestamp = chat.last_message?.created_at ?? chat.created_at;
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function renderChats() {
  const rawSearch = $('chat-search').value.trim();
  const search = rawSearch.toLocaleLowerCase();
  const chats = state.chats.filter((chat) => {
    const type = chat.chat_type ?? (chat.is_group ? 'group' : 'direct');
    if (state.currentView === 'groups' && type !== 'group') return false;
    if (state.currentView === 'chats' && type !== 'direct') return false;
    if (!['chats', 'groups'].includes(state.currentView)) return false;
    const preview = chat.last_message?.body ?? '';
    return `${chat.chat_name} ${preview}`.toLocaleLowerCase().includes(search);
  });

  const chatMarkup = chats
    .map((chat) => {
      const type = chat.chat_type ?? (chat.is_group ? 'group' : 'direct');
      const preview = chat.last_message?.body ?? 'Start a conversation';
      const unread = Number(chat.unread_count) || 0;
      return `
        <div class="live-chat-row">
          <button class="row" type="button" data-chat-id="${esc(chat.chat_id)}"
            aria-pressed="${state.activeChatId === chat.chat_id}">
            ${chat.chat_type === 'group'
              ? chatAvatar(chat.chat_name, chat.chat_id, chat.chat_avatar_path)
              : avatar(chat.chat_name, chat.chat_id, chat.chat_avatar_path)}
            <span class="row-main">
              <span class="row-top">
                <span class="row-title">${esc(chat.chat_name)}</span>
                <span class="row-time">${esc(chatTimestamp(chat))}</span>
              </span>
              <span class="row-sub">${esc(preview)}</span>
            </span>
            ${unread ? `<span class="unread-badge" aria-label="${unread} unread messages">${unread > 99 ? '99+' : unread}</span>` : ''}
          </button>
          ${type !== 'channel' ? `<button class="chat-pin ${chat.pinned ? 'is-pinned' : ''}" type="button"
            data-pin-id="${esc(chat.chat_id)}" aria-label="${chat.pinned ? 'Unpin' : 'Pin'} ${esc(chat.chat_name)}"
            aria-pressed="${Boolean(chat.pinned)}" title="${chat.pinned ? 'Unpin chat' : 'Pin chat'}">
            ${chat.pinned ? '★' : '☆'}
          </button>` : ''}
        </div>`;
    })
    .join('');
  let peopleMarkup = '';
  if (state.currentView === 'chats' && rawSearch.length >= 2) {
    peopleMarkup = `
      <div class="section-head">People</div>
      ${state.sidebarPeoplePending
        ? '<div class="chat-list-empty">Searching people…</div>'
        : state.sidebarPeople.length
          ? state.sidebarPeople.map(renderPersonResult).join('')
          : !chats.length
            ? '<div class="chat-list-empty">No people or chats found.</div>'
            : ''}`;
  }
  const typeName = state.currentView === 'groups' ? 'groups' : 'chats';
  const emptyChats = !chats.length && !rawSearch
    ? `<div class="chat-list-empty">No ${typeName} yet. ${state.currentView === 'groups' ? 'Create a group to get started.' : 'Start a one-to-one chat by username.'}</div>`
    : !chats.length && rawSearch.length < 2
      ? '<div class="chat-list-empty">No chats match. Type at least 2 characters to search people.</div>'
      : '';
  if (state.currentView === 'channels') {
    renderChannelList();
    return;
  }
  if (state.currentView === 'status') {
    renderStatusList();
    return;
  }
  $('chat-list').innerHTML = `${chatMarkup}${peopleMarkup}${emptyChats}`;
}

function updateNavigation(view) {
  state.currentView = view;
  $('app-workspace').dataset.view = view;
  document.querySelectorAll('.nav-item').forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle('is-active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  const titles = { chats: 'Chats', groups: 'Groups', channels: 'Channels', status: 'Status', settings: 'Settings' };
  $('sidebar-title').textContent = titles[view];
  $('new-chat').hidden = view !== 'chats';
  $('new-group').hidden = view !== 'groups';
  $('new-channel').hidden = view !== 'channels';
  $('new-status').hidden = view !== 'status';
  $('chat-search').closest('.searchbar').hidden = !['chats', 'groups', 'channels'].includes(view);
  $('chat-search').placeholder = view === 'channels' ? 'Find public channels' : 'Search conversations';
  $('conversation').classList.remove('is-open');
  if (view === 'settings') {
    renderSettingsPage();
    return;
  }
  if (view === 'status') {
    $('conversation').innerHTML = '<div id="status-feed" class="status-feed"><p class="loading">Loading statuses…</p></div>';
    void loadStatuses();
    renderChats();
    return;
  }
  if (view === 'channels') void loadChannels();
  renderChats();
  const expectedType = { chats: 'direct', groups: 'group', channels: 'channel' }[view];
  if (state.activeChat?.chat_type === expectedType) {
    renderConversation();
    $('conversation').classList.remove('is-open');
  } else {
    $('conversation').innerHTML = `<div class="welcome"><div class="welcome-icon" aria-hidden="true">✦</div><h2>${titles[view]}</h2><p>Select a ${view === 'chats' ? 'one-to-one conversation' : view === 'groups' ? 'group conversation' : 'channel'} or create a new one.</p></div>`;
  }
}

function renderChannelList() {
  const mine = state.channels.map((channel) => `
    <button class="people-result channel-row" type="button" data-channel-open="${esc(channel.chat_id)}">
      ${chatAvatar(channel.chat_name, channel.chat_id, channel.chat_avatar_path)}
      <span class="people-result-copy"><strong>${esc(channel.chat_name)}</strong><small>${esc(channel.description || 'Public channel')} · ${channel.subscriber_count} subscribers</small></span>
      <span class="people-result-action">${['owner', 'admin'].includes(channel.role) ? 'Admin' : 'Open'}</span>
    </button>`).join('');
  const discovered = state.discoveredChannels
    .filter((channel) => !state.channels.some((owned) => owned.chat_id === channel.chat_id))
    .map((channel) => `
      <button class="people-result channel-row" type="button"
        data-channel-open="${esc(channel.chat_id)}" data-channel-subscribed="${channel.is_subscribed}">
        ${chatAvatar(channel.chat_name, channel.chat_id, channel.chat_avatar_path)}
        <span class="people-result-copy"><strong>${esc(channel.chat_name)}</strong><small>${esc(channel.description || 'Public channel')} · ${channel.subscriber_count} subscribers</small></span>
        <span class="people-result-action">${channel.is_subscribed ? 'Open' : 'Join'}</span>
      </button>`).join('');
  $('chat-list').innerHTML = `
    <div class="section-head">Your channels</div>
    ${mine || '<p class="people-search-empty">You have not joined any channels yet.</p>'}
    <div class="section-head">Discover channels</div>
    ${discovered || '<p class="people-search-empty">No public channels found.</p>'}`;
}

function renderStatusList() {
  if (!state.statuses.length) {
    $('chat-list').innerHTML = '<div class="chat-list-empty">No status updates yet. Post one for your direct-chat contacts.</div>';
    return;
  }
  const authors = new Map();
  for (const status of state.statuses) {
    const list = authors.get(status.author_id) ?? [];
    list.push(status);
    authors.set(status.author_id, list);
  }
  $('chat-list').innerHTML = [...authors.entries()].map(([authorId, statuses]) => {
    const latest = statuses[0];
    return `<button class="people-result status-author" type="button" data-status-author="${esc(authorId)}">
      ${avatar(latest.author_name, authorId, latest.avatar_path)}
      <span class="people-result-copy"><strong>${esc(latest.author_name)}${authorId === state.session.user.id ? ' (you)' : ''}</strong><small>${statuses.length} update${statuses.length === 1 ? '' : 's'} · ${esc(formatMessageTime(latest.created_at))}</small></span>
      <span class="people-result-action">View</span>
    </button>`;
  }).join('');
  if (!state.statuses.some((status) => status.author_id === state.session.user.id)) {
    $('chat-list').insertAdjacentHTML('afterbegin', '<p class="selection-hint">Your updates appear here after you post.</p>');
  }
}

async function loadChannels(force = false) {
  try {
    const [mine, discovered] = await Promise.all([listMyChannels(), discoverChannels($('chat-search').value)]);
    if (state.currentView !== 'channels' && !force) return;
    state.channels = mine.map((channel) => ({
      ...channel,
      chat_type: 'channel',
      is_group: true,
      participants: [],
      my_role: channel.role,
    }));
    state.discoveredChannels = discovered;
    if (state.activeChatId) {
      state.activeChat = [...state.channels, ...state.discoveredChannels]
        .find((channel) => channel.chat_id === state.activeChatId) ?? state.activeChat;
    }
    if (state.currentView === 'channels') renderChannelList();
  } catch (error) {
    showToast(`Could not load channels: ${friendlyError(error)}`);
    if (force) throw error;
  }
}

async function loadStatuses() {
  try {
    const rows = await listContactStatuses();
    state.statuses = await Promise.all(rows.map(async (status) => ({
      ...status,
      media_url: status.media_path ? await signedMediaUrl('chat-media', status.media_path) : null,
    })));
    if (state.currentView !== 'status') return;
    renderStatusList();
    renderStatusFeed();
  } catch (error) {
    showToast(`Could not load statuses: ${friendlyError(error)}`);
  }
}

function renderStatusFeed(authorId = null) {
  const feed = $('status-feed');
  if (!feed) return;
  const statuses = state.statuses.filter((status) => !authorId || status.author_id === authorId);
  feed.innerHTML = statuses.length
    ? statuses.map((status) => `
      <article class="status-card">
        <header>${avatar(status.author_name, status.author_id, status.avatar_path)}
          <span><strong>${esc(status.author_name)}</strong><small>@${esc(status.username)} · ${esc(formatMessageTime(status.created_at))}</small></span>
        </header>
        ${status.body ? `<p>${esc(status.body)}</p>` : ''}
        ${status.media_url ? status.media_type?.startsWith('video/')
          ? `<video controls preload="metadata" src="${esc(status.media_url)}"></video>`
          : `<img src="${esc(status.media_url)}" alt="Status from ${esc(status.author_name)}" loading="lazy" />` : ''}
        ${status.author_id === state.session.user.id ? `<button class="danger-button status-delete" type="button" data-delete-status="${esc(status.id)}">Delete my status</button>` : ''}
      </article>`).join('')
    : '<div class="welcome"><h2>No active status updates</h2><p>Updates from your direct-chat contacts appear here for 24 hours.</p></div>';
}

function renderSettingsPage() {
  const statusVisibility = state.profile.status_visibility ?? 'contacts';
  $('conversation').innerHTML = `
    <section class="settings-page">
      <h2>Settings</h2>
      <button class="settings-profile-card" type="button" id="settings-edit-profile">
        ${avatar(state.profile.display_name, state.profile.id, state.profile.avatar_path)}
        <span><strong>${esc(state.profile.display_name)}</strong><small>@${esc(state.profile.username)} · Edit profile photo, name and bio</small></span>
        <span aria-hidden="true">›</span>
      </button>
      <div class="settings-section">
        <h3>Appearance</h3>
        <div class="settings-row"><span><strong>Theme</strong><small>Choose the light or dark Guildkeep palette.</small></span><button id="settings-theme-toggle" class="secondary-button" type="button">${document.body.classList.contains('light-theme') ? 'Use dark theme' : 'Use light theme'}</button></div>
      </div>
      <div class="settings-section">
        <h3>Account</h3>
        <div class="settings-row"><span><strong>Invite friends</strong><small>Share your Guildkeep username.</small></span><button id="settings-invite" class="secondary-button" type="button">Share</button></div>
        <div class="settings-row"><span><strong>Status privacy</strong><small>Choose who can view your status updates. Updates expire after 24 hours.</small></span>
          <select id="settings-status-visibility" aria-label="Status visibility">
            <option value="contacts" ${statusVisibility === 'contacts' ? 'selected' : ''}>My contacts</option>
            <option value="only_me" ${statusVisibility === 'only_me' ? 'selected' : ''}>Only me</option>
          </select>
        </div>
        <div class="settings-row"><span><strong>Media</strong><small>Chat and status media are limited to 25 MB per file.</small></span><span class="privacy-value">25 MB</span></div>
      </div>
    </section>`;
  $('settings-theme-toggle').addEventListener('click', () => setTheme(!document.body.classList.contains('light-theme')));
  $('settings-invite').addEventListener('click', () => {
    void shareLink('Join me on Guildkeep', `Chat with me as @${state.profile.username}.`, currentInviteUrl('username', state.profile.username));
  });
  $('settings-edit-profile').addEventListener('click', openProfileEditor);
  $('settings-status-visibility').addEventListener('change', async (event) => {
    const select = event.currentTarget;
    const previousVisibility = state.profile.status_visibility ?? 'contacts';
    select.disabled = true;
    try {
      state.profile.status_visibility = await updateStatusVisibility(select.value);
      showToast(select.value === 'contacts' ? 'Status is visible to your direct-chat contacts.' : 'Status is visible only to you.');
    } catch (error) {
      select.value = previousVisibility;
      showToast(`Could not update status privacy: ${friendlyError(error)}`);
    } finally {
      select.disabled = false;
    }
  });
}

function renderPersonResult(person) {
  return `
    <button class="people-result" type="button" data-person-id="${esc(person.id)}" data-person-username="${esc(person.username)}">
      ${avatar(person.display_name, person.id, person.avatar_path)}
      <span class="people-result-copy">
        <strong>${esc(person.display_name)}</strong>
        <small>@${esc(person.username)}</small>
      </span>
      <span class="people-result-action">Message</span>
    </button>`;
}

function formatMessageTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function renderMessages() {
  const list = $('message-list');
  if (!list) return;
  if (state.loadingMessages) {
    list.innerHTML = '<div class="loading">Loading messages…</div>';
    return;
  }
  if (!state.messages.length) {
    list.innerHTML = '<div class="loading">No messages yet. Say hello.</div>';
    return;
  }

  list.innerHTML = state.messages
    .map((message) => {
      const own = message.sender_id === state.session.user.id;
      const senderName = message.sender?.display_name ??
        (own ? state.profile.display_name : state.activeChat?.chat_name ?? 'Member');
      const reactions = state.reactions.get(message.id) ?? [];
      const media = renderMessageMedia(message);
      const reactionMarkup = ['👍', '❤️', '😂', '😮', '😢', '🙏']
        .map((emoji) => {
          const matching = reactions.filter((item) => item.reaction === emoji);
          if (!matching.length) return '';
          const mine = matching.some((item) => item.user_id === state.session.user.id);
          return `<span class="reaction-chip ${mine ? 'is-selected' : ''}"
            aria-label="${matching.length} ${emoji} reactions">${emoji}<small>${matching.length}</small></span>`;
        }).join('');
      if (message.deleted_at) {
        return `<div class="message ${own ? 'outgoing' : ''} is-deleted" data-message-id="${esc(message.id)}"><em>Message deleted</em></div>`;
      }
      return `
        <div class="message ${own ? 'outgoing' : ''}" data-message-id="${esc(message.id)}">
          ${!own && ['group', 'channel'].includes(state.activeChat?.chat_type) ? `<span class="message-sender">${esc(senderName)}</span>` : ''}
          ${message.forwarded_from ? '<span class="forwarded-label">Forwarded</span>' : ''}
          ${message.body ? `<span class="message-text">${esc(message.body)}</span>` : ''}
          ${media}
          <span class="message-meta">${message.edited_at ? 'edited · ' : ''}${esc(formatMessageTime(message.created_at))}</span>
          ${reactionMarkup ? `<div class="message-reactions" aria-label="Reactions">${reactionMarkup}</div>` : ''}
        </div>`;
    })
    .join('');
  list.scrollTop = list.scrollHeight;
}

function renderMessageMedia(message) {
  if (!message.media_url) return '';
  const src = esc(message.media_url);
  if (message.voice_note || message.media_type?.startsWith('audio/')) {
    return `<audio class="message-media-audio" controls preload="metadata" src="${src}"></audio>`;
  }
  if (message.media_type?.startsWith('image/')) {
    return `<a class="message-media-link" href="${src}" target="_blank" rel="noopener noreferrer"><img class="message-media-image" src="${src}" alt="${esc(message.file_name ?? 'Shared image')}" loading="lazy" /></a>`;
  }
  if (message.media_type?.startsWith('video/')) {
    return `<video class="message-media-video" controls preload="metadata" src="${src}"></video>`;
  }
  return `<a class="message-file" href="${src}" target="_blank" rel="noopener noreferrer">↧ ${esc(message.file_name ?? 'Download attachment')}</a>`;
}

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const CHAT_MEDIA_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'video/mp4', 'video/webm',
  'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-wav',
  'application/pdf',
]);
const STATUS_MEDIA_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm',
]);

function mediaExtension(type) {
  return ({
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
    'video/mp4': 'mp4', 'video/webm': 'webm', 'audio/webm': 'webm',
    'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3',
    'audio/wav': 'wav', 'audio/x-wav': 'wav', 'application/pdf': 'pdf',
  })[type] ?? null;
}

function validateUpload(file, types = CHAT_MEDIA_TYPES) {
  if (!file) throw new Error('Choose a file to upload.');
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('Files must be 25 MB or smaller.');
  if (!types.has(file.type)) throw new Error('This file type is not supported.');
}

async function hydrateMessages(messages) {
  return Promise.all(messages.map(async (message) => ({
    ...message,
    media_url: message.media_path
      ? await signedMediaUrl('chat-media', message.media_path)
      : null,
  })));
}

function openProfileEditor() {
  $('profile-form').elements.username.value = state.profile.username;
  $('profile-form').elements.display_name.value = state.profile.display_name;
  $('profile-form').elements.bio.value = state.profile.bio ?? '';
  $('profile-picture-input').value = '';
  state.pendingProfileAvatar = null;
  $('profile-picture-preview').src = state.profile.avatar_path
    ? publicAvatarUrl(state.profile.avatar_path)
    : '';
  $('profile-picture-preview').classList.toggle('has-image', Boolean(state.profile.avatar_path));
  setStatus($('profile-status'), '');
  $('profile-dialog').hidden = false;
}

async function sendChatMedia(file, voiceNote = false, caption = '', chat = state.activeChat) {
  if (!chat) return;
  validateUpload(file);
  const media = {
    type: file.type,
    name: voiceNote ? 'Voice note' : file.name,
    voiceNote,
  };
  const path = `${chat.chat_id}/${state.session.user.id}/${crypto.randomUUID()}.${mediaExtension(file.type)}`;
  try {
    media.path = await uploadMedia('chat-media', path, file, file.type);
    await sendMessage(chat.chat_id, state.session.user.id, caption, media);
    if (state.activeChatId === chat.chat_id) {
      state.messages = await hydrateMessages(await listMessages(chat.chat_id));
      renderMessages();
    }
    await refreshChats();
    await markChatRead(chat.chat_id, state.session.user.id);
  } catch (error) {
    if (media.path) {
      try {
        await removeMedia('chat-media', media.path);
      } catch (cleanupError) {
        console.error('Could not clean up an incomplete media upload.', cleanupError);
      }
    }
    throw error;
  }
}

function renderConversation() {
  const chat = state.activeChat;
  if (!chat) return;
  $('conversation').classList.add('is-open');
  const type = chat.chat_type ?? (chat.is_group ? 'group' : 'direct');
  $('conversation').innerHTML = `
    <div class="conversation-view">
      <header class="conversation-head">
        <button class="conversation-back" id="conversation-back" type="button" aria-label="Back to chats">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        ${chat.chat_type === 'group'
          ? chatAvatar(chat.chat_name, chat.chat_id, chat.chat_avatar_path)
          : avatar(chat.chat_name, chat.chat_id, chat.chat_avatar_path)}
        <div class="conversation-title">
          <strong>${esc(chat.chat_name)}</strong>
          <span id="chat-connection">${type === 'group' ? `${chat.participants.length + 1} members` : type === 'channel' ? `${chat.participants?.length ?? 0} subscribers` : 'Private chat'} · connecting…</span>
        </div>
        ${type !== 'direct' ? '<button id="group-info" class="icon-button group-info-button" type="button" aria-label="Conversation details" title="Conversation details">⋯</button>' : ''}
      </header>
      <div class="conversation-body" id="message-list" aria-live="polite"></div>
      <form id="message-form" class="conversation-footer">
        ${type !== 'channel' || ['owner', 'admin'].includes(chat.my_role) ? `
          <button class="composer-tool" type="button" id="attach-media" aria-label="Attach media" title="Attach media">＋</button>
          <button class="composer-tool" type="button" id="voice-note" aria-label="Record voice note" title="Record voice note">🎙</button>
          <textarea name="body" aria-label="Message" placeholder="${type === 'group' ? 'Message or type /help for group commands…' : type === 'channel' ? 'Write a channel post…' : 'Write a message…'}" maxlength="4000" rows="1"></textarea>
          <button type="submit">Send</button>
          <span id="recording-status" class="recording-status" hidden></span>
        ` : '<div class="channel-readonly-note">Only channel admins can publish. Subscribe to receive channel updates.</div>'}
      </form>
    </div>`;
  renderMessages();
}

function renderPeopleSearchResults(people, query) {
  const results = $('people-search-results');
  if (!people.length) {
    results.innerHTML = `<p class="people-search-empty">No accounts found for “${esc(query)}”.</p>`;
    return;
  }
  results.innerHTML = people.map(renderPersonResult).join('');
}

async function searchSidebarPeople(rawQuery) {
  const query = rawQuery.trim().replace(/^@/, '');
  const sequence = ++state.sidebarPeopleSearchSequence;
  if (query.length < 2) {
    state.sidebarPeople = [];
    state.sidebarPeoplePending = false;
    renderChats();
    return;
  }

  state.sidebarPeoplePending = true;
  renderChats();
  try {
    const people = await searchProfiles(query);
    if (sequence !== state.sidebarPeopleSearchSequence) return;
    state.sidebarPeople = people;
  } catch (error) {
    if (sequence !== state.sidebarPeopleSearchSequence) return;
    state.sidebarPeople = [];
    showToast(`Could not search people: ${friendlyError(error)}`);
  } finally {
    if (sequence === state.sidebarPeopleSearchSequence) {
      state.sidebarPeoplePending = false;
      renderChats();
    }
  }
}

async function searchPeople(rawQuery) {
  const query = rawQuery.trim().replace(/^@/, '');
  const sequence = ++state.peopleSearchSequence;
  const results = $('people-search-results');
  if (query.length < 2) {
    state.peopleSearchResults = [];
    results.innerHTML = '<p class="people-search-empty">Type at least 2 characters to find someone.</p>';
    return;
  }

  results.innerHTML = '<p class="people-search-empty">Searching accounts…</p>';
  try {
    const people = await searchProfiles(query);
    if (sequence !== state.peopleSearchSequence || $('new-chat-dialog').hidden) return;
    state.peopleSearchResults = people;
    renderPeopleSearchResults(people, query);
  } catch (error) {
    if (sequence !== state.peopleSearchSequence) return;
    state.peopleSearchResults = [];
    results.innerHTML = `<p class="people-search-empty is-error">${esc(friendlyError(error))}</p>`;
  }
}

async function openPersonChat(person, sourceButton, fromDialog = false) {
  if (sourceButton) sourceButton.disabled = true;
  if (fromDialog) setStatus($('new-chat-status'), `Opening chat with ${person.display_name}…`);
  else showToast(`Opening chat with ${person.display_name}…`);
  try {
    const chatId = await createDirectChat(person.username);
    await refreshChats();
    const chatExists = state.chats.some((chat) => chat.chat_id === chatId);
    if (!chatExists) {
      throw new Error('Chat was created, but did not appear in your chat list. Refresh and try again.');
    }
    if (fromDialog) {
      $('new-chat-dialog').hidden = true;
      $('new-chat-form').reset();
    }
    $('chat-search').value = '';
    state.sidebarPeople = [];
    state.sidebarPeoplePending = false;
    clearTimeout(renderChats.searchTimeout);
    renderChats();
    await openChat(chatId);
    $('message-form [name="body"]')?.focus();
  } catch (error) {
    if (sourceButton) sourceButton.disabled = false;
    if (fromDialog) setStatus($('new-chat-status'), friendlyError(error), true);
    else showToast(friendlyError(error));
  }
}

async function refreshChats() {
  const userId = state.session?.user?.id;
  if (!userId) return;
  const rows = await listChats();
  if (state.session?.user?.id !== userId) return;
  state.chats = rows.map((row) => ({
    ...row,
    chat_type: row.chat_type ?? (row.is_group ? 'group' : 'direct'),
    participants: Array.isArray(row.participants) ? row.participants : [],
  }));
  renderChats();
  if (state.activeChatId) {
    const updatedChat = state.chats.find((chat) => chat.chat_id === state.activeChatId);
    if (updatedChat) state.activeChat = updatedChat;
  }
}

async function openChat(chatId) {
  const chat = [...state.chats, ...state.channels, ...state.discoveredChannels]
    .find((item) => item.chat_id === chatId);
  if (!chat) return;
  state.unsubscribeMessages?.();
  state.unsubscribeChat?.();
  state.activeChatId = chatId;
  state.activeChat = chat;
  state.messages = [];
  state.pendingMessages = [];
  state.reactions = new Map();
  state.loadingMessages = true;
  renderChats();
  renderConversation();

  try {
    state.unsubscribeMessages = subscribeToMessages(chatId, handleIncomingMessage, (status) => {
      const label = $('chat-connection');
      if (!label || state.activeChatId !== chatId) return;
      label.textContent = status === 'SUBSCRIBED'
        ? `${chat.chat_type === 'group' ? `${chat.participants.length + 1} members` : chat.chat_type === 'channel' ? 'Channel' : 'Private chat'} · live`
        : status === 'CHANNEL_ERROR' || status === 'TIMED_OUT'
          ? `${chat.chat_type === 'channel' ? 'Channel' : chat.chat_type === 'group' ? 'Group' : 'Private chat'} · reconnecting…`
          : `${chat.chat_type === 'channel' ? 'Channel' : chat.chat_type === 'group' ? 'Group' : 'Private chat'} · connecting…`;
    });
    state.unsubscribeChat = subscribeToChatChanges(chatId, () => {
      void refreshChats().then(() => {
        if (state.activeChatId !== chatId) return;
        renderConversation();
        if (!$('group-details-dialog').hidden) void openGroupDetails();
      }).catch((error) => showToast(friendlyError(error)));
    });
    state.unsubscribeReactions?.();
    state.unsubscribeReactions = subscribeToReactions(() => {
      if (state.activeChatId === chatId) void refreshReactions(chatId);
    });
    const messages = await hydrateMessages(await listMessages(chatId));
    if (state.activeChatId !== chatId) return;
    state.messages = messages;
    const byId = new Map(state.messages.map((message) => [message.id, message]));
    for (const message of state.pendingMessages) byId.set(message.id, message);
    state.messages = [...byId.values()].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    state.pendingMessages = [];
    state.loadingMessages = false;
    await refreshReactions(chatId);
    renderMessages();
    await markChatRead(chatId, state.session.user.id);
    await refreshChats();
  } catch (error) {
    state.loadingMessages = false;
    renderMessages();
    showToast(friendlyError(error));
  }
}

async function refreshReactions(chatId) {
  if (state.activeChatId !== chatId) return;
  const rows = await listChatReactions(chatId);
  const visibleMessageIds = new Set(state.messages.map((message) => message.id));
  if (state.activeChatId !== chatId) return;
  state.reactions = new Map();
  for (const row of rows) {
    if (!visibleMessageIds.has(row.message_id)) continue;
    const current = state.reactions.get(row.message_id) ?? [];
    current.push(row);
    state.reactions.set(row.message_id, current);
  }
  renderMessages();
}

async function handleIncomingMessage(message) {
  if (state.activeChatId !== message.chat_id) {
    await refreshChats();
    return;
  }
  if (message.eventType !== 'INSERT') {
    try {
      state.messages = await hydrateMessages(await listMessages(message.chat_id));
      await refreshReactions(message.chat_id);
      renderMessages();
    } catch (error) {
      showToast(`Could not refresh the updated message: ${friendlyError(error)}`);
    }
    return;
  }
  if (state.loadingMessages) {
    state.pendingMessages.push(message);
    return;
  }
  if (state.messages.some((item) => item.id === message.id)) return;
  try {
    const sender = await getProfile(message.sender_id);
    if (state.activeChatId !== message.chat_id) return;
    if (state.messages.some((item) => item.id === message.id)) return;
    state.messages.push({ ...message, sender });
    renderMessages();
    await markChatRead(message.chat_id, state.session.user.id);
    await refreshChats();
  } catch (error) {
    showToast(`New message arrived, but could not refresh it: ${friendlyError(error)}`);
  }
}

async function initialiseWorkspace(session) {
  if (!session) {
    state.unsubscribeMessages?.();
    state.unsubscribeChat?.();
    state.unsubscribeMemberships?.();
    state.unsubscribeReactions?.();
    clearWorkspace();
    $('auth-panel').hidden = false;
    $('app-shell').hidden = true;
    return;
  }
  const userId = session.user.id;
  if (
    state.session?.user?.id === userId &&
    (state.profile || state.initializingUserId === userId)
  ) return;

  state.session = session;
  state.initializingUserId = userId;
  $('auth-panel').hidden = true;
  $('app-shell').hidden = false;
  try {
    const profile = await getProfile(userId);
    if (state.session?.user?.id !== userId) return;
    state.profile = profile;
    $('profile-label').textContent = `@${state.profile.username}`;
    await refreshChats();
    if (state.session?.user?.id !== userId) return;
    state.unsubscribeMemberships = subscribeToMemberships(session.user.id, () => {
      void Promise.all([refreshChats(), listMyChannels()]).then(([, channels]) => {
        state.channels = channels.map((channel) => ({
          ...channel,
          chat_type: 'channel',
          is_group: true,
          participants: [],
          my_role: channel.role,
        }));
        if (state.currentView === 'channels') renderChannelList();
        const stillMember = state.chats.some((chat) => chat.chat_id === state.activeChatId)
          || state.channels.some((channel) => channel.chat_id === state.activeChatId);
        if (state.activeChatId && !stillMember) {
          state.activeChatId = null;
          state.activeChat = null;
          $('conversation').classList.remove('is-open');
          $('conversation').innerHTML = '<div class="welcome"><h2>You are no longer in this conversation</h2><p>Your chat list has been updated.</p></div>';
        }
      }).catch((error) => showToast(`Could not refresh chat memberships: ${friendlyError(error)}`));
    });
    if (state.chats.length) await openChat(state.chats[0].chat_id);
    await handlePendingInvite();
  } catch (error) {
    showToast(friendlyError(error));
  } finally {
    if (state.initializingUserId === userId) state.initializingUserId = null;
  }
}

function setTheme(light) {
  document.body.classList.toggle('light-theme', light);
  localStorage.setItem('ember-theme', light ? 'light' : 'dark');
  const themeButton = $('settings-theme-toggle');
  if (themeButton) themeButton.textContent = light ? 'Use dark theme' : 'Use light theme';
}

function currentInviteUrl(kind, value) {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set(kind, value);
  return url.toString();
}

async function shareLink(title, text, url) {
  try {
    if (navigator.share) {
      await navigator.share({ title, text, url });
      return;
    }
    await navigator.clipboard.writeText(url);
    showToast('Invite link copied. Share it with your friends.');
  } catch (error) {
    if (error?.name === 'AbortError') return;
    showToast(`Could not share the invite link: ${friendlyError(error)}`);
  }
}

async function handlePendingInvite() {
  if (state.pendingInviteHandled || !state.session) return;
  const params = new URLSearchParams(location.search);
  const inviteCode = params.get('invite');
  const channelCode = params.get('channel');
  const username = params.get('username');
  if (!inviteCode && !channelCode && !username) return;
  state.pendingInviteHandled = true;
  try {
    let chatId;
    if (inviteCode) {
      chatId = await joinGroupByInvite(inviteCode);
      await refreshChats();
    } else if (channelCode) {
      chatId = await joinChannelByInvite(channelCode);
      await loadChannels(true);
    } else {
      const [person] = await searchProfiles(username);
      if (!person || person.username.toLowerCase() !== username.toLowerCase()) {
        throw new Error('That invite does not match a Guildkeep account.');
      }
      chatId = await createDirectChat(person.username);
      await refreshChats();
    }
    history.replaceState(null, '', `${location.pathname}${location.hash}`);
    await openChat(chatId);
    showToast(inviteCode ? 'You joined the group.'
      : channelCode ? 'You joined the channel.'
        : `Chat opened with @${username}.`);
  } catch (error) {
    history.replaceState(null, '', `${location.pathname}${location.hash}`);
    showToast(friendlyError(error));
  }
}

function renderGroupMemberPicker() {
  const selected = [...state.selectedGroupMembers.values()];
  $('group-selected-members').innerHTML = selected.length
    ? `<div class="selected-member-list">${selected.map((person) => `
        <button type="button" class="selected-member" data-remove-group-person="${esc(person.id)}">
          @${esc(person.username)} <span aria-hidden="true">×</span>
        </button>`).join('')}</div>`
    : '<p class="selection-hint">No members selected yet. You can add people later with /add @username.</p>';
}

function renderGroupMemberResults() {
  const results = $('group-member-results');
  results.innerHTML = state.groupMemberResults.length
    ? state.groupMemberResults.map((person) => {
      const selected = state.selectedGroupMembers.has(person.id);
      return `<button class="people-result ${selected ? 'is-selected' : ''}" type="button"
        data-group-person="${esc(person.id)}">
        ${avatar(person.display_name, person.id)}
        <span class="people-result-copy"><strong>${esc(person.display_name)}</strong><small>@${esc(person.username)}</small></span>
        <span class="people-result-action">${selected ? 'Selected' : 'Add'}</span>
      </button>`;
    }).join('')
    : '<p class="people-search-empty">Search for at least 2 characters to add group members.</p>';
}

async function openGroupDetails() {
  const chat = state.activeChat;
  if (!chat?.is_group) return;
  const isChannel = chat.chat_type === 'channel';
  const isAdmin = ['admin', 'owner'].includes(chat.my_role);
  const isOwner = chat.my_role === 'owner';
  const inviteUrl = chat.invite_code
    ? currentInviteUrl(isChannel ? 'channel' : 'invite', chat.invite_code)
    : '';
  const description = isChannel
    ? (chat.channel_description ?? chat.description ?? '')
    : (chat.group_description ?? '');
  const subscribers = chat.subscriber_count ?? chat.participants?.length ?? 0;
  const members = [
    { id: state.session.user.id, username: state.profile.username, display_name: state.profile.display_name, role: chat.my_role },
    ...(chat.participants ?? []),
  ];
  let statuses = [];
  if (!isChannel) {
    try {
      statuses = await listGroupStatuses(chat.chat_id);
    } catch (error) {
      showToast(`Could not load group status: ${friendlyError(error)}`);
    }
  }
  if (state.activeChatId !== chat.chat_id) return;
  $('group-details-title').textContent = chat.chat_name;
  $('group-details-content').innerHTML = `
    <div class="chat-details-identity">
      ${chatAvatar(chat.chat_name, chat.chat_id, chat.chat_avatar_path)}
      <div><strong>${esc(chat.chat_name)}</strong><small>${isChannel ? `${subscribers} subscribers` : `${members.length} members`}</small></div>
    </div>
    <p class="group-summary">${isChannel
      ? `${chat.channel_public ? 'Public' : 'Private'} channel · ${esc(chat.my_role ?? 'subscriber')}`
      : `${esc(chat.my_role ?? 'member')}${chat.group_locked ? ' · Posting locked' : ''}${chat.announcement_mode ? ' · Admin announcements' : ''}`}</p>
    ${inviteUrl ? `<div class="group-invite">
      <strong>${isChannel ? 'Channel invite' : 'Invite link'}</strong><code>${esc(inviteUrl)}</code>
      <button class="secondary-button" id="share-group-invite" type="button">Share link</button>
    </div>` : ''}
    ${!isChannel ? `<div class="group-members"><h3>Members</h3>${members.map((member) => `
      <div class="group-member">
        ${avatar(member.display_name, member.id)}
        <span><strong>${esc(member.display_name)}</strong><small>@${esc(member.username)}</small></span>
        <small class="member-role">${esc(member.role ?? 'member')}</small>
      </div>`).join('')}</div>` : ''}
    ${isAdmin ? `<form id="chat-settings-form" class="feature-form chat-settings-form">
      <h3>${isChannel ? 'Channel settings' : 'Group settings'}</h3>
      <label>${isChannel ? 'Channel name' : 'Group name'}
        <input name="title" minlength="2" maxlength="80" required value="${esc(chat.chat_name)}" />
      </label>
      <label>${isChannel ? 'About' : 'Description'}
        <textarea name="description" rows="3" maxlength="1000">${esc(description)}</textarea>
      </label>
      <label>Profile picture
        <input name="avatar" type="file" accept="image/jpeg,image/png,image/webp,image/gif" />
      </label>
      ${chat.chat_avatar_path ? '<label class="settings-checkbox"><input name="clear_avatar" type="checkbox" /> Remove current picture</label>' : ''}
      ${isChannel ? `
        <label class="settings-checkbox"><input name="channel_public" type="checkbox" ${chat.channel_public ? 'checked' : ''} /> Public channel (discoverable)</label>
      ` : `
        <div class="settings-options">
          <label class="settings-checkbox"><input name="group_locked" type="checkbox" ${chat.group_locked ? 'checked' : ''} /> Lock member posting</label>
          <label class="settings-checkbox"><input name="announcement_mode" type="checkbox" ${chat.announcement_mode ? 'checked' : ''} /> Admin-only announcements</label>
          <label class="settings-checkbox"><input name="antilink_enabled" type="checkbox" ${chat.antilink_enabled ? 'checked' : ''} /> Block links</label>
          <label>Slow mode
            <select name="slowmode_seconds">
              <option value="0" ${!chat.slowmode_seconds ? 'selected' : ''}>Off</option>
              <option value="30" ${chat.slowmode_seconds === 30 ? 'selected' : ''}>30 seconds</option>
              <option value="60" ${chat.slowmode_seconds === 60 ? 'selected' : ''}>1 minute</option>
              <option value="300" ${chat.slowmode_seconds === 300 ? 'selected' : ''}>5 minutes</option>
              <option value="3600" ${chat.slowmode_seconds === 3600 ? 'selected' : ''}>1 hour</option>
            </select>
          </label>
          <label>Group rules
            <textarea name="group_rules" rows="3" maxlength="2000">${esc(chat.group_rules ?? '')}</textarea>
          </label>
        </div>`}
      <button class="primary-button" type="submit">Save ${isChannel ? 'channel' : 'group'} settings</button>
      <p class="command-hint">${isChannel
        ? 'Only channel admins can publish. Public channels can be discovered; private channels require an invite.'
        : 'Group admins can also manage members with /add, /kick, /ban, /promote and /demote commands.'}</p>
    </form>` : ''}
    ${!isChannel ? `<div class="group-statuses"><strong>Recent group status</strong>
      ${statuses.length ? statuses.map((status) => `<p><span>${esc(status.body)}</span><small>${esc(status.author_name)} · ${esc(formatMessageTime(status.created_at))}</small></p>`).join('') : '<p class="selection-hint">No active group status.</p>'}
    </div>
    ${isAdmin ? `<form id="group-command-form" class="feature-form group-command-form">
      <label>Admin command
        <input name="command" maxlength="1000" placeholder="/help, /lock, /status ..." required />
      </label>
      <button class="secondary-button" type="submit">Run command</button>
      <p class="command-hint">Use commands for invites, member management, and moderation.</p>
    </form>` : '<p class="command-hint">Members can type /help or /rules in the message box.</p>'}` : ''}
    ${!isOwner ? `<button class="danger-button" id="leave-chat" type="button">Leave ${isChannel ? 'channel' : 'group'}</button>` : '<p class="command-hint">Owners must transfer ownership before leaving.</p>'}
    ${!chat.is_subscribed && !isAdmin && isChannel ? '<button class="primary-button" id="subscribe-channel-details" type="button">Subscribe to channel</button>' : ''}`;
  $('group-details-dialog').hidden = false;
}

async function executeGroupCommand(command, showDetails = false) {
  const chat = state.activeChat;
  if (chat?.chat_type !== 'group') return;
  const result = await runGroupCommand(chat.chat_id, command);
  if (!result.ok) {
    showToast(result.message);
    return;
  }
  showToast(result.message);
  await refreshChats();
  const refreshed = state.chats.find((item) => item.chat_id === chat.chat_id);
  if (refreshed) state.activeChat = refreshed;
  renderConversation();
  if (showDetails) await openGroupDetails();
}

function showMessageMenu(messageId, clientX, clientY) {
  const message = state.messages.find((item) => item.id === messageId);
  if (!message || message.deleted_at) return;
  state.selectedMessageId = messageId;
  const own = message.sender_id === state.session.user.id;
  const admin = ['owner', 'admin'].includes(state.activeChat?.my_role);
  const mayEdit = own && Boolean(message.body)
    && Date.now() - new Date(message.created_at).getTime() <= 15 * 60 * 1000;
  const mayDelete = own || (admin && ['group', 'channel'].includes(state.activeChat?.chat_type));
  const menu = $('message-context');
  menu.innerHTML = `
    <div class="context-reactions" aria-label="React to message">
      ${['👍', '❤️', '😂', '😮', '😢', '🙏'].map((emoji) => `<button type="button" data-context-reaction="${emoji}" aria-label="React ${emoji}">${emoji}</button>`).join('')}
    </div>
    ${mayEdit ? '<button type="button" data-message-action="edit">Edit message</button>' : ''}
    <button type="button" data-message-action="forward">Forward message</button>
    ${mayDelete ? '<button type="button" class="danger-action" data-message-action="delete">Delete message</button>' : ''}`;
  menu.hidden = false;
  const width = Math.min(260, window.innerWidth - 24);
  menu.style.left = `${Math.max(12, Math.min(clientX, window.innerWidth - width - 12))}px`;
  menu.style.top = `${Math.max(12, Math.min(clientY, window.innerHeight - menu.offsetHeight - 12))}px`;
}

function openForwardDialog(messageId) {
  state.selectedMessageId = messageId;
  const destinations = [...state.chats, ...state.channels]
    .filter((chat) => ['direct', 'group'].includes(chat.chat_type));
  $('forward-chat-list').innerHTML = destinations.length
    ? destinations.map((chat) => `
      <button class="people-result" type="button" data-forward-chat="${esc(chat.chat_id)}">
        ${chat.chat_type === 'group' || chat.chat_type === 'channel'
          ? chatAvatar(chat.chat_name, chat.chat_id, chat.chat_avatar_path)
          : avatar(chat.chat_name, chat.chat_id, chat.chat_avatar_path)}
        <span class="people-result-copy"><strong>${esc(chat.chat_name)}</strong><small>${chat.chat_type === 'group' ? 'Group' : 'One-to-one chat'}</small></span>
        <span class="people-result-action">Forward</span>
      </button>`).join('')
    : '<p class="people-search-empty">No chats are available to forward to.</p>';
  $('forward-dialog').hidden = false;
}

async function toggleRecording() {
  const button = $('voice-note');
  if (state.voiceRecorder?.state === 'recording') {
    state.voiceRecorder.stop();
    return;
  }
  const recordingChat = state.activeChat;
  if (!recordingChat) return;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    showToast('Voice recording is not supported in this browser.');
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const preferredType = ['audio/webm', 'audio/mp4', 'audio/ogg']
      .find((type) => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(stream, preferredType ? { mimeType: preferredType } : undefined);
    state.voiceRecorder = recorder;
    state.voiceChunks = [];
    state.voiceStartedAt = Date.now();
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size) state.voiceChunks.push(event.data);
    });
    recorder.addEventListener('stop', async () => {
      clearTimeout(state.voiceTimer);
      stream.getTracks().forEach((track) => track.stop());
      const recordingStatus = $('recording-status');
      if (recordingStatus) recordingStatus.hidden = true;
      if (button) button.textContent = '🎙';
      const type = (recorder.mimeType || 'audio/webm').split(';', 1)[0];
      const blob = new Blob(state.voiceChunks, { type });
      state.voiceChunks = [];
      if (!blob.size) return;
      const file = new File([blob], `voice-note.${mediaExtension(type) ?? 'webm'}`, { type });
      try {
        await sendChatMedia(file, true, '', recordingChat);
        showToast('Voice note sent.');
      } catch (error) {
        showToast(`Could not send voice note: ${friendlyError(error)}`);
      }
    }, { once: true });
    recorder.start(500);
    if (button) button.textContent = '■';
    const recordingStatus = $('recording-status');
    if (recordingStatus) {
      recordingStatus.hidden = false;
      recordingStatus.textContent = 'Recording… tap stop (max 5 min)';
    }
    state.voiceTimer = setTimeout(() => {
      if (recorder.state === 'recording') recorder.stop();
      showToast('Voice note reached the 5-minute limit.');
    }, 5 * 60 * 1000);
  } catch (error) {
    showToast(`Could not start voice recording: ${friendlyError(error)}`);
  }
}

async function forwardSelectedMessage(targetChatId) {
  const source = state.messages.find((message) => message.id === state.selectedMessageId);
  if (!source) return;
  let copiedMediaPath = null;
  try {
    if (source.media_path) {
      const blob = await downloadMedia('chat-media', source.media_path);
      const file = new File([blob], source.file_name ?? 'forwarded-file', {
        type: source.media_type ?? blob.type,
      });
      validateUpload(file);
      const destinationPath = `${targetChatId}/${state.session.user.id}/${crypto.randomUUID()}.${mediaExtension(file.type)}`;
      copiedMediaPath = await uploadMedia('chat-media', destinationPath, file, file.type);
    }
    await forwardMessage(source.id, targetChatId, copiedMediaPath);
    $('forward-dialog').hidden = true;
    await refreshChats();
    showToast('Message forwarded.');
  } catch (error) {
    if (copiedMediaPath) {
      try {
        await removeMedia('chat-media', copiedMediaPath);
      } catch (cleanupError) {
        console.error('Could not clean up an incomplete forwarded upload.', cleanupError);
      }
    }
    showToast(`Could not forward the message: ${friendlyError(error)}`);
  }
}

function wire() {
  let messagePressOrigin = null;
  $('auth-toggle').addEventListener('click', () => {
    setAuthMode(state.authMode === 'signin' ? 'signup' : 'signin');
  });

  $('auth-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const button = $('auth-submit');
    button.disabled = true;
    setStatus($('auth-status'), state.authMode === 'signup' ? 'Creating your account…' : 'Signing in…');
    try {
      if (state.authMode === 'signup') {
        const username = String(form.get('username')).trim().toLowerCase();
        const displayName = String(form.get('display_name')).trim();
        const result = await signUp({
          email: String(form.get('email')).trim(),
          password: String(form.get('password')),
          username,
          displayName,
        });
        if (!result.session) {
          setStatus($('auth-status'), 'Check your email to confirm the account, then sign in.');
        } else {
          setStatus($('auth-status'), 'Account created. Loading your chats…');
        }
      } else {
        await signIn({
          email: String(form.get('email')).trim(),
          password: String(form.get('password')),
        });
        setStatus($('auth-status'), 'Signed in. Loading your chats…');
      }
    } catch (error) {
      setStatus($('auth-status'), friendlyError(error), true);
    } finally {
      button.disabled = false;
    }
  });

  $('sign-out').addEventListener('click', async () => {
    try {
      await signOut();
    } catch (error) {
      showToast(friendlyError(error));
    }
  });

  $('main-nav').addEventListener('click', (event) => {
    const button = event.target.closest('[data-view]');
    if (button) updateNavigation(button.dataset.view);
  });

  $('profile-picture-input').addEventListener('change', (event) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    try {
      validateUpload(file, new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']));
      state.pendingProfileAvatar = file;
      const preview = $('profile-picture-preview');
      if (preview.dataset.previewUrl) URL.revokeObjectURL(preview.dataset.previewUrl);
      preview.dataset.previewUrl = URL.createObjectURL(file);
      preview.src = preview.dataset.previewUrl;
      preview.classList.add('has-image');
      setStatus($('profile-status'), '');
    } catch (error) {
      event.currentTarget.value = '';
      setStatus($('profile-status'), friendlyError(error), true);
    }
  });
  $('profile-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    submit.disabled = true;
    let uploadedAvatarPath = null;
    const oldAvatarPath = state.profile.avatar_path;
    try {
      let avatarPath = null;
      if (state.pendingProfileAvatar) {
        const file = state.pendingProfileAvatar;
        const path = `${state.session.user.id}/${crypto.randomUUID()}.${mediaExtension(file.type)}`;
        uploadedAvatarPath = await uploadMedia('profile-avatars', path, file, file.type);
        avatarPath = uploadedAvatarPath;
      }
      state.profile = await updateMyProfile(
        String(form.get('display_name')).trim(),
        String(form.get('bio')).trim(),
        avatarPath,
      );
      $('profile-label').textContent = `@${state.profile.username}`;
      $('profile-dialog').hidden = true;
      state.pendingProfileAvatar = null;
      await refreshChats();
      renderMessages();
      if (state.currentView === 'settings') renderSettingsPage();
      if (oldAvatarPath && uploadedAvatarPath) {
        try {
          await removeMedia('profile-avatars', oldAvatarPath);
        } catch (cleanupError) {
          showToast(`Profile saved, but the previous picture could not be removed: ${friendlyError(cleanupError)}`);
        }
      }
      showToast('Profile updated.');
    } catch (error) {
      if (uploadedAvatarPath) {
        try {
          await removeMedia('profile-avatars', uploadedAvatarPath);
        } catch (cleanupError) {
          console.error('Could not clean up an incomplete profile picture upload.', cleanupError);
        }
      }
      setStatus($('profile-status'), friendlyError(error), true);
    } finally {
      submit.disabled = false;
    }
  });

  document.querySelectorAll('[data-close-dialog]').forEach((button) => {
    button.addEventListener('click', () => { $(button.dataset.closeDialog).hidden = true; });
  });
  document.querySelectorAll('.dialog-backdrop').forEach((dialog) => {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.hidden = true;
    });
  });

  $('chat-search').addEventListener('input', (event) => {
    clearTimeout(renderChats.searchTimeout);
    const value = event.currentTarget.value;
    if (state.currentView === 'channels') {
      renderChats.searchTimeout = setTimeout(() => { void loadChannels(); }, 220);
      return;
    }
    renderChats();
    if (state.currentView !== 'chats') return;
    renderChats.searchTimeout = setTimeout(() => { void searchSidebarPeople(value); }, 220);
  });

  $('chat-list').addEventListener('click', async (event) => {
    const statusAuthor = event.target.closest('[data-status-author]');
    if (statusAuthor) {
      renderStatusFeed(statusAuthor.dataset.statusAuthor);
      return;
    }
    const channelButton = event.target.closest('[data-channel-open]');
    if (channelButton) {
      const channelId = channelButton.dataset.channelOpen;
      try {
        if (channelButton.dataset.channelSubscribed !== 'true'
          && !state.channels.some((channel) => channel.chat_id === channelId)) {
          await subscribeToChannel(channelId);
          await loadChannels(true);
        }
        await openChat(channelId);
      } catch (error) {
        showToast(friendlyError(error));
      }
      return;
    }
    const pin = event.target.closest('[data-pin-id]');
    if (pin) {
      const chat = state.chats.find((item) => item.chat_id === pin.dataset.pinId);
      if (!chat) return;
      pin.disabled = true;
      try {
        await setChatPinned(chat.chat_id, state.session.user.id, !chat.pinned);
        await refreshChats();
      } catch (error) {
        showToast(friendlyError(error));
      } finally {
        pin.disabled = false;
      }
      return;
    }
    const personButton = event.target.closest('[data-person-username]');
    if (personButton) {
      const person = state.sidebarPeople.find((item) => item.id === personButton.dataset.personId);
      if (person) await openPersonChat(person, personButton);
      return;
    }
    const row = event.target.closest('[data-chat-id]');
    if (row) await openChat(row.dataset.chatId);
  });

  $('new-channel').addEventListener('click', () => {
    $('channel-create-form').reset();
    setStatus($('channel-create-status'), '');
    $('channel-create-dialog').hidden = false;
    $('channel-create-form').elements.title.focus();
  });
  $('channel-create-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    submit.disabled = true;
    setStatus($('channel-create-status'), 'Creating your channel…');
    try {
      const chatId = await createChannel(
        String(form.get('title')).trim(),
        String(form.get('description')).trim(),
      );
      $('channel-create-dialog').hidden = true;
      await loadChannels(true);
      await openChat(chatId);
      showToast('Channel created. You are its owner and can publish posts.');
    } catch (error) {
      setStatus($('channel-create-status'), friendlyError(error), true);
    } finally {
      submit.disabled = false;
    }
  });

  $('new-status').addEventListener('click', () => {
    $('status-create-form').reset();
    setStatus($('status-create-status'), '');
    $('status-create-dialog').hidden = false;
    $('status-create-form').elements.body.focus();
  });
  $('status-create-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = String(form.get('body')).trim();
    const file = form.get('media');
    const mediaFile = file instanceof File && file.size ? file : null;
    if (!body && !mediaFile) {
      setStatus($('status-create-status'), 'Add text or choose a photo or video.', true);
      return;
    }
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    submit.disabled = true;
    setStatus($('status-create-status'), 'Posting your status…');
    const statusId = crypto.randomUUID();
    let mediaPath = null;
    try {
      if (mediaFile) {
        validateUpload(mediaFile, STATUS_MEDIA_TYPES);
        const path = `${state.session.user.id}/${statusId}/${crypto.randomUUID()}.${mediaExtension(mediaFile.type)}`;
        mediaPath = await uploadMedia('chat-media', path, mediaFile, mediaFile.type);
      }
      await createStatus(statusId, body, mediaPath, mediaFile?.type ?? null);
      $('status-create-dialog').hidden = true;
      await loadStatuses();
      showToast('Status shared with your direct-chat contacts for 24 hours.');
    } catch (error) {
      if (mediaPath) {
        try {
          await removeMedia('chat-media', mediaPath);
        } catch (cleanupError) {
          console.error('Could not clean up an incomplete status upload.', cleanupError);
        }
      }
      setStatus($('status-create-status'), friendlyError(error), true);
    } finally {
      submit.disabled = false;
    }
  });

  $('new-chat').addEventListener('click', () => {
    state.peopleSearchSequence += 1;
    state.peopleSearchResults = [];
    setStatus($('new-chat-status'), '');
    $('people-search-results').innerHTML = '<p class="people-search-empty">Type at least 2 characters to find someone.</p>';
    $('new-chat-dialog').hidden = false;
    $('new-chat-form').elements.username.focus();
  });
  $('close-new-chat').addEventListener('click', () => { $('new-chat-dialog').hidden = true; });
  $('new-chat-dialog').addEventListener('click', (event) => {
    if (event.target === $('new-chat-dialog')) {
      state.peopleSearchSequence += 1;
      $('new-chat-dialog').hidden = true;
    }
  });
  $('new-chat-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    await searchPeople(event.currentTarget.elements.username.value);
  });
  $('new-chat-form').elements.username.addEventListener('input', (event) => {
    state.peopleSearchSequence += 1;
    state.peopleSearchResults = [];
    clearTimeout(searchPeople.timeout);
    const value = event.currentTarget.value;
    searchPeople.timeout = setTimeout(() => { void searchPeople(value); }, 220);
  });
  $('people-search-results').addEventListener('click', (event) => {
    const button = event.target.closest('[data-person-username]');
    if (!button || button.disabled) return;
    const person = state.peopleSearchResults?.find((item) => item.id === button.dataset.personId);
    if (person) void openPersonChat(person, button, true);
  });

  $('new-group').addEventListener('click', () => {
    state.selectedGroupMembers.clear();
    state.groupMemberResults = [];
    $('group-create-form').reset();
    $('group-member-search').value = '';
    setStatus($('group-create-status'), '');
    renderGroupMemberPicker();
    renderGroupMemberResults();
    $('group-create-dialog').hidden = false;
    $('group-create-form').elements.title.focus();
  });
  $('group-member-search').addEventListener('input', (event) => {
    const query = event.currentTarget.value.trim().replace(/^@/, '');
    const sequence = ++state.groupMemberSearchSequence;
    clearTimeout(event.currentTarget.searchTimeout);
    event.currentTarget.searchTimeout = setTimeout(async () => {
      if (query.length < 2) {
        state.groupMemberResults = [];
        renderGroupMemberResults();
        return;
      }
      try {
        const people = await searchProfiles(query);
        if (sequence !== state.groupMemberSearchSequence) return;
        state.groupMemberResults = people;
        renderGroupMemberResults();
      } catch (error) {
        if (sequence !== state.groupMemberSearchSequence) return;
        $('group-member-results').innerHTML = `<p class="people-search-empty is-error">${esc(friendlyError(error))}</p>`;
      }
    }, 220);
  });
  $('group-member-results').addEventListener('click', (event) => {
    const button = event.target.closest('[data-group-person]');
    if (!button) return;
    const person = state.groupMemberResults.find((item) => item.id === button.dataset.groupPerson);
    if (!person) return;
    if (state.selectedGroupMembers.has(person.id)) state.selectedGroupMembers.delete(person.id);
    else if (state.selectedGroupMembers.size < 49) state.selectedGroupMembers.set(person.id, person);
    else showToast('Groups can have up to 50 members, including you.');
    renderGroupMemberPicker();
    renderGroupMemberResults();
  });
  $('group-selected-members').addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-group-person]');
    if (!button) return;
    state.selectedGroupMembers.delete(button.dataset.removeGroupPerson);
    renderGroupMemberPicker();
    renderGroupMemberResults();
  });
  $('group-create-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    submit.disabled = true;
    setStatus($('group-create-status'), 'Creating your group…');
    try {
      const chatId = await createGroup(
        String(form.get('title')).trim(),
        [...state.selectedGroupMembers.values()].map((person) => person.username),
      );
      $('group-create-dialog').hidden = true;
      await refreshChats();
      await openChat(chatId);
      showToast('Group created. Type /help to see admin commands.');
    } catch (error) {
      setStatus($('group-create-status'), friendlyError(error), true);
    } finally {
      submit.disabled = false;
    }
  });

  $('conversation').addEventListener('click', async (event) => {
    if (event.target.closest('#conversation-back')) {
      $('conversation').classList.remove('is-open');
      return;
    }
    const statusButton = event.target.closest('[data-delete-status]');
    if (statusButton) {
      statusButton.disabled = true;
      try {
        await deleteStatus(statusButton.dataset.deleteStatus);
        await loadStatuses();
        renderStatusFeed();
        showToast('Status deleted.');
      } catch (error) {
        statusButton.disabled = false;
        showToast(`Could not delete status: ${friendlyError(error)}`);
      }
      return;
    }
    if (event.target.closest('#group-info')) {
      await openGroupDetails();
    }
  });

  $('group-details-content').addEventListener('click', async (event) => {
    const chat = state.activeChat;
    if (event.target.closest('#subscribe-channel-details') && chat?.chat_type === 'channel') {
      try {
        await subscribeToChannel(chat.chat_id);
        await loadChannels(true);
        await openChat(chat.chat_id);
        await openGroupDetails();
      } catch (error) {
        showToast(friendlyError(error));
      }
      return;
    }
    if (event.target.closest('#leave-chat') && chat) {
      const kind = chat.chat_type === 'channel' ? 'channel' : 'group';
      if (!window.confirm(`Leave this ${kind}? You may need an invite to rejoin.`)) return;
      try {
        await leaveChat(chat.chat_id);
        $('group-details-dialog').hidden = true;
        await refreshChats();
        await loadChannels(true);
        state.activeChat = null;
        state.activeChatId = null;
        state.messages = [];
        $('conversation').classList.remove('is-open');
        $('conversation').innerHTML = '<div class="welcome"><h2>You left the conversation</h2><p>Choose another chat or join again with an invite.</p></div>';
        showToast(`You left the ${kind}.`);
      } catch (error) {
        showToast(`Could not leave: ${friendlyError(error)}`);
      }
      return;
    }
    if (event.target.closest('#share-group-invite') && chat?.invite_code) {
      const kind = chat.chat_type === 'channel' ? 'channel' : 'invite';
      await shareLink(
        `Join ${chat.chat_name} on Guildkeep`,
        `You're invited to join ${chat.chat_name} on Guildkeep.`,
        currentInviteUrl(kind, chat.invite_code),
      );
    }
  });
  $('group-details-content').addEventListener('submit', async (event) => {
    if (event.target.id === 'chat-settings-form') {
      event.preventDefault();
      const formElement = event.target;
      const form = new FormData(formElement);
      const chat = state.activeChat;
      if (!chat) return;
      const submit = formElement.querySelector('button[type="submit"]');
      submit.disabled = true;
      let avatarPath = null;
      let saved = false;
      const clearAvatar = form.has('clear_avatar');
      const oldAvatarPath = chat.chat_avatar_path;
      try {
        const avatarFile = form.get('avatar');
        if (avatarFile instanceof File && avatarFile.size) {
          validateUpload(avatarFile, new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']));
          const path = `${chat.chat_id}/${state.session.user.id}/${crypto.randomUUID()}.${mediaExtension(avatarFile.type)}`;
          avatarPath = await uploadMedia('chat-avatars', path, avatarFile, avatarFile.type);
        }
        await updateChatSettings(chat.chat_id, {
          title: String(form.get('title')).trim(),
          description: String(form.get('description')).trim(),
          avatarPath,
          clearAvatar: clearAvatar && !avatarPath,
          channelPublic: chat.chat_type === 'channel' ? form.has('channel_public') : null,
          groupLocked: chat.chat_type === 'group' ? form.has('group_locked') : null,
          announcementMode: chat.chat_type === 'group' ? form.has('announcement_mode') : null,
          antilinkEnabled: chat.chat_type === 'group' ? form.has('antilink_enabled') : null,
          slowmodeSeconds: chat.chat_type === 'group' ? Number(form.get('slowmode_seconds')) : null,
          groupRules: chat.chat_type === 'group' ? String(form.get('group_rules') ?? '') : null,
        });
        saved = true;
        await refreshChats();
        await loadChannels(true);
        await openChat(chat.chat_id);
        await openGroupDetails();
        showToast(`${chat.chat_type === 'channel' ? 'Channel' : 'Group'} settings saved.`);
      } catch (error) {
        showToast(`Could not save settings: ${friendlyError(error)}`);
      } finally {
        submit.disabled = false;
        if (saved && oldAvatarPath && (avatarPath || clearAvatar)) {
          try {
            await removeMedia('chat-avatars', oldAvatarPath);
          } catch (cleanupError) {
            showToast(`Settings saved, but the previous picture could not be removed: ${friendlyError(cleanupError)}`);
          }
        } else if (!saved && avatarPath) {
          try {
            await removeMedia('chat-avatars', avatarPath);
          } catch (cleanupError) {
            console.error('Could not clean up an incomplete chat picture upload.', cleanupError);
          }
        }
      }
      return;
    }
    if (event.target.id !== 'group-command-form') return;
    event.preventDefault();
    const input = event.target.elements.command;
    const command = input.value.trim();
    if (!command) return;
    const button = event.target.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await executeGroupCommand(command, true);
    } catch (error) {
      showToast(friendlyError(error));
    } finally {
      button.disabled = false;
    }
  });

  $('conversation').addEventListener('submit', async (event) => {
    if (event.target.id !== 'message-form') return;
    event.preventDefault();
    const input = event.target.elements.body;
    const body = input.value.trim();
    if (!body || !state.activeChatId) return;
    const chatId = state.activeChatId;
    const senderId = state.session.user.id;
    const button = event.target.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      if (state.activeChat?.chat_type === 'group' && body.startsWith('/')) {
        await executeGroupCommand(body);
        input.value = '';
        return;
      }
      const message = await sendMessage(chatId, senderId, body);
      if (state.activeChatId === chatId && !state.messages.some((item) => item.id === message.id)) {
        state.messages.push({ ...message, sender: state.profile });
        input.value = '';
        renderMessages();
      }
      await refreshChats();
      await markChatRead(message.chat_id, senderId);
    } catch (error) {
      showToast(friendlyError(error));
    } finally {
      button.disabled = false;
      input.focus();
    }
  });

  $('conversation').addEventListener('click', async (event) => {
    if (event.target.closest('#attach-media')) {
      $('chat-media-input').click();
      return;
    }
    if (event.target.closest('#voice-note')) {
      await toggleRecording();
      return;
    }
  });

  $('chat-media-input').addEventListener('change', async (event) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    const caption = $('message-form [name="body"]')?.value.trim() ?? '';
    const submit = $('message-form button[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      await sendChatMedia(file, false, caption);
      const input = $('message-form [name="body"]');
      if (input) input.value = '';
      showToast('Attachment sent.');
    } catch (error) {
      showToast(`Could not send attachment: ${friendlyError(error)}`);
    } finally {
      if (submit) submit.disabled = false;
    }
  });

  $('conversation').addEventListener('pointerdown', (event) => {
    const message = event.target.closest('.message[data-message-id]');
    if (!message || event.target.closest('button, a, audio, video')) return;
    clearTimeout(state.messagePressTimer);
    const { clientX, clientY } = event;
    messagePressOrigin = { x: clientX, y: clientY, pointerId: event.pointerId };
    state.messagePressTimer = setTimeout(() => {
      showMessageMenu(message.dataset.messageId, clientX, clientY);
    }, 520);
  });
  document.addEventListener('pointermove', (event) => {
    if (!messagePressOrigin || event.pointerId !== messagePressOrigin.pointerId) return;
    if (Math.hypot(event.clientX - messagePressOrigin.x, event.clientY - messagePressOrigin.y) > 12) {
      clearTimeout(state.messagePressTimer);
      messagePressOrigin = null;
    }
  });
  for (const eventName of ['pointerup', 'pointercancel']) {
    document.addEventListener(eventName, () => {
      clearTimeout(state.messagePressTimer);
      messagePressOrigin = null;
    });
  }
  $('conversation').addEventListener('contextmenu', (event) => {
    const message = event.target.closest('.message[data-message-id]');
    if (!message) return;
    event.preventDefault();
    showMessageMenu(message.dataset.messageId, event.clientX, event.clientY);
  });

  $('message-context').addEventListener('click', async (event) => {
    const reaction = event.target.closest('[data-context-reaction]');
    if (reaction) {
      try {
        await toggleMessageReaction(state.selectedMessageId, reaction.dataset.contextReaction);
        $('message-context').hidden = true;
        await refreshReactions(state.activeChatId);
      } catch (error) {
        showToast(friendlyError(error));
      }
      return;
    }
    const action = event.target.closest('[data-message-action]')?.dataset.messageAction;
    const message = state.messages.find((item) => item.id === state.selectedMessageId);
    $('message-context').hidden = true;
    if (!message || !action) return;
    if (action === 'edit') {
      $('edit-message-form').elements.body.value = message.body;
      $('edit-message-dialog').hidden = false;
      return;
    }
    if (action === 'forward') {
      openForwardDialog(message.id);
      return;
    }
    if (action === 'delete' && window.confirm('Delete this message for everyone in the conversation?')) {
      try {
        await deleteMessage(message.id);
        if (message.media_path) {
          try {
            await removeMedia('chat-media', message.media_path);
          } catch (cleanupError) {
            showToast(`Message deleted, but its attachment could not be removed: ${friendlyError(cleanupError)}`);
            return;
          }
        }
        showToast('Message deleted.');
      } catch (error) {
        showToast(friendlyError(error));
      }
    }
  });

  $('edit-message-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = String(new FormData(event.currentTarget).get('body')).trim();
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      await editMessage(state.selectedMessageId, body);
      $('edit-message-dialog').hidden = true;
      showToast('Message updated.');
    } catch (error) {
      showToast(friendlyError(error));
    } finally {
      submit.disabled = false;
    }
  });
  $('forward-chat-list').addEventListener('click', (event) => {
    const button = event.target.closest('[data-forward-chat]');
    if (button) void forwardSelectedMessage(button.dataset.forwardChat);
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('#message-context') && !event.target.closest('.message[data-message-id]')) {
      $('message-context').hidden = true;
    }
  });

  $('conversation').addEventListener('keydown', (event) => {
    if (event.target.matches('#message-form textarea') && event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.target.form.requestSubmit();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      state.peopleSearchSequence += 1;
      $('message-context').hidden = true;
      document.querySelectorAll('.dialog-backdrop').forEach((dialog) => { dialog.hidden = true; });
    }
    if (event.key === '/' && !event.target.matches('input, textarea')) {
      event.preventDefault();
      $('chat-search').focus();
    }
  });
}

if (!isConfigured) {
  $('setup-panel').hidden = false;
} else {
  const theme = localStorage.getItem('ember-theme');
  setTheme(theme === 'light');
  setAuthMode('signin');
  $('auth-panel').hidden = false;
  wire();
  try {
    onAuthChange((_event, session) => { void initialiseWorkspace(session); });
    const session = await getSession();
    await initialiseWorkspace(session);
  } catch (error) {
    setStatus($('auth-status'), friendlyError(error), true);
  }
}
