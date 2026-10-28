import './live-styles.css';
import brandLogoUrl from '../brand/logo.svg';
import helloStickerUrl from './stickers/hello.svg';
import heartStickerUrl from './stickers/heart.svg';
import laughStickerUrl from './stickers/laugh.svg';
import sparkleStickerUrl from './stickers/sparkle.svg';
import waveStickerUrl from './stickers/wave.svg';
import fireStickerUrl from './stickers/fire.svg';
import catStickerUrl from './stickers/cat.svg';
import partyStickerUrl from './stickers/party.svg';
import {
  addRecentEmoji,
  createStickerToken,
  normalizeRecentEmojis,
  RECENT_EMOJI_LIMIT,
  RECENT_EMOJI_STORAGE_KEY,
  splitPickerContent,
} from './emoji-picker.mjs';
import { renderSafeLinks } from './safe-links.mjs';
import {
  createTenorGifToken,
  normalizeTenorResults,
  safeTenorGifUrl,
} from './tenor-gifs.mjs';
import { buildVoiceWaveform, formatVoiceDuration, VOICE_WAVEFORM_BARS } from './voice-notes.mjs';
import {
  activeTypingUsers,
  compareMessageOrder,
  firstUnreadMessageId,
  isScrolledToBottom,
  readMessageCount,
  shouldSendTyping,
  totalUnreadCount,
} from './chat-live-state.mjs';
import {
  createDirectChat,
  createGroup,
  createChannel,
  createStatus,
  cleanupExpiredMessageMedia,
  deleteMessage,
  deleteStatus,
  discoverChannels,
  downloadMedia,
  editMessage,
  forwardMessage,
  getProfile,
  getProfilePreview,
  getMyMentionNotificationsEnabled,
  getMessage,
  getChatDisappearingTimer,
  getSession,
  isConfigured,
  joinGroupByInvite,
  joinChannelByInvite,
  leaveChat,
  listChats,
  listMyChatSettings,
  listGroupStatuses,
  listChatReactions,
  listContactStatuses,
  listMessages,
  listMessagesAround,
  listMyChannels,
  pinChatMessage,
  markChatRead,
  listChatReadReceipts,
  listChatPins,
  listMyMentions,
  markChatUnread,
  onAuthChange,
  runGroupCommand,
  sendMessage,
  searchProfiles,
  searchMessages,
  setChatPinned,
  setChatMuted,
  setChatDisappearingTimer,
  signedMediaUrl,
  signedMediaUrls,
  publicAvatarUrl,
  publicChatAvatarUrl,
  removeMedia,
  uploadMedia,
  subscribeToChannel,
  subscribeToReactions,
  subscribeToReadReceipts,
  subscribeToChatPins,
  subscribeToMentions,
  subscribeToChatLive,
  subscribeToChatChanges,
  signIn,
  signOut,
  signUp,
  searchTenorGifs,
  subscribeToMessages,
  subscribeToMemberships,
  toggleMessageReaction,
  unpinChatMessage,
  touchMyPresence,
  setProfilePreviewMuted,
  setProfilePreviewBlocked,
  reportProfilePreview,
  updateMyProfile,
  updateChatSettings,
  updateMyMentionNotificationsEnabled,
  updateStatusVisibility,
} from './supabase-chat.mjs';

const $ = (id) => document.getElementById(id);
const baseDocumentTitle = document.title;
const state = {
  session: null,
  profile: null,
  chats: [],
  mutingChatIds: new Set(),
  activeChatId: null,
  messages: [],
  messageExpiryTimer: null,
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
  reactionDetailsSequence: 0,
  lastTouchTap: null,
  pendingInviteHandled: false,
  currentView: 'chats',
  channels: [],
  discoveredChannels: [],
  statuses: [],
  selectedMessageId: null,
  replyingTo: null,
  hoveredMessageId: null,
  messagePressTimer: null,
  voiceRecorder: null,
  voiceTimer: null,
  voiceWaveformTimer: null,
  voiceStream: null,
  voiceAudioContext: null,
  voiceAnalyser: null,
  voiceHold: null,
  voiceStarting: false,
  voiceSamples: [],
  pendingVoiceUploads: new Map(),
  pendingChatMedia: new Map(),
  voicePlayback: null,
  recentEmojis: null,
  recentEmojiStorageWarningShown: false,
  pickerMediaDraft: null,
  tenorSearch: {
    sequence: 0,
    timer: null,
    query: '',
    results: [],
    loading: false,
    error: '',
  },
  pendingProfileAvatar: null,
  profilePreview: null,
  profilePreviewSequence: 0,
  profilePreviewOrigin: null,
  profilePreviewScroll: null,
  profilePreviewContextChatId: null,
  profilePreviewTab: 'media',
  profileLightboxIndex: -1,
  profileLightboxOrigin: null,
  presenceInterval: null,
  presenceLastTouchAt: 0,
  unsubscribeReadReceipts: null,
  unsubscribePins: null,
  pinnedMessages: [],
  unsubscribeMentions: null,
  mentions: [],
  mentionIds: new Set(),
  mentionsLoaded: false,
  mentionDraft: null,
  chatLive: null,
  readReceipts: [],
  lastReadAckMessageId: null,
  readAckArmed: false,
  scrollIntentUntil: 0,
  lastTypingSentAt: 0,
  typingByUser: new Map(),
  typingTimers: new Map(),
  onlineUserIds: new Set(),
  directPeerProfile: null,
  readAckInFlightChatId: null,
  messageSearch: {
    timer: null,
    sequence: 0,
    term: '',
    scope: 'global',
    offset: 0,
    results: [],
    selectedIndex: 0,
    origin: null,
    previousOverflow: '',
  },
  searchJump: null,
};

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (character) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
  );

const EMOJI_OPTIONS = ['😀', '😂', '🥰', '😍', '😊', '😎', '😭', '😮', '🤔', '🙏', '👏', '👍', '👎', '❤️', '🧡', '💛', '💚', '💙', '💜', '✨', '🔥', '🎉', '💯', '✅', '🤝', '👋', '🌸', '☀️', '🍕', '☕', '🐈', '🎵'];
const LEGACY_STICKER_EMOJIS = new Set(['🥹', '😂', '🥰', '😎', '🤔', '🙌', '❤️', '🔥', '🎉', '🐈', '🌸', '💯']);
const STICKER_OPTIONS = [
  { id: 'hello', title: 'Hello', alt: 'Hello speech bubble', src: helloStickerUrl },
  { id: 'heart', title: 'Heart', alt: 'Orange heart', src: heartStickerUrl },
  { id: 'laugh', title: 'Laugh', alt: 'Laughing face', src: laughStickerUrl },
  { id: 'sparkle', title: 'Sparkle', alt: 'Orange sparkle', src: sparkleStickerUrl },
  { id: 'wave', title: 'Wave', alt: 'Waving hand', src: waveStickerUrl },
  { id: 'fire', title: 'Fire', alt: 'Flame', src: fireStickerUrl },
  { id: 'cat', title: 'Cat', alt: 'Orange cat', src: catStickerUrl },
  { id: 'party', title: 'Celebrate', alt: 'Party popper', src: partyStickerUrl },
];
const STICKERS_BY_ID = new Map(STICKER_OPTIONS.map((sticker) => [sticker.id, sticker]));
const PICKER_CONTENT_PATTERN = /\[\[guildkeep-(sticker|gif):([^\]]+)\]\]/g;

function getStickerIdFromBody(body) {
  const trimmed = String(body ?? '').trim();
  const match = /^\[\[guildkeep-sticker:([a-z0-9-]+)\]\]$/.exec(trimmed);
  return match && STICKERS_BY_ID.has(match[1]) ? match[1] : null;
}

function pickerMessageLabel(body) {
  const stickerId = getStickerIdFromBody(body);
  if (stickerId) return `Sticker · ${STICKERS_BY_ID.get(stickerId).title}`;
  if (LEGACY_STICKER_EMOJIS.has(String(body ?? '').trim())) return 'Sticker';
  return splitPickerContent(body).map((segment) => {
    if (segment.type === 'text') return segment.value;
    if (segment.type === 'sticker' && STICKERS_BY_ID.has(segment.value)) {
      return `Sticker · ${STICKERS_BY_ID.get(segment.value).title}`;
    }
    if (segment.type === 'gif' && safeTenorGifUrl(segment.value)) return 'GIF';
    return segment.token;
  }).join('');
}

function renderPickerContent(body, messageId) {
  const text = String(body ?? '');
  let html = '';
  let lastIndex = 0;
  for (const match of text.matchAll(PICKER_CONTENT_PATTERN)) {
    const precedingText = text.slice(lastIndex, match.index);
    if (precedingText) {
      html += state.searchJump?.messageId === messageId
        ? highlightSearchText(precedingText, state.searchJump.term)
        : renderSafeLinks(precedingText);
    }
    if (match[1] === 'sticker' && STICKERS_BY_ID.has(match[2])) {
      const sticker = STICKERS_BY_ID.get(match[2]);
      html += `<img class="message-sticker" src="${esc(sticker.src)}" alt="${esc(sticker.alt)}" width="120" height="120" loading="lazy" />`;
    } else if (match[1] === 'gif' && safeTenorGifUrl(match[2])) {
      html += `<figure class="message-gif-figure">
        <img class="message-gif" src="${esc(safeTenorGifUrl(match[2]))}" alt="Animated GIF" loading="lazy" />
        <figcaption><a href="https://tenor.com" target="_blank" rel="noopener noreferrer nofollow">Via Tenor</a></figcaption>
      </figure>`;
    } else {
      html += esc(match[0]);
    }
    lastIndex = match.index + match[0].length;
  }
  const trailingText = text.slice(lastIndex);
  if (trailingText || !html) {
    html += state.searchJump?.messageId === messageId
      ? highlightSearchText(trailingText, state.searchJump.term)
      : renderSafeLinks(trailingText);
  }
  return html;
}

function isStandaloneSticker(body) {
  return Boolean(getStickerIdFromBody(body) || LEGACY_STICKER_EMOJIS.has(String(body ?? '').trim()));
}

function reportRecentEmojiStorageError(error) {
  console.error('Could not access recently used emojis in local storage.', error);
  if (state.recentEmojiStorageWarningShown) return;
  state.recentEmojiStorageWarningShown = true;
  showToast('Recent emojis could not be saved in this browser.');
}

function loadRecentEmojis() {
  if (state.recentEmojis) return state.recentEmojis;
  try {
    const stored = localStorage.getItem(RECENT_EMOJI_STORAGE_KEY);
    state.recentEmojis = normalizeRecentEmojis(stored ? JSON.parse(stored) : [], EMOJI_OPTIONS);
  } catch (error) {
    state.recentEmojis = [];
    reportRecentEmojiStorageError(error);
  }
  return state.recentEmojis;
}

function rememberEmoji(emoji) {
  state.recentEmojis = addRecentEmoji(loadRecentEmojis(), emoji, EMOJI_OPTIONS);
  try {
    localStorage.setItem(RECENT_EMOJI_STORAGE_KEY, JSON.stringify(state.recentEmojis));
  } catch (error) {
    reportRecentEmojiStorageError(error);
  }
}

function renderPickerMediaDraft() {
  const draft = $('picker-media-draft');
  if (!draft) return;
  const media = state.pickerMediaDraft;
  draft.hidden = !media;
  if (!media) {
    draft.innerHTML = '';
    return;
  }
  const sticker = media.type === 'sticker' ? STICKERS_BY_ID.get(media.id) : null;
  const gifUrl = media.type === 'gif' ? safeTenorGifUrl(media.gifUrl) : null;
  if (!sticker && !gifUrl) {
    state.pickerMediaDraft = null;
    draft.hidden = true;
    draft.innerHTML = '';
    return;
  }
  const title = sticker?.title ?? media.title ?? 'GIF';
  draft.innerHTML = `
    <span class="picker-media-draft-label">${esc(title)} ready to send</span>
    <img src="${esc(sticker?.src ?? gifUrl)}" alt="${esc(sticker?.alt ?? 'Animated GIF preview')}" />
    <button type="button" class="picker-media-draft-remove" data-remove-picker-media aria-label="Remove ${esc(title)}">×</button>`;
}

function messageBodyWithPickerMedia(body) {
  const text = body.trim();
  const media = state.pickerMediaDraft;
  if (!media) return text;
  const token = media.type === 'sticker'
    ? createStickerToken(media.id)
    : createTenorGifToken(media.gifUrl);
  return [text, token].filter(Boolean).join('\n');
}

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

function chatType(chat = state.activeChat) {
  return chat?.chat_type ?? (chat?.is_group ? 'group' : 'direct');
}

function chatMatchesActiveView(chat = state.activeChat) {
  const expectedType = { chats: 'direct', groups: 'group', channels: 'channel' }[state.currentView];
  return Boolean(chat && chatType(chat) === expectedType);
}

function conversationIsVisible() {
  if (!chatMatchesActiveView()) return false;
  return !window.matchMedia('(max-width: 760px)').matches
    || $('conversation').classList.contains('is-open');
}

function clearTypingTimers() {
  for (const timer of state.typingTimers.values()) clearTimeout(timer);
  state.typingTimers.clear();
  state.typingByUser.clear();
}

function stopChatLive() {
  cancelVoiceRecording();
  state.unsubscribeMessages?.();
  state.unsubscribeChat?.();
  state.unsubscribeReactions?.();
  state.unsubscribeReadReceipts?.();
  state.unsubscribePins?.();
  state.chatLive?.unsubscribe();
  state.unsubscribeMessages = null;
  state.unsubscribeChat = null;
  state.unsubscribeReactions = null;
  state.unsubscribeReadReceipts = null;
  state.unsubscribePins = null;
  state.pinnedMessages = [];
  state.chatLive = null;
  state.readReceipts = [];
  state.onlineUserIds = new Set();
  state.directPeerProfile = null;
  state.lastReadAckMessageId = null;
  state.readAckInFlightChatId = null;
  state.readAckArmed = false;
  state.lastTypingSentAt = 0;
  clearTypingTimers();
}

async function updateLastSeen() {
  const userId = state.session?.user?.id;
  const now = Date.now();
  if (!userId || now - state.presenceLastTouchAt < 60_000) return;
  state.presenceLastTouchAt = now;
  try {
    await touchMyPresence();
  } catch (error) {
    console.warn('Could not update last-seen time.', error);
    showToast(`Presence update failed: ${friendlyError(error)}`);
  }
}

function renderTypingIndicator() {
  const indicator = $('chat-typing');
  if (!indicator) return;
  const userIds = activeTypingUsers(state.typingByUser, Date.now())
    .filter((userId) => userId !== state.session?.user?.id);
  const chat = state.activeChat;
  if (!userIds.length || !['direct', 'group'].includes(chatType(chat))) {
    indicator.hidden = true;
    indicator.textContent = '';
    return;
  }
  if (chatType(chat) === 'direct') {
    const userId = userIds[0];
    const name = chat?.participants?.find((person) => person.id === userId)?.display_name
      ?? state.directPeerProfile?.display_name
      ?? 'Someone';
    indicator.textContent = `${name} is typing…`;
  } else {
    indicator.textContent = userIds.length === 1
      ? '1 member is typing…'
      : `${userIds.length} members are typing…`;
  }
  indicator.hidden = false;
}

function renderPresenceIndicator() {
  const indicator = $('chat-presence');
  if (!indicator) return;
  const chat = state.activeChat;
  if (chatType(chat) === 'direct') {
    const peerId = chat?.participants?.find((person) => person.id !== state.session?.user?.id)?.id;
    if (!peerId) {
      indicator.textContent = '';
      return;
    }
    const online = state.onlineUserIds.has(peerId);
    indicator.textContent = online
      ? 'Online'
      : state.directPeerProfile?.last_seen_at
        ? formatLastSeen(state.directPeerProfile.last_seen_at)
        : 'Offline';
    indicator.classList.toggle('is-online', online);
    return;
  }
  const onlineCount = [...state.onlineUserIds]
    .filter((userId) => userId !== state.session?.user?.id).length;
  indicator.textContent = onlineCount ? `${onlineCount} online` : '';
  indicator.classList.toggle('is-online', onlineCount > 0);
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
  clearInterval(state.presenceInterval);
  state.presenceInterval = null;
  state.presenceLastTouchAt = 0;
  clearInterval(state.voiceTimer);
  clearInterval(state.voiceWaveformTimer);
  clearTimeout(state.messageExpiryTimer);
  state.messageExpiryTimer = null;
  state.voiceTimer = null;
  state.voiceWaveformTimer = null;
  state.voiceHold = { released: true, cancelled: true };
  if (state.voiceRecorder?.state === 'recording') state.voiceRecorder.stop();
  state.voiceStream?.getTracks().forEach((track) => track.stop());
  state.voiceStream = null;
  state.voiceRecorder = null;
  state.voiceAnalyser = null;
  if (state.voiceAudioContext && state.voiceAudioContext.state !== 'closed') {
    void state.voiceAudioContext.close().catch((error) => console.error('Could not close voice recording audio context.', error));
  }
  state.voiceAudioContext = null;
  for (const pending of state.pendingVoiceUploads.values()) {
    URL.revokeObjectURL(pending.optimistic.media_url);
  }
  state.pendingVoiceUploads.clear();
  for (const queue of state.pendingChatMedia.values()) {
    for (const item of queue) {
      item.abortController?.abort();
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    }
  }
  state.pendingChatMedia.clear();
  stopChatLive();
  clearTimeout(state.messageExpiryTimer);
  state.messageExpiryTimer = null;
  state.unsubscribeMentions?.();
  state.unsubscribeMentions = null;
  state.mentions = [];
  state.mentionIds = new Set();
  state.mentionsLoaded = false;
  state.mentionDraft = null;
  setMentionNotificationsOpen(false);
  renderMentionNotifications();
  if (!$('profile-preview').hidden) closeProfilePreview(false);
  state.unsubscribeMemberships?.();
  state.unsubscribeMemberships = null;
  state.session = null;
  state.initializingUserId = null;
  state.profile = null;
  state.chats = [];
  state.mutingChatIds.clear();
  renderUnreadTotal();
  state.activeChatId = null;
  state.activeChat = null;
  state.messages = [];
  state.replyingTo = null;
  state.hoveredMessageId = null;
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
    const preview = pickerMessageLabel(chat.last_message?.body);
    return `${chat.chat_name} ${preview}`.toLocaleLowerCase().includes(search);
  });

  const chatMarkup = chats
    .map((chat) => {
      const type = chat.chat_type ?? (chat.is_group ? 'group' : 'direct');
      const preview = pickerMessageLabel(chat.last_message?.body) || 'Start a conversation';
      const unread = Number(chat.unread_count) || 0;
      const unreadMarker = unread
        ? chat.muted
          ? `<span class="chat-unread-dot" role="img" aria-label="${unread} unread messages in muted chat"></span>`
          : `<span class="unread-badge" aria-label="${unread} unread messages">${unread > 99 ? '99+' : unread}</span>`
        : '';
      const peer = type === 'direct' ? chat.participants?.[0] : null;
      const row = peer ? `
        <div class="row row-profile-layout ${state.activeChatId === chat.chat_id ? 'is-active' : ''} ${unread && !chat.muted ? 'has-unread' : ''}"
          role="group" aria-label="Chat with ${esc(chat.chat_name)}">
          <button class="profile-preview-trigger profile-preview-avatar" type="button"
            data-profile-preview-id="${esc(peer.id)}" aria-label="View ${esc(peer.display_name)}'s profile">
            ${avatar(peer.display_name, peer.id, peer.avatar_path)}
          </button>
          <span class="row-main">
            <span class="row-top">
              <button class="row-title profile-preview-trigger" type="button"
                data-profile-preview-id="${esc(peer.id)}">${esc(chat.chat_name)}</button>
              <span class="row-time">${esc(chatTimestamp(chat))}</span>
            </span>
            <button class="row-sub chat-open-trigger" type="button" data-chat-id="${esc(chat.chat_id)}"
              aria-pressed="${state.activeChatId === chat.chat_id}">
              ${esc(preview)}
            </button>
          </span>
          ${unreadMarker}
        </div>` : `
        <button class="row ${unread && !chat.muted ? 'has-unread' : ''}" type="button" data-chat-id="${esc(chat.chat_id)}"
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
          ${unreadMarker}
        </button>`;
      return `
        <div class="live-chat-row">
          ${row}
          ${type !== 'channel' ? `<button class="chat-pin ${chat.pinned ? 'is-pinned' : ''}" type="button"
            data-pin-id="${esc(chat.chat_id)}" aria-label="${chat.pinned ? 'Unpin' : 'Pin'} ${esc(chat.chat_name)}"
            aria-pressed="${Boolean(chat.pinned)}" title="${chat.pinned ? 'Unpin chat' : 'Pin chat'}">
            ${chat.pinned ? '★' : '☆'}
          </button>` : ''}
          ${type !== 'channel' ? `<button class="chat-mute ${chat.muted ? 'is-muted' : ''}" type="button"
            data-mute-id="${esc(chat.chat_id)}" aria-label="${chat.muted ? 'Unmute' : 'Mute'} ${esc(chat.chat_name)}"
            aria-pressed="${Boolean(chat.muted)}" title="${chat.muted ? 'Unmute chat' : 'Mute chat'}"
            ${state.mutingChatIds.has(chat.chat_id) ? 'disabled' : ''}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
              ${chat.muted ? '<path d="m4 4 16 16" />' : ''}
            </svg>
          </button>` : ''}
          <button class="chat-mark-unread" type="button" data-mark-unread-id="${esc(chat.chat_id)}"
            aria-label="Mark ${esc(chat.chat_name)} as unread" title="Mark as unread">●</button>
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

function renderUnreadTotal() {
  const button = $('unread-total-toggle');
  const badge = $('unread-total-count');
  if (!button || !badge) return;
  const count = totalUnreadCount(state.chats);
  badge.hidden = count === 0;
  badge.textContent = count > 99 ? '99+' : String(count);
  button.setAttribute('aria-label', count
    ? `Chats, ${count} unread messages`
    : 'Chats, no unread messages');
  document.title = count ? `(${count}) ${baseDocumentTitle}` : baseDocumentTitle;
}

function updateNavigation(view) {
  if (state.currentView !== view) {
    stopChatLive();
    state.activeChatId = null;
    state.activeChat = null;
    state.messages = [];
  }
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
  const mentionNotificationsEnabled = state.profile.mention_notifications_enabled !== false;
  $('conversation').innerHTML = `
    <section class="settings-page">
      <h2>Settings</h2>
      <button class="settings-profile-card" type="button" id="settings-edit-profile">
        ${avatar(state.profile.display_name, state.profile.id, state.profile.avatar_path)}
        <span><strong>${esc(state.profile.display_name)}</strong><small>@${esc(state.profile.username)} · Edit profile photo, name and bio</small></span>
        <span aria-hidden="true">›</span>
      </button>
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
      <div class="settings-section">
        <h3>Notifications</h3>
        <label class="settings-row settings-notification-toggle">
          <span><strong>Mention alerts</strong><small>Show the unread badge and alert when someone mentions you. Turning this off keeps unread mentions in the bell without a badge or toast.</small></span>
          <input id="settings-mention-notifications" type="checkbox" ${mentionNotificationsEnabled ? 'checked' : ''} />
        </label>
      </div>
    </section>`;
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
  $('settings-mention-notifications').addEventListener('change', async (event) => {
    const checkbox = event.currentTarget;
    const previousEnabled = state.profile.mention_notifications_enabled !== false;
    checkbox.disabled = true;
    try {
      state.profile.mention_notifications_enabled = await updateMyMentionNotificationsEnabled(checkbox.checked);
      renderMentionNotifications();
      showToast(checkbox.checked
        ? 'Mention alerts are on.'
        : 'Mention alerts are off. Unread mentions remain in the notification list.');
    } catch (error) {
      checkbox.checked = previousEnabled;
      showToast(`Could not update mention alerts: ${friendlyError(error)}`);
    } finally {
      checkbox.disabled = false;
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

function renderMentionSuggestions(input) {
  const panel = $('mention-suggestions');
  if (!panel) return;
  const cursor = input.selectionStart;
  const beforeCursor = input.value.slice(0, cursor);
  const match = /(?:^|\s)@([a-z0-9_]{0,24})$/i.exec(beforeCursor);
  if (!match || !['direct', 'group'].includes(chatType())) {
    panel.hidden = true;
    state.mentionDraft = null;
    return;
  }
  const query = match[1].toLocaleLowerCase();
  const start = cursor - query.length - 1;
  const candidates = (state.activeChat?.participants ?? [])
    .filter((person) => person.username?.toLocaleLowerCase().startsWith(query)
      || person.display_name?.toLocaleLowerCase().includes(query))
    .slice(0, 8);
  if (!candidates.length) {
    panel.hidden = true;
    state.mentionDraft = null;
    return;
  }
  state.mentionDraft = { start, end: cursor };
  panel.innerHTML = candidates.map((person) => `<button type="button" class="mention-suggestion"
      role="option" data-mention-id="${esc(person.id)}">
      <strong>${esc(person.display_name)}</strong><small>@${esc(person.username)}</small>
    </button>`).join('');
  panel.hidden = false;
}

function selectMentionSuggestion(userId) {
  const input = $('message-form [name="body"]');
  const person = state.activeChat?.participants.find((participant) => participant.id === userId);
  const draft = state.mentionDraft;
  if (!input || !person || !draft) return;
  const insertion = `@${person.username} `;
  input.setRangeText(insertion, draft.start, draft.end, 'end');
  state.mentionDraft = null;
  $('mention-suggestions').hidden = true;
  input.focus();
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function setMentionNotificationsOpen(open) {
  const panel = $('mention-notifications');
  const button = $('mention-notifications-toggle');
  if (!panel || !button) return;
  panel.hidden = !open;
  button.setAttribute('aria-expanded', String(open));
}

function formatMessageTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function renderMessages() {
  const list = $('message-list');
  if (!list) return;
  clearTimeout(state.messageExpiryTimer);
  state.messageExpiryTimer = null;
  const now = Date.now();
  state.messages = state.messages.filter((message) => {
    if (!message.expires_at) return true;
    const expiresAt = Date.parse(message.expires_at);
    return !Number.isFinite(expiresAt) || expiresAt > now;
  });
  const nextExpiry = state.messages.reduce((earliest, message) => {
    if (!message.expires_at) return earliest;
    const expiresAt = Date.parse(message.expires_at);
    return Number.isFinite(expiresAt) && expiresAt < earliest ? expiresAt : earliest;
  }, Infinity);
  if (Number.isFinite(nextExpiry)) {
    state.messageExpiryTimer = setTimeout(() => renderMessages(), Math.max(0, nextExpiry - now + 10));
  }
  const activeAudio = [...list.querySelectorAll('.voice-player-audio')].find((audio) => !audio.paused);
  const playback = activeAudio
    ? {
      messageId: activeAudio.closest('[data-message-id]')?.dataset.messageId,
      currentTime: activeAudio.currentTime,
      playbackRate: activeAudio.playbackRate,
    }
    : null;
  const wasAtBottom = list.scrollHeight <= list.clientHeight || isScrolledToBottom(list);
  const previousScrollTop = list.scrollTop;
  if (state.loadingMessages) {
    list.innerHTML = '<div class="loading">Loading messages…</div>';
    return;
  }
  if (!state.messages.length) {
    list.innerHTML = '<div class="loading">No messages yet. Say hello.</div>';
    return;
  }

  const firstUnreadId = firstUnreadMessageId(
    state.messages,
    state.session.user.id,
    state.activeChat?.last_read_at,
  );
  list.innerHTML = state.messages
    .map((message) => {
      const unreadDivider = message.id === firstUnreadId
        ? '<div class="new-messages-divider" role="separator" aria-label="New messages"><span>New messages</span></div>'
        : '';
      const own = message.sender_id === state.session.user.id;
      const senderName = message.sender?.display_name ??
        (own ? state.profile.display_name : state.activeChat?.chat_name ?? 'Member');
      const senderUsername = message.sender?.username ?? '';
      const sticker = isStandaloneSticker(message.body);
      const replyTo = Array.isArray(message.reply_to) ? message.reply_to[0] : message.reply_to;
      const reactions = state.reactions.get(message.id) ?? [];
      const readCount = readMessageCount(
        state.messages,
        message.id,
        state.session.user.id,
        state.readReceipts,
      );
      const directPeerId = state.activeChat?.participants
        ?.find((person) => person.id !== state.session.user.id)?.id;
      const peerReceipt = state.readReceipts.find((receipt) => receipt.user_id === directPeerId);
      const readByPeer = peerReceipt
        ? readMessageCount(state.messages, message.id, state.session.user.id, [peerReceipt]) > 0
        : false;
      const media = renderMessageMedia(message);
      const reactionMarkup = ['👍', '❤️', '😂', '😮', '😢', '🙏']
        .map((emoji) => {
          const matching = reactions.filter((item) => item.reaction === emoji);
          if (!matching.length) return '';
          const mine = matching.some((item) => item.user_id === state.session.user.id);
          return `<span class="reaction-chip ${mine ? 'is-selected' : ''}">
            <button type="button" class="reaction-toggle" data-toggle-reaction="${esc(emoji)}"
              data-reaction-message="${esc(message.id)}" aria-label="Toggle your ${esc(emoji)} reaction">${emoji}</button>
            <button type="button" class="reaction-count" data-reaction-details="${esc(emoji)}"
              data-reaction-message="${esc(message.id)}" aria-label="See ${matching.length} people who reacted ${esc(emoji)}">${matching.length}</button>
          </span>`;
        }).join('');
      if (message.deleted_at) {
        return `${unreadDivider}<div class="message ${own ? 'outgoing' : ''} is-deleted" data-message-id="${esc(message.id)}"><em>Message deleted</em></div>`;
      }
      return `
        ${unreadDivider}<div class="message ${own ? 'outgoing' : ''} ${sticker ? 'is-sticker' : ''} ${message.pending_voice ? 'is-pending-voice' : ''}" data-message-id="${esc(message.id)}" tabindex="0">
          <div class="message-quick-reactions" aria-label="Quick reactions">
            ${['👍', '❤️', '😂', '😮', '😢', '🙏'].map((emoji) => `<button type="button"
              data-quick-reaction="${esc(emoji)}" data-reaction-message="${esc(message.id)}"
              aria-label="React ${esc(emoji)}">${emoji}</button>`).join('')}
          </div>
          <button class="message-reply-shortcut" type="button" data-message-reply="${esc(message.id)}"
            aria-label="Reply to ${esc(senderName)}" title="Reply (R)">↶</button>
          ${!own ? `<div class="message-author">
            <button class="profile-preview-trigger message-author-avatar" type="button"
              data-profile-preview-id="${esc(message.sender_id)}"
              ${state.activeChat?.chat_type === 'group' ? `data-profile-preview-context="${esc(state.activeChatId)}"` : ''}
              aria-label="View ${esc(senderName)}'s profile">${avatar(senderName, message.sender_id, message.sender?.avatar_path)}</button>
            <button class="profile-preview-trigger message-sender" type="button"
              data-profile-preview-id="${esc(message.sender_id)}"
              ${state.activeChat?.chat_type === 'group' ? `data-profile-preview-context="${esc(state.activeChatId)}"` : ''}>
              ${esc(senderName)}${senderUsername ? ` <small>@${esc(senderUsername)}</small>` : ''}
            </button>
          </div>` : ''}
          ${message.forwarded_from ? '<span class="forwarded-label">Forwarded</span>' : ''}
          ${replyTo ? `<button class="message-quote" type="button" data-scroll-to-message="${esc(replyTo.id)}"
            aria-label="Jump to reply from ${esc(replyTo.sender?.display_name ?? 'Member')}">
            <strong>${esc(replyTo.deleted_at ? 'Message deleted' : (replyTo.sender?.display_name ?? 'Message'))}</strong>
            <span>${esc(replyTo.deleted_at ? 'Message deleted' : (pickerMessageLabel(replyTo.body) || 'Attachment'))}</span>
          </button>` : ''}
          ${message.body ? `<div class="message-text">${renderPickerContent(message.body, message.id)}</div>` : ''}
          ${media}
          <span class="message-meta">${message.edited_at ? 'edited · ' : ''}${esc(formatMessageTime(message.created_at))}
            ${own && state.activeChat?.chat_type === 'direct'
              ? `<span class="message-sent-tick ${readByPeer ? 'is-read' : ''}" aria-label="${readByPeer ? 'Read' : 'Sent'}">${readByPeer ? '✓✓' : '✓'}</span>`
              : own && state.activeChat?.chat_type === 'group' && readCount
                ? `<button class="message-read-count" type="button" data-read-count="${readCount}"
                    title="${readCount} member${readCount === 1 ? '' : 's'} read this message">${readCount} read</button>`
                : ''}
          </span>
          ${reactionMarkup ? `<div class="message-reactions" aria-label="Reactions">${reactionMarkup}</div>` : ''}
        </div>`;
    })
    .join('');
  bindVoicePlayers(list, playback);
  list.scrollTop = wasAtBottom ? list.scrollHeight : previousScrollTop;
  if (wasAtBottom && state.readAckArmed) void markChatReadIfAtBottom();
}

function updateReplyStrip() {
  const strip = $('reply-strip');
  if (!strip) return;
  const replyTo = state.replyingTo;
  strip.hidden = !replyTo;
  if (!replyTo) return;
  const senderName = replyTo.sender?.display_name ??
    (replyTo.sender_id === state.session?.user?.id ? state.profile?.display_name : state.activeChat?.chat_name) ??
    'Message';
  const quote = strip.querySelector('[data-reply-copy]');
  quote.innerHTML = `<strong>Replying to ${esc(senderName)}</strong><span>${esc(replyTo.deleted_at ? 'Message deleted' : (pickerMessageLabel(replyTo.body) || 'Attachment'))}</span>`;
}

function setReplyTarget(messageId) {
  const message = state.messages.find((item) => item.id === messageId);
  if (!message || message.deleted_at) return;
  state.replyingTo = message;
  updateReplyStrip();
  $('message-form [name="body"]')?.focus();
}

async function scrollToMessage(messageId) {
  let target = document.querySelector(`.message[data-message-id="${CSS.escape(messageId)}"]`);
  if (!target && state.activeChatId) {
    try {
      const message = await getMessage(state.activeChatId, messageId);
      state.messages.push(...await hydrateMessages([message]));
      state.messages.sort((left, right) => new Date(left.created_at) - new Date(right.created_at));
      renderMessages();
      target = document.querySelector(`.message[data-message-id="${CSS.escape(messageId)}"]`);
    } catch (error) {
      showToast(`Could not find the original message: ${friendlyError(error)}`);
      return;
    }
  }
  if (!target) return;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  target.focus({ preventScroll: true });
  target.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' });
  target.classList.remove('message-flash');
  void target.offsetWidth;
  target.classList.add('message-flash');
  setTimeout(() => target.classList.remove('message-flash'), 2000);
}

function renderSearchSnippet(snippet) {
  const parsed = new DOMParser().parseFromString(`<body>${snippet ?? ''}</body>`, 'text/html');
  const safeNodes = (nodes) => [...nodes].map((node) => {
    if (node.nodeType === Node.TEXT_NODE) return esc(node.nodeValue);
    const children = safeNodes(node.childNodes);
    return node.nodeName === 'MARK' ? `<mark>${children}</mark>` : children;
  }).join('');
  return safeNodes(parsed.body.childNodes);
}

function highlightSearchText(text, term) {
  const words = [...new Set(term.toLowerCase().split(/[^\p{L}\p{N}_]+/u).filter((word) => word.length >= 2))].slice(0, 8);
  if (!words.length) return esc(text);
  const pattern = new RegExp(
    `(${words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`,
    'giu',
  );
  return String(text).split(pattern).map((part) =>
    words.some((word) => part.toLowerCase() === word) ? `<mark>${esc(part)}</mark>` : esc(part),
  ).join('');
}

function renderMessageSearchResults() {
  const { results, selectedIndex, offset } = state.messageSearch;
  const container = $('message-search-results');
  if (!results.length) {
    container.innerHTML = '';
    $('message-search-position').textContent = '0 results';
    $('message-search-status').textContent = 'No matching messages found.';
    return;
  }
  container.innerHTML = results.map((result, index) => `
    <button type="button" class="message-search-result ${index === selectedIndex ? 'is-selected' : ''}"
      data-message-search-result="${index}" aria-current="${index === selectedIndex ? 'true' : 'false'}">
      <span class="message-search-result-meta">
        <strong>${esc(result.chat_name || 'Conversation')}</strong>
        <time>${esc(new Date(result.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }))}</time>
      </span>
      <span class="message-search-result-snippet">${renderSearchSnippet(result.snippet)}</span>
    </button>`).join('');
  $('message-search-position').textContent =
    `${offset + selectedIndex + 1}–${offset + results.length} results`;
  $('message-search-status').textContent = `${results.length} matching messages loaded. Select one to jump to it.`;
}

async function loadMessageSearchResults() {
  const search = state.messageSearch;
  clearTimeout(search.timer);
  const query = $('message-search-query').value.trim();
  search.term = query;
  const sequence = ++search.sequence;
  $('message-search-results').innerHTML = '';
  search.results = [];
  search.selectedIndex = 0;
  if (query.length < 2) {
    $('message-search-position').textContent = '0 results';
    $('message-search-status').textContent = 'Enter at least 2 characters to search.';
    return;
  }
  if (query.length > 100) {
    $('message-search-status').textContent = 'Search queries are limited to 100 characters.';
    return;
  }
  if (search.scope === 'chat' && !state.activeChatId) {
    $('message-search-status').textContent = 'Open a conversation to search within it.';
    return;
  }
  $('message-search-status').textContent = 'Searching messages…';
  try {
    const results = await searchMessages(
      query,
      search.scope === 'chat' ? state.activeChatId : null,
      25,
      search.offset,
    );
    if (sequence !== search.sequence || $('message-search-overlay').hidden) return;
    search.results = results;
    renderMessageSearchResults();
  } catch (error) {
    if (sequence !== search.sequence) return;
    $('message-search-status').textContent = `Could not search messages: ${friendlyError(error)}`;
  }
}

function scheduleMessageSearch() {
  clearTimeout(state.messageSearch.timer);
  state.messageSearch.timer = setTimeout(() => void loadMessageSearchResults(), 250);
}

function openMessageSearch(scope = 'global') {
  const overlay = $('message-search-overlay');
  const search = state.messageSearch;
  search.origin = document.activeElement;
  search.previousOverflow = document.body.style.overflow;
  search.scope = scope === 'chat' && state.activeChatId ? 'chat' : 'global';
  search.offset = 0;
  search.results = [];
  overlay.hidden = false;
  document.body.style.overflow = 'hidden';
  document.querySelectorAll('[data-message-search-scope]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.messageSearchScope === search.scope));
    button.disabled = button.dataset.messageSearchScope === 'chat' && !state.activeChatId;
  });
  $('message-search-query').value = search.term;
  $('message-search-status').textContent = search.term.length >= 2
    ? 'Searching messages…'
    : 'Enter at least 2 characters to search.';
  $('message-search-panel').focus();
  $('message-search-query').focus({ preventScroll: true });
  if (search.term.length >= 2) void loadMessageSearchResults();
}

function closeMessageSearch(restoreFocus = true) {
  const overlay = $('message-search-overlay');
  if (overlay.hidden) return;
  clearTimeout(state.messageSearch.timer);
  state.messageSearch.sequence += 1;
  overlay.hidden = true;
  document.body.style.overflow = state.messageSearch.previousOverflow;
  if (restoreFocus && state.messageSearch.origin?.isConnected) {
    state.messageSearch.origin.focus({ preventScroll: true });
  }
}

async function jumpToSearchResult(result) {
  const search = state.messageSearch;
  closeMessageSearch(false);
  const view = result.chat_type === 'group' ? 'groups'
    : result.chat_type === 'channel' ? 'channels' : 'chats';
  if (state.currentView !== view) updateNavigation(view);
  const chat = [...state.chats, ...state.channels, ...state.discoveredChannels]
    .find((item) => item.chat_id === result.chat_id) ?? {
      chat_id: result.chat_id,
      chat_name: result.chat_name || 'Conversation',
      chat_type: result.chat_type,
      is_group: result.chat_type !== 'direct',
      participants: [],
      my_role: null,
    };
  if (state.activeChatId !== result.chat_id) await openChat(result.chat_id, chat);
  if (state.activeChatId !== result.chat_id) return;
  if (!state.messages.some((message) => message.id === result.message_id)) {
    try {
      const [windowMessages, exactMessage] = await Promise.all([
        listMessagesAround(result.chat_id, result.created_at, 240),
        getMessage(result.chat_id, result.message_id),
      ]);
      if (state.activeChatId !== result.chat_id) return;
      state.messages = await hydrateMessages([...windowMessages, exactMessage]);
      state.messages.sort(compareMessageOrder);
      state.reactions = new Map();
      renderMessages();
    } catch (error) {
      showToast(`Could not load older messages: ${friendlyError(error)}`);
      return;
    }
  }
  state.searchJump = { messageId: result.message_id, term: search.term };
  renderMessages();
  await scrollToMessage(result.message_id);
}

function renderMessageMedia(message) {
  if (!message.media_url) return '';
  const src = esc(message.media_url);
  if (message.voice_note) return renderVoicePlayer(message);
  if (message.media_type?.startsWith('audio/')) {
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

function renderVoicePlayer(message) {
  const duration = Number(message.voice_duration_ms) || 0;
  const peaks = Array.isArray(message.voice_waveform)
    ? message.voice_waveform
      .slice(0, VOICE_WAVEFORM_BARS)
      .map((peak) => Math.min(1, Math.max(0.08, Number(peak) || 0.08)))
    : [];
  const bars = peaks.length ? peaks : Array.from({ length: 32 }, (_, index) => index % 4 === 0 ? 0.34 : 0.16);
  const pending = message.pending_voice ? `
    <span class="voice-player-status" role="status">${message.uploading_voice ? 'Sending voice note…' : 'Voice note not sent'}</span>
    ${message.uploading_voice ? '' : `<button class="voice-player-retry" type="button" data-retry-pending-voice="${esc(message.id)}">Retry</button>
      <button class="voice-player-remove" type="button" data-discard-pending-voice="${esc(message.id)}" aria-label="Remove unsent voice note">×</button>`}`
    : '';
  return `<div class="voice-player ${message.pending_voice ? 'is-pending' : ''}" data-voice-player data-duration="${duration}">
    <audio class="voice-player-audio" preload="metadata" src="${esc(message.media_url)}" aria-hidden="true"></audio>
    <button class="voice-player-toggle" type="button" data-voice-play aria-label="Play voice note">▶</button>
    <div class="voice-player-track">
      <div class="voice-waveform" aria-hidden="true">
        ${bars.map((peak, index) => `<span data-voice-bar="${index}" style="--voice-peak:${peak}"></span>`).join('')}
      </div>
      <input class="voice-player-seek" type="range" min="0" max="1000" value="0"
        aria-label="Seek within voice note" />
    </div>
    <time class="voice-player-time">${duration ? `00:00 / ${formatVoiceDuration(duration)}` : '00:00 / --:--'}</time>
    <button class="voice-player-speed" type="button" data-voice-speed aria-label="Playback speed 1 times">1×</button>
    ${pending}
  </div>`;
}

function updateVoicePlayer(player) {
  const audio = player.querySelector('.voice-player-audio');
  const durationMs = Number.isFinite(audio.duration)
    ? audio.duration * 1000
    : Number(player.dataset.duration) || 0;
  const currentMs = Number.isFinite(audio.currentTime) ? audio.currentTime * 1000 : 0;
  const progress = durationMs ? Math.min(1, currentMs / durationMs) : 0;
  const seek = player.querySelector('.voice-player-seek');
  seek.value = String(Math.round(progress * 1000));
  const time = player.querySelector('.voice-player-time');
  time.textContent = `${formatVoiceDuration(currentMs)} / ${durationMs ? formatVoiceDuration(durationMs) : '--:--'}`;
  const play = player.querySelector('[data-voice-play]');
  play.textContent = audio.paused ? '▶' : 'Ⅱ';
  play.setAttribute('aria-label', audio.paused ? 'Play voice note' : 'Pause voice note');
  const speed = player.querySelector('[data-voice-speed]');
  speed.textContent = `${audio.playbackRate}×`;
  speed.setAttribute('aria-label', `Playback speed ${audio.playbackRate} times`);
  for (const bar of player.querySelectorAll('[data-voice-bar]')) {
    const threshold = (Number(bar.dataset.voiceBar) + 1) / player.querySelectorAll('[data-voice-bar]').length;
    bar.classList.toggle('is-played', threshold <= progress);
  }
}

function bindVoicePlayers(list, resumePlayback = null) {
  for (const player of list.querySelectorAll('[data-voice-player]')) {
    const audio = player.querySelector('.voice-player-audio');
    const update = () => updateVoicePlayer(player);
    for (const eventName of ['loadedmetadata', 'timeupdate', 'play', 'pause', 'ended', 'ratechange']) {
      audio.addEventListener(eventName, update);
    }
    player.addEventListener('click', async (event) => {
      if (event.target.closest('[data-voice-play]')) {
        if (audio.paused) {
          for (const other of list.querySelectorAll('.voice-player-audio')) {
            if (other !== audio) other.pause();
          }
          try {
            await audio.play();
          } catch (error) {
            showToast(`Could not play voice note: ${friendlyError(error)}`);
          }
        } else {
          audio.pause();
        }
      } else if (event.target.closest('[data-voice-speed]')) {
        const speeds = [1, 1.5, 2];
        const nextSpeed = speeds[(speeds.indexOf(audio.playbackRate) + 1) % speeds.length];
        audio.playbackRate = nextSpeed;
      }
    });
    player.querySelector('.voice-player-seek').addEventListener('input', (event) => {
      if (Number.isFinite(audio.duration)) {
        audio.currentTime = (Number(event.currentTarget.value) / 1000) * audio.duration;
      }
    });
    update();
  }

  if (!resumePlayback) return;
  const player = [...list.querySelectorAll('[data-voice-player]')]
    .find((item) => item.closest('[data-message-id]')?.dataset.messageId === resumePlayback.messageId);
  const audio = player?.querySelector('.voice-player-audio');
  if (!audio) return;
  const resume = async () => {
    if (Number.isFinite(audio.duration)) {
      audio.currentTime = Math.min(resumePlayback.currentTime, audio.duration);
    }
    audio.playbackRate = resumePlayback.playbackRate;
    try {
      await audio.play();
    } catch (error) {
      showToast(`Could not resume voice note: ${friendlyError(error)}`);
    }
  };
  if (audio.readyState >= 1) void resume();
  else audio.addEventListener('loadedmetadata', () => { void resume(); }, { once: true });
}

function renderTenorGifResults() {
  const container = $('tenor-gif-results');
  if (!container) return;
  const { query, loading, error, results } = state.tenorSearch;
  if (loading) {
    container.innerHTML = '<p class="emoji-picker-status" role="status">Searching GIFs…</p>';
    return;
  }
  if (error) {
    container.innerHTML = `<p class="emoji-picker-status is-error" role="status">${esc(error)}</p>`;
    return;
  }
  if (query.trim().length < 2) {
    container.innerHTML = '<p class="emoji-picker-status" role="status">Enter at least 2 characters to search.</p>';
    return;
  }
  const safeResults = results.filter((gif) =>
    safeTenorGifUrl(gif.previewUrl) && safeTenorGifUrl(gif.gifUrl));
  container.innerHTML = safeResults.length
    ? `<div class="emoji-picker-grid gif-picker-grid" role="group" aria-label="GIF search results">
        ${safeResults.map((gif) => `<button type="button" class="gif-picker-item"
          data-insert-gif="${esc(gif.gifUrl)}" data-gif-title="${esc(gif.title)}"
          aria-label="Insert GIF: ${esc(gif.title)}">
          <img src="${esc(gif.previewUrl)}" alt="" loading="lazy" />
        </button>`).join('')}
      </div>`
    : '<p class="emoji-picker-status" role="status">No GIFs found.</p>';
}

function searchTenorGifOptions(query) {
  clearTimeout(state.tenorSearch.timer);
  const sequence = ++state.tenorSearch.sequence;
  state.tenorSearch.query = query;
  state.tenorSearch.results = [];
  state.tenorSearch.error = '';
  if (query.trim().length < 2) {
    state.tenorSearch.loading = false;
    renderTenorGifResults();
    return;
  }
  state.tenorSearch.loading = true;
  renderTenorGifResults();
  state.tenorSearch.timer = setTimeout(async () => {
    try {
      const results = await searchTenorGifs(query);
      if (sequence !== state.tenorSearch.sequence) return;
      state.tenorSearch.results = normalizeTenorResults({ results });
      state.tenorSearch.loading = false;
    } catch (error) {
      if (sequence !== state.tenorSearch.sequence) return;
      state.tenorSearch.error = `Could not search GIFs: ${friendlyError(error)}`;
      state.tenorSearch.loading = false;
    }
    renderTenorGifResults();
  }, 250);
}

function renderEmojiPicker(kind = 'emoji') {
  const picker = $('emoji-picker');
  if (!picker) return;
  if (!['emoji', 'stickers', 'gifs'].includes(kind)) kind = 'emoji';
  const recent = loadRecentEmojis().slice(0, RECENT_EMOJI_LIMIT);
  const emojiContent = `
    <div class="emoji-picker-recent" role="group" aria-label="Recently used emojis">
      <span>Recent</span>
      ${recent.length
        ? recent.map((emoji) => `<button type="button" class="emoji-picker-item"
            data-insert-emoji="${esc(emoji)}" aria-label="Use recent emoji ${esc(emoji)}">${emoji}</button>`).join('')
        : '<small>No recent emojis yet</small>'}
    </div>
    <div class="emoji-picker-grid" role="group" aria-label="Emoji">
      ${EMOJI_OPTIONS.map((emoji) => `<button type="button" class="emoji-picker-item"
        data-insert-emoji="${esc(emoji)}" aria-label="Insert emoji ${esc(emoji)}">${emoji}</button>`).join('')}
    </div>`;
  const stickerContent = `
    <div class="emoji-picker-grid sticker-picker-grid" role="group" aria-label="Stickers">
      ${STICKER_OPTIONS.map((sticker) => `<button type="button" class="emoji-picker-item is-sticker-option"
        data-insert-sticker="${esc(sticker.id)}" aria-label="Insert sticker ${esc(sticker.title)}"
        title="${esc(sticker.title)}"><img src="${esc(sticker.src)}" alt="" loading="lazy" /></button>`).join('')}
    </div>`;
  const gifContent = `
    <label class="gif-picker-search">Search Tenor GIFs
      <input id="tenor-gif-search" type="search" maxlength="80" autocomplete="off"
        value="${esc(state.tenorSearch.query)}" placeholder="Search Tenor" />
    </label>
    <div id="tenor-gif-results" aria-live="polite"></div>
    <p class="tenor-attribution"><a href="https://tenor.com" target="_blank"
      rel="noopener noreferrer nofollow">Powered By Tenor</a></p>`;
  const content = kind === 'emoji' ? emojiContent : kind === 'stickers' ? stickerContent : gifContent;
  picker.innerHTML = `
    <div class="emoji-picker-tabs" role="tablist" aria-label="Choose emoji, stickers, or GIFs">
      <button type="button" role="tab" data-emoji-picker-tab="emoji" aria-selected="${kind === 'emoji'}"
        aria-controls="emoji-picker-content">Emoji</button>
      <button type="button" role="tab" data-emoji-picker-tab="stickers" aria-selected="${kind === 'stickers'}"
        aria-controls="emoji-picker-content">Stickers</button>
      <button type="button" role="tab" data-emoji-picker-tab="gifs" aria-selected="${kind === 'gifs'}"
        aria-controls="emoji-picker-content">GIFs</button>
    </div>
    <div id="emoji-picker-content">${content}</div>`;
  picker.hidden = false;
  if (kind === 'gifs') renderTenorGifResults();
}

function insertComposerEmoji(emoji) {
  const composer = $('message-form [name="body"]');
  if (!composer) return;
  const start = composer.selectionStart;
  const end = composer.selectionEnd;
  composer.setRangeText(emoji, start, end, 'end');
  composer.focus();
  composer.dispatchEvent(new Event('input', { bubbles: true }));
}

function formatLastSeen(timestamp) {
  if (!timestamp || Number.isNaN(new Date(timestamp).getTime())) return 'Last seen unavailable';
  const date = new Date(timestamp);
  const elapsed = Date.now() - date.getTime();
  if (elapsed < 60_000) return 'Last seen just now';
  if (elapsed < 60 * 60_000) {
    const minutes = Math.max(1, Math.floor(elapsed / 60_000));
    return `Last seen ${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  }
  return `Last seen ${date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`;
}

function formatPreviewDate(timestamp) {
  if (!timestamp || Number.isNaN(new Date(timestamp).getTime())) return '';
  return new Date(timestamp).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function profilePreviewMarkup(preview, contextChatId) {
  const profile = preview.profile;
  const groups = preview.common_groups ?? [];
  const media = preview.shared_media ?? [];
  const links = (preview.shared_links ?? []).flatMap((item) => {
    const found = item.body?.match(/https?:\/\/[^\s<>"']+/g) ?? [];
    return found.map((url) => ({ ...item, url: url.replace(/[),.;!?]+$/, '') }));
  });
  const files = preview.shared_files ?? [];
  const tabs = [
    ['media', 'Media', media.length],
    ['links', 'Links', links.length],
    ['files', 'Files', files.length],
  ];
  const activeItems = state.profilePreviewTab === 'media' ? media
    : state.profilePreviewTab === 'links' ? links : files;

  return `
    <header class="profile-preview-identity">
      ${avatar(profile.display_name, profile.id, profile.avatar_path)}
      <div>
        <h2 id="profile-preview-name">${esc(profile.display_name)}</h2>
        <span>@${esc(profile.username)}</span>
        <small id="profile-preview-status">${esc(state.onlineUserIds.has(profile.id)
          ? 'Online now'
          : formatLastSeen(preview.last_seen_at))}</small>
      </div>
    </header>
    <p class="profile-preview-about">${esc(profile.bio || 'No about information added.')}</p>
    <div class="profile-preview-actions" aria-label="Profile actions">
      <button class="primary-button" type="button" data-preview-message
        ${preview.blocked ? 'disabled title="Unblock to send messages"' : ''}>Message</button>
      <button class="secondary-button" type="button" data-preview-mute aria-pressed="${Boolean(preview.muted)}">
        ${preview.muted ? 'Unmute' : 'Mute'}
      </button>
      <button class="secondary-button" type="button" disabled title="soon" aria-label="Call (soon)">Call</button>
    </div>
    <section class="profile-preview-groups" aria-labelledby="profile-preview-groups-title">
      <h3 id="profile-preview-groups-title">Common groups <span>${groups.length}</span></h3>
      ${groups.length
        ? `<ul>${groups.map((group) => `<li>${esc(group.name)}</li>`).join('')}</ul>`
        : '<p>No common groups.</p>'}
    </section>
    <div class="profile-preview-tabs" role="tablist" aria-label="Shared content">
      ${tabs.map(([key, title, count]) => `
        <button type="button" role="tab" id="profile-tab-${key}" aria-selected="${state.profilePreviewTab === key}"
          aria-controls="profile-preview-shared" data-preview-tab="${key}">${title}<span>${count}</span></button>`).join('')}
    </div>
    <section id="profile-preview-shared" class="profile-preview-shared" role="tabpanel"
      aria-labelledby="profile-tab-${state.profilePreviewTab}" tabindex="0">
      ${state.profilePreviewTab === 'media'
        ? activeItems.length
          ? `<div class="profile-media-grid">${activeItems.map((item, index) => `
            <button type="button" class="profile-media-item" data-lightbox-index="${index}"
              aria-label="Open ${item.media_type?.startsWith('video/') ? 'video' : 'image'} ${index + 1} of ${activeItems.length}">
              ${item.media_type?.startsWith('video/')
                ? `<video muted preload="none" src="${esc(item.media_url ?? '')}"></video><span aria-hidden="true">▶</span>`
                : `<img src="${esc(item.media_url ?? '')}" alt="${esc(item.file_name ?? 'Shared image')}" loading="lazy" />`}
            </button>`).join('')}</div>`
          : '<p class="profile-preview-empty">No shared photos or videos yet.</p>'
        : state.profilePreviewTab === 'links'
          ? activeItems.length
            ? `<ul class="profile-preview-list">${activeItems.map((item) => {
              let link = '';
              try {
                const url = new URL(item.url);
                if (['http:', 'https:'].includes(url.protocol)) link = url.href;
              } catch { /* Invalid links are omitted. */ }
              return link ? `<li><a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(item.url)}</a>
                <small>${esc(item.chat_name)} · ${esc(formatPreviewDate(item.created_at))}</small></li>` : '';
            }).join('')}</ul>`
            : '<p class="profile-preview-empty">No shared links yet.</p>'
          : activeItems.length
            ? `<ul class="profile-preview-list">${activeItems.map((item) => `
              <li><a href="${esc(item.media_url ?? '')}" target="_blank" rel="noopener noreferrer">
                <span aria-hidden="true">↧</span> ${esc(item.file_name ?? 'Shared file')}</a>
                <small>${esc(item.chat_name)} · ${esc(formatPreviewDate(item.created_at))}</small></li>`).join('')}</ul>`
            : '<p class="profile-preview-empty">No shared files yet.</p>'}
    </section>
    ${contextChatId && groups.some((group) => group.id === contextChatId) ? `
      <section class="profile-preview-safety" aria-label="Group safety actions">
        <button type="button" class="danger-action" data-preview-block>
          ${preview.blocked ? 'Unblock' : 'Block'} ${esc(profile.display_name)}
        </button>
        <button type="button" class="danger-action" data-preview-report>Report</button>
      </section>` : ''}
  `;
}

function renderProfilePreview() {
  const content = $('profile-preview-content');
  if (!content || !state.profilePreview) return;
  content.innerHTML = profilePreviewMarkup(state.profilePreview, state.profilePreviewContextChatId);
}

function closeProfileLightbox() {
  const viewer = $('profile-lightbox');
  $('profile-lightbox').hidden = true;
  viewer.querySelector('.lightbox-content').replaceChildren();
  if (state.profileLightboxOrigin?.isConnected) {
    state.profileLightboxOrigin.focus({ preventScroll: true });
  }
  state.profileLightboxOrigin = null;
  state.profileLightboxIndex = -1;
}

function renderProfileLightbox(index) {
  const media = state.profilePreview?.shared_media ?? [];
  if (!media.length) return;
  const viewer = $('profile-lightbox');
  if (viewer.hidden) {
    state.profileLightboxOrigin = document.activeElement;
    viewer.hidden = false;
    viewer.querySelector('.lightbox-close').focus({ preventScroll: true });
  }
  state.profileLightboxIndex = (index + media.length) % media.length;
  const item = media[state.profileLightboxIndex];
  const content = viewer.querySelector('.lightbox-content');
  const source = esc(item.media_url ?? '');
  content.innerHTML = item.media_type?.startsWith('video/')
    ? `<video controls autoplay src="${source}"></video>`
    : `<img src="${source}" alt="${esc(item.file_name ?? 'Shared image')}" />`;
  viewer.querySelector('.lightbox-count').textContent = `${state.profileLightboxIndex + 1} / ${media.length}`;
}

async function openProfilePreview(userId, contextChatId = null, origin = null) {
  if (!userId || userId === state.session?.user?.id) return;
  if ($('profile-preview').hidden) {
    const messageList = $('message-list');
    state.profilePreviewOrigin = origin ?? document.activeElement;
    state.profilePreviewScroll = {
      windowX: window.scrollX,
      windowY: window.scrollY,
      chatList: $('chat-list')?.scrollTop ?? 0,
      messages: messageList?.scrollTop ?? 0,
      bodyOverflow: document.body.style.overflow,
    };
  }
  const sequence = ++state.profilePreviewSequence;
  state.profilePreview = null;
  state.profilePreviewContextChatId = contextChatId;
  state.profilePreviewTab = 'media';
  closeProfileLightbox();
  const backdrop = $('profile-preview');
  backdrop.hidden = false;
  backdrop.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  $('profile-preview-content').innerHTML = '<p class="profile-preview-loading" role="status">Loading profile…</p>';
  $('profile-preview-close').focus({ preventScroll: true });

  try {
    const preview = await getProfilePreview(userId);
    if (sequence !== state.profilePreviewSequence || backdrop.hidden) return;
    const items = preview.shared_media ?? [];
    const fileItems = preview.shared_files ?? [];
    const allPaths = [...new Set([
      ...items.map((item) => item.media_path),
      ...fileItems.map((item) => item.media_path),
    ].filter(Boolean))];
    if (allPaths.length) {
      try {
        const signed = await signedMediaUrls('chat-media', allPaths);
        const urlByPath = new Map(signed.map((entry) => [
          entry.path,
          entry.signedUrl ?? entry.signedURL,
        ]));
        preview.shared_media = items.map((item) => ({
          ...item,
          media_url: urlByPath.get(item.media_path) ?? null,
        }));
        preview.shared_files = fileItems.map((item) => ({
          ...item,
          media_url: urlByPath.get(item.media_path) ?? null,
        }));
      } catch {
        preview.shared_media = items.map((item) => ({ ...item, media_url: null }));
        preview.shared_files = fileItems.map((item) => ({ ...item, media_url: null }));
      }
    }
    if (sequence !== state.profilePreviewSequence || backdrop.hidden) return;
    state.profilePreview = preview;
    renderProfilePreview();
  } catch (error) {
    if (sequence !== state.profilePreviewSequence || backdrop.hidden) return;
    $('profile-preview-content').innerHTML = `
      <p class="profile-preview-error" role="alert">Could not load this profile: ${esc(friendlyError(error))}</p>`;
  }
}

function closeProfilePreview(restoreFocus = true) {
  const backdrop = $('profile-preview');
  if (backdrop.hidden) return;
  state.profilePreviewSequence += 1;
  closeProfileLightbox();
  backdrop.hidden = true;
  backdrop.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = state.profilePreviewScroll?.bodyOverflow ?? '';
  const scroll = state.profilePreviewScroll;
  if (scroll) {
    window.scrollTo(scroll.windowX, scroll.windowY);
    const chatList = $('chat-list');
    const messages = $('message-list');
    if (chatList) chatList.scrollTop = scroll.chatList;
    if (messages) messages.scrollTop = scroll.messages;
  }
  if (restoreFocus && state.profilePreviewOrigin?.isConnected) {
    state.profilePreviewOrigin.focus({ preventScroll: true });
  }
  state.profilePreview = null;
  state.profilePreviewContextChatId = null;
  state.profilePreviewOrigin = null;
  state.profilePreviewScroll = null;
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

function renderPendingChatMedia() {
  const container = $('chat-media-queue');
  if (!container) return;
  const queue = state.pendingChatMedia.get(state.activeChatId) ?? [];
  container.hidden = !queue.length;
  container.innerHTML = queue.map((item) => {
    const preview = item.previewUrl
      ? item.file.type.startsWith('video/')
        ? `<video src="${esc(item.previewUrl)}" muted playsinline preload="metadata" aria-label="Preview ${esc(item.file.name)}"></video>`
        : `<img src="${esc(item.previewUrl)}" alt="Preview ${esc(item.file.name)}" />`
      : `<span class="chat-media-file-icon" aria-hidden="true">${item.file.type === 'application/pdf' ? 'PDF' : item.file.type.startsWith('audio/') ? '♪' : 'FILE'}</span>`;
    const status = item.status === 'uploading'
      ? item.progress === null ? 'Uploading…' : `Uploading ${item.progress}%`
      : item.status === 'failed' ? item.error : 'Ready to send';
    const progress = item.status === 'uploading'
      ? `<progress max="100" ${item.progress === null ? '' : `value="${item.progress}"`}
          aria-label="Uploading ${esc(item.file.name)}${item.progress === null ? '' : ` ${item.progress}%`}"></progress>`
      : '';
    const retry = item.status === 'failed'
      ? `<button type="button" data-retry-chat-media="${esc(item.id)}">Retry</button>`
      : '';
    return `<article class="chat-media-queue-item" data-chat-media-item="${esc(item.id)}">
      ${preview}
      <div class="chat-media-queue-details">
        <strong title="${esc(item.file.name)}">${esc(item.file.name)}</strong>
        <span>${esc(formatUploadSize(item.file.size))}</span>
        ${progress}
        <small class="${item.status === 'failed' ? 'is-error' : ''}" ${item.status === 'failed' ? 'role="status"' : ''}>${esc(status)}</small>
      </div>
      ${retry}
      <button type="button" data-remove-chat-media="${esc(item.id)}"
        aria-label="Remove ${esc(item.file.name)}" ${item.status === 'uploading' ? 'disabled' : ''}>×</button>
    </article>`;
  }).join('');
  const sending = queue.some((item) => item.status === 'uploading');
  const sendButton = $('message-form')?.querySelector('button[type="submit"]');
  if (sendButton) {
    sendButton.disabled = sending;
    sendButton.textContent = queue.length ? `Send ${queue.length} file${queue.length === 1 ? '' : 's'}` : 'Send';
  }
  const attachButton = $('attach-media');
  if (attachButton) attachButton.disabled = sending;
}

function formatUploadSize(size) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function queueChatMediaFiles(files) {
  if (!$('message-form') || !state.activeChatId) return;
  const chatId = state.activeChatId;
  const queue = state.pendingChatMedia.get(chatId) ?? [];
  let added = 0;
  for (const file of files) {
    try {
      validateUpload(file);
      queue.push({
        id: crypto.randomUUID(),
        file,
        previewUrl: file.type.startsWith('image/') || file.type.startsWith('video/')
          ? URL.createObjectURL(file)
          : null,
        status: 'queued',
        progress: null,
        error: '',
        abortController: null,
        caption: undefined,
        replyToId: undefined,
      });
      added += 1;
    } catch (error) {
      showToast(`Could not add ${file.name || 'file'}: ${friendlyError(error)}`);
    }
  }
  if (added) {
    state.pendingChatMedia.set(chatId, queue);
    renderPendingChatMedia();
    showToast(`${added} file${added === 1 ? '' : 's'} added. Review and send when ready.`);
  }
}

function removeQueuedChatMedia(chatId, itemId) {
  const queue = state.pendingChatMedia.get(chatId);
  const index = queue?.findIndex((item) => item.id === itemId) ?? -1;
  if (index < 0 || queue[index].status === 'uploading') return;
  const [item] = queue.splice(index, 1);
  if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  if (!queue.length) state.pendingChatMedia.delete(chatId);
  if (state.activeChatId === chatId) renderPendingChatMedia();
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

async function sendChatMedia(
  file,
  voiceNote = false,
  caption = '',
  chat = state.activeChat,
  voiceMetadata = null,
  uploadOptions = {},
) {
  if (!chat) return;
  validateUpload(file);
  const senderId = state.session?.user?.id;
  if (!senderId) throw new Error('Sign in before uploading media.');
  const replyToId = Object.hasOwn(uploadOptions, 'replyToId')
    ? uploadOptions.replyToId
    : state.replyingTo?.id ?? null;
  const media = {
    type: file.type,
    name: voiceNote ? 'Voice note' : file.name,
    voiceNote,
    voiceDurationMs: voiceMetadata?.durationMs ?? null,
    voiceWaveform: voiceMetadata?.waveform ?? null,
  };
  const path = `${chat.chat_id}/${senderId}/${crypto.randomUUID()}.${mediaExtension(file.type)}`;
  let messageSent = false;
  try {
    media.path = await uploadMedia('chat-media', path, file, file.type, {
      onProgress: uploadOptions.onProgress,
      signal: uploadOptions.signal,
    });
    if (uploadOptions.signal?.aborted) {
      const error = new Error('Media upload was canceled.');
      error.name = 'AbortError';
      throw error;
    }
    await sendMessage(chat.chat_id, senderId, caption, media, replyToId);
    messageSent = true;
    if (state.activeChatId === chat.chat_id && (state.replyingTo?.id ?? null) === replyToId) {
      state.replyingTo = null;
      updateReplyStrip();
    }
    if (state.activeChatId === chat.chat_id) {
      try {
        state.messages = await hydrateMessages(await listMessages(chat.chat_id));
        renderMessages();
      } catch (error) {
        showToast(`Attachment sent, but the conversation could not refresh: ${friendlyError(error)}`);
      }
    }
    try {
      await refreshChats();
    } catch (error) {
      showToast(`Attachment sent, but the chat list could not refresh: ${friendlyError(error)}`);
    }
  } catch (error) {
    if (media.path && !messageSent) {
      try {
        await removeMedia('chat-media', media.path);
      } catch (cleanupError) {
        console.error('Could not clean up an incomplete media upload.', cleanupError);
      }
    }
    throw error;
  }
}

async function sendQueuedChatMedia(chat, itemIds, body, rawBody, replyToId) {
  const chatId = chat.chat_id;
  const queue = state.pendingChatMedia.get(chatId) ?? [];
  const items = queue.filter((item) => itemIds.includes(item.id) && item.status !== 'uploading');
  if (!items.length) return;
  const initialRawBody = rawBody;
  let pendingCaption = body;
  let sent = 0;
  const input = state.activeChatId === chatId ? $('message-form [name="body"]') : null;

  for (const item of items) {
    if (!queue.includes(item)) continue;
    const captionForItem = item.status === 'failed' && body
      ? body
      : item.caption ?? pendingCaption;
    const replyToIdForItem = replyToId ?? item.replyToId ?? null;
    item.caption = captionForItem;
    item.replyToId = replyToIdForItem;
    item.status = 'uploading';
    item.progress = null;
    item.error = '';
    item.abortController = new AbortController();
    if (state.activeChatId === chatId) renderPendingChatMedia();
    try {
      await sendChatMedia(item.file, false, captionForItem, chat, null, {
        onProgress: (ratio) => {
          const progress = Math.round(ratio * 100);
          if (item.progress === progress) return;
          item.progress = progress;
          if (state.activeChatId === chatId) renderPendingChatMedia();
        },
        signal: item.abortController.signal,
        replyToId: replyToIdForItem,
      });
    } catch (error) {
      if (!queue.includes(item)) break;
      item.status = error.name === 'AbortError' ? 'queued' : 'failed';
      item.progress = null;
      item.error = error.name === 'AbortError' ? '' : friendlyError(error);
      item.abortController = null;
      if (state.activeChatId === chatId) renderPendingChatMedia();
      if (error.name !== 'AbortError' && state.session) {
        showToast(`Could not send ${item.file.name}: ${friendlyError(error)}. Retry is available.`);
      }
      break;
    }

    if (!queue.includes(item)) break;
    item.abortController = null;
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    queue.splice(queue.indexOf(item), 1);
    if (!queue.length) state.pendingChatMedia.delete(chatId);
    sent += 1;
    pendingCaption = '';
    if (state.activeChatId === chatId) {
      if (input?.value === initialRawBody) {
        input.value = '';
        state.pickerMediaDraft = null;
        renderPickerMediaDraft();
      }
      renderPendingChatMedia();
    }
  }

  if (sent && state.session) {
    showToast(`Sent ${sent} file${sent === 1 ? '' : 's'}.`);
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
          <span id="chat-presence" class="chat-presence"></span>
          <span id="chat-typing" class="chat-typing" hidden></span>
        </div>
        <button class="icon-button message-search-chat" type="button" data-open-message-search="chat"
          aria-label="Search this conversation" title="Search this conversation">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
        </button>
        <button id="group-info" class="icon-button group-info-button" type="button" aria-label="Conversation details" title="Conversation details">⋯</button>
      </header>
      <div id="pinned-message-banner"></div>
      <div class="conversation-body" id="message-list" aria-live="polite"></div>
      <form id="message-form" class="conversation-footer">
        ${type !== 'channel' || ['owner', 'admin'].includes(chat.my_role) ? `
          <div class="reply-strip" id="reply-strip" hidden>
            <span data-reply-copy></span>
            <button type="button" class="reply-cancel" data-cancel-reply aria-label="Cancel reply">×</button>
          </div>
          <div id="chat-media-drop-hint" class="chat-media-drop-hint" hidden>Drop files to attach</div>
          <div id="chat-media-queue" class="chat-media-queue" hidden aria-label="Files ready to send"></div>
          <div id="picker-media-draft" class="picker-media-draft" hidden></div>
          <button class="composer-tool" type="button" id="emoji-picker-toggle" aria-label="Open emoji, sticker, and GIF picker" title="Emoji, stickers, and GIFs" aria-expanded="false">☺ Emoji</button>
          <div id="emoji-picker" class="emoji-picker" hidden role="dialog" aria-label="Emoji and stickers"></div>
          <button class="composer-tool" type="button" id="attach-media" aria-label="Attach media" title="Attach media">＋</button>
          <button class="composer-tool voice-note-control" type="button" id="voice-note"
            aria-label="Hold to record a voice note" title="Hold to record · release to send · slide left to cancel">🎙</button>
          <div class="recording-controls" id="recording-controls" hidden>
            <span id="recording-status" class="recording-status" role="status" aria-live="polite"></span>
            <div class="voice-recording-waveform" id="voice-recording-waveform" aria-hidden="true"></div>
            <span class="voice-recording-hint">Release to send · slide left to cancel</span>
            <button type="button" class="voice-note-discard" id="voice-note-discard-recording">Cancel</button>
          </div>
          <textarea name="body" aria-label="Message" placeholder="${type === 'group' ? 'Message or type /help for group commands…' : type === 'channel' ? 'Write a channel post…' : 'Write a message…'}" maxlength="4000" rows="1"></textarea>
          <div id="mention-suggestions" class="mention-suggestions" hidden role="listbox" aria-label="People to mention"></div>
          <button type="submit">Send</button>
        ` : '<div class="channel-readonly-note">Only channel admins can publish. Subscribe to receive channel updates.</div>'}
      </form>
    </div>`;
  renderPickerMediaDraft();
  renderPendingChatMedia();
  updateReplyStrip();
  renderMessages();
  renderPinnedMessages();
  renderPresenceIndicator();
  renderTypingIndicator();
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
  const [rows, settings] = await Promise.all([listChats(), listMyChatSettings(userId)]);
  if (state.session?.user?.id !== userId) return;
  const mutedChatIds = new Set(settings.filter((setting) => setting.muted).map((setting) => setting.chat_id));
  state.chats = rows.map((row) => ({
    ...row,
    chat_type: row.chat_type ?? (row.is_group ? 'group' : 'direct'),
    participants: Array.isArray(row.participants) ? row.participants : [],
    muted: mutedChatIds.has(row.chat_id),
  }));
  renderUnreadTotal();
  renderChats();
  if (state.activeChatId) {
    const updatedChat = state.chats.find((chat) => chat.chat_id === state.activeChatId);
    if (updatedChat) {
      const readCursorChanged = updatedChat.last_read_at !== state.activeChat?.last_read_at;
      state.activeChat = updatedChat;
      if (readCursorChanged && state.messages.length) renderMessages();
    }
  }
}

function renderMentionNotifications() {
  const button = $('mention-notifications-toggle');
  const badge = $('mention-notification-count');
  const list = $('mention-notification-list');
  if (!button || !badge || !list) return;
  const enabled = state.profile?.mention_notifications_enabled !== false;
  const count = enabled ? state.mentions.length : 0;
  badge.hidden = count === 0;
  badge.textContent = count > 50 ? '50+' : String(count);
  button.setAttribute('aria-label', !enabled
    ? 'Notifications, mention alerts are off'
    : count ? `Notifications, ${count} unread mentions` : 'Notifications, no unread mentions');
  const mentions = state.mentions.map((mention) => `<button type="button" class="mention-notification"
        data-mention-chat="${esc(mention.chat_id)}" data-mention-message="${esc(mention.message_id)}">
      <span class="mention-notification-top"><strong>${esc(mention.sender_name)}</strong><span>mentioned you in ${esc(mention.chat_name)}</span></span>
      <span class="mention-notification-body">${esc(mention.body)}</span>
      <time datetime="${esc(mention.created_at)}">${esc(new Date(mention.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }))}</time>
    </button>`).join('');
  list.innerHTML = state.mentions.length
    ? `${enabled ? '' : `<p class="mention-notifications-empty">Mention alerts are off. ${state.mentions.length} unread mention${state.mentions.length === 1 ? ' is' : 's are'} still saved.</p>`}${mentions}`
    : enabled
      ? '<p class="mention-notifications-empty">No unread mentions.</p>'
      : '<p class="mention-notifications-empty">Mention alerts are off. New mentions will still be saved here.</p>';
}

async function refreshMentions(announce = false) {
  const userId = state.session?.user?.id;
  if (!userId) return;
  const rows = await listMyMentions();
  if (state.session?.user?.id !== userId) return;
  const previousIds = state.mentionIds;
  state.mentions = rows;
  state.mentionIds = new Set(rows.map((mention) => mention.message_id));
  if (announce && state.mentionsLoaded && state.profile?.mention_notifications_enabled !== false) {
    const newest = rows.find((mention) => !previousIds.has(mention.message_id));
    if (newest) showToast(`${newest.sender_name} mentioned you in ${newest.chat_name}.`);
  }
  state.mentionsLoaded = true;
  renderMentionNotifications();
}

async function openChat(chatId, chatOverride = null) {
  const chat = chatOverride ?? [...state.chats, ...state.channels, ...state.discoveredChannels]
    .find((item) => item.chat_id === chatId);
  if (!chat) return;
  stopChatLive();
  state.activeChatId = chatId;
  state.activeChat = chat;
  state.replyingTo = null;
  state.pickerMediaDraft = null;
  clearTimeout(state.tenorSearch.timer);
  state.tenorSearch = {
    sequence: state.tenorSearch.sequence + 1,
    timer: null,
    query: '',
    results: [],
    loading: false,
    error: '',
  };
  state.hoveredMessageId = null;
  state.messages = [];
  state.pendingMessages = [];
  state.reactions = new Map();
  state.loadingMessages = true;
  renderChats();
  renderConversation();

  try {
    try {
      await cleanupExpiredMessageMedia();
    } catch (error) {
      showToast(`Could not clean up expired attachments: ${friendlyError(error)}`);
    }
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
    state.unsubscribeReactions = subscribeToReactions(chatId, () => {
      if (state.activeChatId === chatId) void refreshReactions(chatId);
    });
    state.unsubscribePins = subscribeToChatPins(chatId, () => {
      void refreshChatPins(chatId).catch((error) => showToast(`Could not refresh pinned messages: ${friendlyError(error)}`));
    });
    state.unsubscribeReadReceipts = subscribeToReadReceipts(
      chatId,
      () => { void refreshChatReadReceipts(chatId); },
      (status) => {
        if (state.activeChatId === chatId
          && ['CHANNEL_ERROR', 'TIMED_OUT'].includes(status)) {
          showToast('Read receipts are reconnecting.');
        }
      },
    );
    state.chatLive = subscribeToChatLive(chatId, state.session.user.id, {
      onTyping: (payload) => handleTypingEvent(chatId, payload),
      onPresence: (presence) => {
        if (state.activeChatId !== chatId) return;
        state.onlineUserIds = new Set(Object.keys(presence));
        renderPresenceIndicator();
        const previewStatus = $('profile-preview-status');
        if (previewStatus && state.profilePreview?.profile?.id) {
          previewStatus.textContent = state.onlineUserIds.has(state.profilePreview.profile.id)
            ? 'Online now'
            : formatLastSeen(state.profilePreview.last_seen_at);
        }
      },
      onStatus: (status) => {
        if (state.activeChatId !== chatId) return;
        if (['CHANNEL_ERROR', 'TIMED_OUT'].includes(status)) {
          void updateLastSeen();
          showToast('Chat presence is reconnecting.');
        } else if (status === 'SUBSCRIBED') {
          void updateLastSeen();
          renderPresenceIndicator();
        }
      },
      onError: (error) => {
        if (state.activeChatId === chatId) {
          showToast(`Chat presence failed: ${friendlyError(error)}`);
        }
      },
    });
    const peer = chat.participants?.find((person) => person.id !== state.session.user.id);
    if (chat.chat_type === 'direct' && peer) {
      void getProfile(peer.id).then((profile) => {
        if (state.activeChatId !== chatId) return;
        state.directPeerProfile = profile;
        renderPresenceIndicator();
      }).catch((error) => {
        if (state.activeChatId === chatId) {
          showToast(`Could not load chat presence details: ${friendlyError(error)}`);
        }
      });
    }
    const messages = await hydrateMessages(await listMessages(chatId));
    if (state.activeChatId !== chatId) return;
    state.messages = messages;
    const byId = new Map(state.messages.map((message) => [message.id, message]));
    for (const message of state.pendingMessages) byId.set(message.id, message);
    for (const pending of state.pendingVoiceUploads.values()) {
      if (pending.chat.chat_id === chatId) byId.set(pending.optimistic.id, pending.optimistic);
    }
    state.messages = [...byId.values()].sort(compareMessageOrder);
    state.pendingMessages = [];
    state.loadingMessages = false;
    try {
      await refreshChatReadReceipts(chatId);
    } catch (error) {
      showToast(`Could not load read receipts: ${friendlyError(error)}`);
    }
    if (!(chatOverride?.chat_type === 'channel'
      && !chatOverride.my_role
      && !chatOverride.participants?.some((person) => person.id === state.session.user.id))) {
      await refreshReactions(chatId);
    }
    try {
      await refreshChatPins(chatId);
    } catch (error) {
      showToast(`Could not load pinned messages: ${friendlyError(error)}`);
    }
    renderMessages();
    await refreshChats();
  } catch (error) {
    state.loadingMessages = false;
    renderMessages();
    showToast(friendlyError(error));
  }
}

async function refreshChatReadReceipts(chatId) {
  const receipts = await listChatReadReceipts(chatId);
  if (state.activeChatId !== chatId) return;
  state.readReceipts = receipts;
  renderMessages();
}

function mayManagePins(chat = state.activeChat) {
  const type = chatType(chat);
  return type === 'direct' || (['group', 'channel'].includes(type)
    && ['owner', 'admin'].includes(chat?.my_role));
}

function renderPinnedMessages() {
  const banner = $('pinned-message-banner');
  if (!banner) return;
  const pins = state.pinnedMessages;
  if (!pins.length) {
    banner.innerHTML = '';
    return;
  }
  const latest = pins[0];
  const message = latest.message;
  const preview = message?.deleted_at
    ? 'Message deleted'
    : message?.body || (message?.media_path ? 'Attachment' : 'Message');
  banner.innerHTML = `<button class="pinned-message-banner" type="button" data-open-pinned-messages
      aria-label="View ${pins.length} pinned ${pins.length === 1 ? 'message' : 'messages'}">
    <span class="pinned-message-icon" aria-hidden="true">⌖</span>
    <span class="pinned-message-copy"><strong>${esc(message?.sender?.display_name ?? 'Pinned message')}</strong><span>${esc(preview)}</span></span>
    <span class="pinned-message-count">${pins.length}</span>
  </button>`;
}

function renderPinnedMessageDialog() {
  const list = $('pinned-message-list');
  const removeAllowed = mayManagePins();
  if (!list) return;
  if (!state.pinnedMessages.length) {
    list.innerHTML = '<p class="pinned-message-empty">No pinned messages in this conversation.</p>';
    return;
  }
  list.innerHTML = state.pinnedMessages.map((pin) => {
    const message = pin.message;
    const preview = message?.deleted_at
      ? 'Message deleted'
      : message?.body || (message?.media_path ? 'Attachment' : 'Message');
    return `<article class="pinned-message-row">
      <button type="button" class="pinned-message-jump" data-pinned-message="${esc(pin.message_id)}">
        <strong>${esc(message?.sender?.display_name ?? 'Member')}</strong>
        <span>${esc(preview)}</span>
        <time datetime="${esc(pin.pinned_at)}">${esc(new Date(pin.pinned_at).toLocaleString())}</time>
      </button>
      ${removeAllowed ? `<button type="button" class="pinned-message-remove" data-unpin-message="${esc(pin.message_id)}"
        aria-label="Unpin message">×</button>` : ''}
    </article>`;
  }).join('');
}

async function refreshChatPins(chatId) {
  const pins = await listChatPins(chatId);
  if (state.activeChatId !== chatId) return;
  state.pinnedMessages = pins;
  renderPinnedMessages();
  if (!$('pinned-messages-dialog').hidden) renderPinnedMessageDialog();
}

async function markChatReadIfAtBottom() {
  const chatId = state.activeChatId;
  const list = $('message-list');
  const latest = state.messages.at(-1);
  if (
    !state.readAckArmed
    || !latest
    || !list
    || !conversationIsVisible()
    || !isScrolledToBottom(list)
    || state.lastReadAckMessageId === latest.id
    || state.readAckInFlightChatId === chatId
  ) return;
  state.readAckInFlightChatId = chatId;
  try {
    const receipt = await markChatRead(chatId);
    if (state.activeChatId !== chatId) return;
    state.lastReadAckMessageId = receipt.last_read_sort_id;
    state.readReceipts = [
      ...state.readReceipts.filter((item) => item.user_id !== state.session.user.id),
      receipt,
    ];
    renderMessages();
    await refreshChats();
    try {
      await refreshMentions();
    } catch (error) {
      showToast(`Could not refresh mention notifications: ${friendlyError(error)}`);
    }
  } catch (error) {
    showToast(`Could not mark this chat as read: ${friendlyError(error)}`);
  } finally {
    if (state.readAckInFlightChatId === chatId) state.readAckInFlightChatId = null;
  }
}

function armReadAtBottom(list) {
  state.scrollIntentUntil = Date.now() + 2000;
  if (!isScrolledToBottom(list) || !conversationIsVisible()) return;
  state.readAckArmed = true;
  void markChatReadIfAtBottom();
}

function handleTypingEvent(chatId, payload) {
  if (state.activeChatId !== chatId || !payload?.user_id
    || payload.user_id === state.session?.user?.id) return;
  const knownMember = state.activeChat?.participants
    ?.some((person) => person.id === payload.user_id);
  if (!knownMember) return;
  clearTimeout(state.typingTimers.get(payload.user_id));
  state.typingByUser.set(payload.user_id, Date.now());
  state.typingTimers.set(payload.user_id, setTimeout(() => {
    state.typingByUser.delete(payload.user_id);
    state.typingTimers.delete(payload.user_id);
    renderTypingIndicator();
  }, 4000));
  renderTypingIndicator();
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
    if (message.eventType === 'DELETE'
      && message.expires_at
      && Date.parse(message.expires_at) <= Date.now()) {
      try {
        await cleanupExpiredMessageMedia();
      } catch (error) {
        showToast(`Could not clean up expired attachments: ${friendlyError(error)}`);
      }
    }
    try {
      state.messages = await hydrateMessages(await listMessages(message.chat_id));
      await refreshReactions(message.chat_id);
      renderMessages();
      if (message.eventType === 'DELETE') await refreshChats();
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
    await refreshChats();
  } catch (error) {
    showToast(`New message arrived, but could not refresh it: ${friendlyError(error)}`);
  }
}

async function initialiseWorkspace(session) {
  if (!session) {
    stopChatLive();
    state.unsubscribeMemberships?.();
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
    await updateLastSeen();
    if (state.session?.user?.id !== userId) return;
    clearInterval(state.presenceInterval);
    state.presenceInterval = setInterval(() => {
      if (state.session?.user?.id === userId && document.visibilityState === 'visible') {
        void updateLastSeen();
      }
    }, 60_000);
    const profile = await getProfile(userId);
    if (state.session?.user?.id !== userId) return;
    const mentionNotificationsEnabled = await getMyMentionNotificationsEnabled();
    if (state.session?.user?.id !== userId) return;
    state.profile = {
      ...profile,
      mention_notifications_enabled: mentionNotificationsEnabled,
    };
    $('profile-label').textContent = `@${state.profile.username}`;
    await refreshChats();
    if (state.session?.user?.id !== userId) return;
    state.unsubscribeMentions?.();
    state.unsubscribeMentions = subscribeToMentions(
      userId,
      () => {
        void refreshMentions(true).catch((error) => {
          showToast(`Could not refresh mention notifications: ${friendlyError(error)}`);
        });
      },
      (status) => {
        if (state.session?.user?.id === userId
          && ['CHANNEL_ERROR', 'TIMED_OUT'].includes(status)) {
          showToast('Mention notifications are reconnecting.');
        }
      },
    );
    try {
      await refreshMentions();
    } catch (error) {
      showToast(`Could not load mention notifications: ${friendlyError(error)}`);
    }
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
  if (!chat) return;
  const isChannel = chat.chat_type === 'channel';
  const isDirect = chat.chat_type === 'direct';
  const isGroup = chat.chat_type === 'group';
  const isAdmin = ['admin', 'owner'].includes(chat.my_role);
  const isOwner = chat.my_role === 'owner';
  const canChangeDisappearingTimer = isDirect || (isGroup && isAdmin);
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
  let disappearingTimer = null;
  if (isDirect || isGroup) {
    try {
      disappearingTimer = await getChatDisappearingTimer(chat.chat_id);
    } catch (error) {
      showToast(`Could not load disappearing-message settings: ${friendlyError(error)}`);
      return;
    }
  }
  let statuses = [];
  if (isGroup) {
    try {
      statuses = await listGroupStatuses(chat.chat_id);
    } catch (error) {
      showToast(`Could not load group status: ${friendlyError(error)}`);
    }
  }
  if (state.activeChatId !== chat.chat_id) return;
  $('group-details-title').textContent = `${chat.chat_name} details`;
  $('group-details-content').innerHTML = `
    <div class="chat-details-identity">
      ${isGroup ? chatAvatar(chat.chat_name, chat.chat_id, chat.chat_avatar_path) : avatar(chat.chat_name, chat.chat_id, chat.chat_avatar_path)}
      <div><strong>${esc(chat.chat_name)}</strong><small>${isChannel ? `${subscribers} subscribers` : isGroup ? `${members.length} members` : 'Private conversation'}</small></div>
    </div>
    <p class="group-summary">${isChannel
      ? `${chat.channel_public ? 'Public' : 'Private'} channel · ${esc(chat.my_role ?? 'subscriber')}`
      : isDirect
        ? 'Messages are private to the two participants.'
        : `${esc(chat.my_role ?? 'member')}${chat.group_locked ? ' · Posting locked' : ''}${chat.announcement_mode ? ' · Admin announcements' : ''}`}</p>
    ${inviteUrl ? `<div class="group-invite">
      <strong>${isChannel ? 'Channel invite' : 'Invite link'}</strong><code>${esc(inviteUrl)}</code>
      <button class="secondary-button" id="share-group-invite" type="button">Share link</button>
    </div>` : ''}
    ${(isDirect || isGroup) ? `<form id="disappearing-settings-form" class="feature-form">
      <h3>Disappearing messages</h3>
      <label>Delete new messages after
        <select name="timer_seconds" ${canChangeDisappearingTimer ? '' : 'disabled'}>
          <option value="0" ${disappearingTimer === 0 ? 'selected' : ''}>Off</option>
          <option value="86400" ${disappearingTimer === 86400 ? 'selected' : ''}>24 hours</option>
          <option value="604800" ${disappearingTimer === 604800 ? 'selected' : ''}>7 days</option>
          <option value="7776000" ${disappearingTimer === 7776000 ? 'selected' : ''}>90 days</option>
        </select>
      </label>
      <p class="command-hint">The timer starts when each message is sent. Changing it affects new messages only; existing messages keep their current setting.</p>
      ${canChangeDisappearingTimer ? '<button class="secondary-button" type="submit">Save timer</button>' : '<p class="command-hint">Only group admins can change this setting.</p>'}
    </form>` : ''}
    ${isGroup ? `<div class="group-members"><h3>Members</h3>${members.map((member) => `
      <button class="group-member profile-preview-trigger" type="button"
        data-profile-preview-id="${esc(member.id)}" data-profile-preview-context="${esc(chat.chat_id)}">
        ${avatar(member.display_name, member.id, member.avatar_path)}
        <span><strong>${esc(member.display_name)}</strong><small>@${esc(member.username)}</small></span>
        <small class="member-role">${esc(member.role ?? 'member')}</small>
      </button>`).join('')}</div>` : ''}
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
    ${isGroup ? `<div class="group-statuses"><strong>Recent group status</strong>
      ${statuses.length ? statuses.map((status) => `<p><span>${esc(status.body)}</span><small>${esc(status.author_name)} · ${esc(formatMessageTime(status.created_at))}</small></p>`).join('') : '<p class="selection-hint">No active group status.</p>'}
    </div>
    ${isAdmin ? `<form id="group-command-form" class="feature-form group-command-form">
      <label>Admin command
        <input name="command" maxlength="1000" placeholder="/help, /lock, /status ..." required />
      </label>
      <button class="secondary-button" type="submit">Run command</button>
      <p class="command-hint">Use commands for invites, member management, and moderation.</p>
    </form>` : '<p class="command-hint">Members can type /help or /rules in the message box.</p>'}` : ''}
    ${!isDirect ? !isOwner ? `<button class="danger-button" id="leave-chat" type="button">Leave ${isChannel ? 'channel' : 'group'}</button>` : '<p class="command-hint">Owners must transfer ownership before leaving.</p>' : ''}
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
  const isPinned = state.pinnedMessages.some((pin) => pin.message_id === messageId);
  const mayPin = mayManagePins();
  const menu = $('message-context');
  menu.innerHTML = `
    <div class="context-reactions" aria-label="React to message">
      ${['👍', '❤️', '😂', '😮', '😢', '🙏'].map((emoji) => `<button type="button" data-context-reaction="${emoji}" aria-label="React ${emoji}">${emoji}</button>`).join('')}
    </div>
    <button type="button" data-message-action="reply">Reply</button>
    ${mayEdit ? '<button type="button" data-message-action="edit">Edit message</button>' : ''}
    <button type="button" data-message-action="forward">Forward message</button>
    ${mayPin ? `<button type="button" data-message-action="pin">${isPinned ? 'Unpin message' : 'Pin message'}</button>` : ''}
    ${mayDelete ? '<button type="button" class="danger-action" data-message-action="delete">Delete message</button>' : ''}`;
  menu.hidden = false;
  const width = Math.min(260, window.innerWidth - 24);
  menu.style.left = `${Math.max(12, Math.min(clientX, window.innerWidth - width - 12))}px`;
  menu.style.top = `${Math.max(12, Math.min(clientY, window.innerHeight - menu.offsetHeight - 12))}px`;
}

function positionReactionDetails(trigger) {
  const panel = $('reaction-details');
  const rect = trigger.getBoundingClientRect();
  const width = Math.min(300, window.innerWidth - 24);
  const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
  const below = rect.bottom + panel.offsetHeight + 8 <= window.innerHeight;
  panel.style.left = `${left}px`;
  panel.style.top = `${below ? rect.bottom + 8 : Math.max(12, rect.top - panel.offsetHeight - 8)}px`;
}

async function openReactionDetails(messageId, emoji, trigger) {
  const panel = $('reaction-details');
  const sequence = ++state.reactionDetailsSequence;
  const chatId = state.activeChatId;
  const rows = (state.reactions.get(messageId) ?? []).filter((row) => row.reaction === emoji);
  panel.innerHTML = `<button type="button" class="reaction-details-close" aria-label="Close reactions">×</button>
    <h3>${esc(emoji)} · ${rows.length} ${rows.length === 1 ? 'reaction' : 'reactions'}</h3>
    <p class="reaction-details-loading" role="status">Loading people…</p>`;
  panel.hidden = false;
  positionReactionDetails(trigger);
  if (!rows.length) return;

  try {
    const profiles = await Promise.all([...new Set(rows.map((row) => row.user_id))].map(async (userId) => {
      if (userId === state.session.user.id) return state.profile;
      const preview = await getProfilePreview(userId);
      return preview.profile;
    }));
    if (sequence !== state.reactionDetailsSequence || state.activeChatId !== chatId || panel.hidden) return;
    const byId = new Map(profiles.map((profile) => [profile.id, profile]));
    const context = state.activeChat?.chat_type === 'group'
      ? `data-profile-preview-context="${esc(chatId)}"` : '';
    panel.innerHTML = `<button type="button" class="reaction-details-close" aria-label="Close reactions">×</button>
      <h3>${esc(emoji)} · ${rows.length} ${rows.length === 1 ? 'reaction' : 'reactions'}</h3>
      <ul>${[...new Set(rows.map((row) => row.user_id))].map((userId) => {
        const profile = byId.get(userId);
        if (!profile) return '';
        const name = profile.display_name ?? profile.username ?? 'Member';
        return `<li>${userId === state.session.user.id
          ? `${avatar(name, userId, profile.avatar_path)}<span>${esc(name)} <small>You</small></span>`
          : `<button type="button" class="reaction-person profile-preview-trigger"
            data-profile-preview-id="${esc(userId)}" ${context}>
            ${avatar(name, userId, profile.avatar_path)}<span>${esc(name)}</span></button>`}</li>`;
      }).join('')}</ul>`;
    positionReactionDetails(trigger);
  } catch (error) {
    if (sequence !== state.reactionDetailsSequence || panel.hidden) return;
    panel.innerHTML = `<button type="button" class="reaction-details-close" aria-label="Close reactions">×</button>
      <h3>${esc(emoji)} reactions</h3>
      <p class="reaction-details-error" role="alert">Could not load people: ${esc(friendlyError(error))}</p>`;
    positionReactionDetails(trigger);
  }
}

function closeReactionDetails() {
  state.reactionDetailsSequence += 1;
  $('reaction-details').hidden = true;
}

async function applyMessageReaction(messageId, emoji, button) {
  if (!state.activeChatId || !state.messages.some((message) => message.id === messageId)) return;
  if (button) button.disabled = true;
  try {
    await toggleMessageReaction(messageId, emoji);
    await refreshReactions(state.activeChatId);
  } catch (error) {
    showToast(friendlyError(error));
  } finally {
    if (button) button.disabled = false;
  }
}

async function sendHeartReaction(messageId) {
  const alreadyReacted = (state.reactions.get(messageId) ?? []).some(
    (row) => row.user_id === state.session.user.id && row.reaction === '❤️',
  );
  const message = document.querySelector(`.message[data-message-id="${CSS.escape(messageId)}"]`);
  if (message) {
    message.classList.remove('heart-pop');
    void message.offsetWidth;
    message.classList.add('heart-pop');
    setTimeout(() => message.classList.remove('heart-pop'), 650);
  }
  if (!alreadyReacted) await applyMessageReaction(messageId, '❤️');
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

function renderRecordingWaveform(samples) {
  const waveform = $('voice-recording-waveform');
  if (!waveform) return;
  const peaks = samples.length
    ? buildVoiceWaveform(samples, VOICE_WAVEFORM_BARS)
    : Array.from({ length: VOICE_WAVEFORM_BARS }, () => 0.08);
  waveform.innerHTML = peaks
    .map((peak) => `<span style="--voice-peak:${peak}"></span>`)
    .join('');
}

function sampleRecordingWaveform(analyser, samples) {
  const buffer = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(buffer);
  let sum = 0;
  for (const sample of buffer) {
    const amplitude = (sample - 128) / 128;
    sum += amplitude * amplitude;
  }
  samples.push(Math.min(1, Math.sqrt(sum / buffer.length) * 4));
  renderRecordingWaveform(samples);
}

function renderPendingVoiceMessage(message) {
  if (state.activeChatId !== message.chat_id) return;
  state.messages = [...state.messages.filter((item) => item.id !== message.id), message]
    .sort(compareMessageOrder);
  renderMessages();
}

async function uploadPendingVoice(messageId) {
  const pending = state.pendingVoiceUploads.get(messageId);
  if (!pending) return;
  pending.optimistic.uploading_voice = true;
  delete pending.optimistic.upload_error;
  renderPendingVoiceMessage(pending.optimistic);

  let uploadedPath = null;
  try {
    validateUpload(pending.file);
    const path = `${pending.chat.chat_id}/${state.session.user.id}/${crypto.randomUUID()}.${mediaExtension(pending.file.type)}`;
    uploadedPath = await uploadMedia('chat-media', path, pending.file, pending.file.type);
    const media = {
      path: uploadedPath,
      type: pending.file.type,
      name: 'Voice note',
      voiceNote: true,
      voiceDurationMs: pending.metadata.durationMs,
      voiceWaveform: pending.metadata.waveform,
    };
    await sendMessage(pending.chat.chat_id, state.session.user.id, '', media);
  } catch (error) {
    if (uploadedPath) {
      try {
        await removeMedia('chat-media', uploadedPath);
      } catch (cleanupError) {
        console.error('Could not clean up an incomplete voice-note upload.', cleanupError);
      }
    }
    pending.optimistic.uploading_voice = false;
    pending.optimistic.upload_error = friendlyError(error);
    renderPendingVoiceMessage(pending.optimistic);
    showToast(`Could not send voice note: ${friendlyError(error)}. Retry is available in the message.`);
    return;
  }

  state.pendingVoiceUploads.delete(messageId);
  URL.revokeObjectURL(pending.optimistic.media_url);
  if (state.activeChatId === pending.chat.chat_id) {
    try {
      const saved = await hydrateMessages(await listMessages(pending.chat.chat_id));
      const byId = new Map(saved.map((message) => [message.id, message]));
      for (const queued of state.pendingVoiceUploads.values()) {
        if (queued.chat.chat_id === pending.chat.chat_id) byId.set(queued.optimistic.id, queued.optimistic);
      }
      state.messages = [...byId.values()].sort(compareMessageOrder);
      renderMessages();
    } catch (error) {
      showToast(`Voice note was sent, but the conversation could not refresh: ${friendlyError(error)}`);
    }
  }
  try {
    await refreshChats();
  } catch (error) {
    showToast(`Voice note was sent, but the chat list could not refresh: ${friendlyError(error)}`);
  }
}

function discardPendingVoice(messageId) {
  const pending = state.pendingVoiceUploads.get(messageId);
  if (!pending || pending.optimistic.uploading_voice) return;
  state.pendingVoiceUploads.delete(messageId);
  URL.revokeObjectURL(pending.optimistic.media_url);
  state.messages = state.messages.filter((message) => message.id !== messageId);
  if (state.activeChatId === pending.chat.chat_id) renderMessages();
}

async function toggleRecording() {
  const button = $('voice-note');
  if (state.voiceRecorder?.state === 'recording') {
    if (state.voiceHold) state.voiceHold.released = true;
    state.voiceRecorder.stop();
    return;
  }
  if (state.voiceRecorder || state.voiceStarting) return;
  const recordingChat = state.activeChat;
  if (!recordingChat) return;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    showToast('Voice recording is not supported in this browser.');
    return;
  }
  if (button) button.disabled = true;
  state.voiceStarting = true;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (state.activeChatId !== recordingChat.chat_id || state.voiceHold?.cancelled) {
      stream.getTracks().forEach((track) => track.stop());
      state.voiceHold = null;
      return;
    }
    const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('Live voice waveforms are not supported in this browser.');
    const audioContext = new AudioContextClass();
    state.voiceAudioContext = audioContext;
    await audioContext.resume();
    if (state.activeChatId !== recordingChat.chat_id || state.voiceHold?.cancelled) {
      stream.getTracks().forEach((track) => track.stop());
      if (audioContext.state !== 'closed') await audioContext.close();
      if (state.voiceAudioContext === audioContext) state.voiceAudioContext = null;
      state.voiceHold = null;
      return;
    }
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    audioContext.createMediaStreamSource(stream).connect(analyser);
    const preferredType = ['audio/webm', 'audio/mp4', 'audio/ogg']
      .find((type) => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(stream, preferredType ? { mimeType: preferredType } : undefined);
    state.voiceRecorder = recorder;
    state.voiceStream = stream;
    state.voiceAnalyser = analyser;
    const recordedChunks = [];
    const samples = [];
    state.voiceSamples = samples;
    const startedAt = Date.now();
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size) recordedChunks.push(event.data);
    });
    recorder.addEventListener('stop', async () => {
      if (state.voiceRecorder !== recorder) return;
      clearInterval(timer);
      clearInterval(waveformTimer);
      if (state.voiceTimer === timer) state.voiceTimer = null;
      if (state.voiceWaveformTimer === waveformTimer) state.voiceWaveformTimer = null;
      stream.getTracks().forEach((track) => track.stop());
      state.voiceStream = null;
      state.voiceRecorder = null;
      state.voiceAnalyser = null;
      if (audioContext.state !== 'closed') {
        try {
          await audioContext.close();
        } catch (error) {
          console.error('Could not close voice recording audio context.', error);
        }
      }
      if (state.voiceAudioContext === audioContext) state.voiceAudioContext = null;
      const cancelled = state.voiceHold?.cancelled ?? false;
      const released = state.voiceHold?.released ?? false;
      state.voiceHold = null;
      if (button) {
        button.textContent = '🎙';
        button.setAttribute('aria-label', 'Hold to record a voice note');
        button.title = 'Hold to record · release to send · slide left to cancel';
        button.disabled = false;
      }
      const recordingControls = $('recording-controls');
      if (recordingControls) recordingControls.hidden = true;
      if (cancelled || !released) return;
      const type = (recorder.mimeType || 'audio/webm').split(';', 1)[0];
      const blob = new Blob(recordedChunks, { type });
      if (!blob.size) return;
      const file = new File([blob], `voice-note.${mediaExtension(type) ?? 'webm'}`, { type });
      let waveform;
      try {
        waveform = buildVoiceWaveform(samples);
      } catch (error) {
        showToast(`Could not prepare voice-note waveform: ${friendlyError(error)}`);
        return;
      }
      const durationMs = Math.max(1, Math.min(300000, Date.now() - startedAt));
      const optimisticId = `pending-voice-${crypto.randomUUID()}`;
      const optimistic = {
        id: optimisticId,
        chat_id: recordingChat.chat_id,
        sender_id: state.session.user.id,
        sender: {
          display_name: state.profile.display_name,
          username: state.profile.username,
          avatar_path: state.profile.avatar_path,
        },
        body: '',
        created_at: new Date().toISOString(),
        media_type: type,
        file_name: 'Voice note',
        voice_note: true,
        voice_duration_ms: durationMs,
        voice_waveform: waveform,
        media_url: URL.createObjectURL(blob),
        pending_voice: true,
      };
      state.pendingVoiceUploads.set(optimisticId, {
        file,
        chat: recordingChat,
        metadata: { durationMs, waveform },
        optimistic,
      });
      renderPendingVoiceMessage(optimistic);
      void uploadPendingVoice(optimisticId);
    }, { once: true });
    recorder.start(250);
    if (button) {
      button.textContent = '■';
      button.setAttribute('aria-label', 'Recording; release to send or slide left to cancel');
      button.title = 'Release to send · slide left to cancel';
    }
    const recordingControls = $('recording-controls');
    const recordingStatus = $('recording-status');
    if (recordingControls && recordingStatus) {
      recordingControls.hidden = false;
      recordingStatus.textContent = 'Recording · 00:00';
    }
    const timer = setInterval(() => {
      if (recorder.state !== 'recording') return;
      const elapsed = Date.now() - startedAt;
      if (recordingStatus) {
        recordingStatus.textContent = `Recording · ${formatVoiceDuration(elapsed)}`;
      }
      if (elapsed >= 5 * 60 * 1000) {
        if (state.voiceHold) state.voiceHold.released = true;
        recorder.stop();
        showToast('Voice note reached the 5-minute limit and is being sent.');
      }
    }, 1000);
    const waveformTimer = setInterval(() => {
      if (recorder.state === 'recording') sampleRecordingWaveform(analyser, samples);
    }, 100);
    state.voiceTimer = timer;
    state.voiceWaveformTimer = waveformTimer;
    renderRecordingWaveform(samples);
    if (state.voiceHold?.released || state.voiceHold?.cancelled) recorder.stop();
  } catch (error) {
    stream?.getTracks().forEach((track) => track.stop());
    if (state.voiceAudioContext && state.voiceAudioContext.state !== 'closed') {
      try {
        await state.voiceAudioContext.close();
      } catch (closeError) {
        console.error('Could not close voice recording audio context.', closeError);
      }
    }
    state.voiceAudioContext = null;
    state.voiceStream = null;
    state.voiceRecorder = null;
    state.voiceHold = null;
    const recordingControls = $('recording-controls');
    if (recordingControls) recordingControls.hidden = true;
    if (button) {
      button.textContent = '🎙';
      button.setAttribute('aria-label', 'Hold to record a voice note');
      button.title = 'Hold to record · release to send · slide left to cancel';
    }
    showToast(`Could not start voice recording: ${friendlyError(error)}`);
  } finally {
    state.voiceStarting = false;
    if (button) button.disabled = false;
  }
}

function cancelVoiceRecording() {
  if (state.voiceHold) {
    state.voiceHold.cancelled = true;
    state.voiceHold.released = true;
  }
  clearInterval(state.voiceTimer);
  clearInterval(state.voiceWaveformTimer);
  state.voiceTimer = null;
  state.voiceWaveformTimer = null;
  const recorder = state.voiceRecorder;
  if (recorder?.state === 'recording') recorder.stop();
  else {
    state.voiceStream?.getTracks().forEach((track) => track.stop());
    state.voiceStream = null;
    if (!state.voiceStarting) state.voiceHold = null;
    state.voiceRecorder = null;
  }
  if (state.voiceAudioContext && state.voiceAudioContext.state !== 'closed') {
    void state.voiceAudioContext.close().catch((error) => console.error('Could not close voice recording audio context.', error));
  }
  state.voiceAudioContext = null;
  state.voiceAnalyser = null;
  const controls = $('recording-controls');
  if (controls) controls.hidden = true;
  const button = $('voice-note');
  if (button) {
    button.textContent = '🎙';
    button.setAttribute('aria-label', 'Hold to record a voice note');
    button.title = 'Hold to record · release to send · slide left to cancel';
    button.disabled = false;
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
  $('conversation').addEventListener('input', (event) => {
    if (event.target.id === 'tenor-gif-search') {
      searchTenorGifOptions(event.target.value);
      return;
    }
    if (!event.target.matches('#message-form textarea')) return;
    renderMentionSuggestions(event.target);
    if (!state.chatLive || !['direct', 'group'].includes(chatType())) return;
    const now = Date.now();
    if (!shouldSendTyping(state.lastTypingSentAt, now)) return;
    state.lastTypingSentAt = now;
    void state.chatLive.broadcastTyping();
  });
  const canDropChatMedia = () => Boolean(
    $('message-form')
    && state.activeChat
    && (state.activeChat.chat_type !== 'channel' || ['owner', 'admin'].includes(state.activeChat.my_role)),
  );
  const hasDraggedFiles = (event) => Array.from(event.dataTransfer?.types ?? []).includes('Files');
  $('conversation').addEventListener('dragover', (event) => {
    if (!hasDraggedFiles(event) || !canDropChatMedia()) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    $('message-form')?.classList.add('is-dragging');
    const hint = $('chat-media-drop-hint');
    if (hint) hint.hidden = false;
  });
  $('conversation').addEventListener('dragleave', (event) => {
    if (event.relatedTarget && event.currentTarget.contains(event.relatedTarget)) return;
    $('message-form')?.classList.remove('is-dragging');
    const hint = $('chat-media-drop-hint');
    if (hint) hint.hidden = true;
  });
  $('conversation').addEventListener('drop', (event) => {
    if (!hasDraggedFiles(event) || !canDropChatMedia()) return;
    event.preventDefault();
    $('message-form')?.classList.remove('is-dragging');
    const hint = $('chat-media-drop-hint');
    if (hint) hint.hidden = true;
    queueChatMediaFiles(Array.from(event.dataTransfer?.files ?? []));
  });
  $('conversation').addEventListener('wheel', (event) => {
    const list = event.target.closest('#message-list');
    if (list) armReadAtBottom(list);
  }, true);
  $('conversation').addEventListener('touchmove', (event) => {
    const list = event.target.closest('#message-list');
    if (list) armReadAtBottom(list);
  }, { capture: true, passive: true });
  $('conversation').addEventListener('pointerdown', (event) => {
    if (event.target.closest('#message-list')) state.scrollIntentUntil = Date.now() + 2000;
  }, true);
  $('conversation').addEventListener('scroll', (event) => {
    const list = event.target;
    if (
      list.id === 'message-list'
      && Date.now() <= state.scrollIntentUntil
      && isScrolledToBottom(list)
      && conversationIsVisible()
    ) {
      state.readAckArmed = true;
      void markChatReadIfAtBottom();
    }
  }, true);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') void updateLastSeen();
  });
  window.addEventListener('pagehide', () => { void updateLastSeen(); });

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

  $('message-search-close').addEventListener('click', () => closeMessageSearch());
  $('message-search-overlay').addEventListener('click', (event) => {
    if (event.target === event.currentTarget) closeMessageSearch();
  });
  $('message-search-query').addEventListener('input', () => {
    state.messageSearch.offset = 0;
    scheduleMessageSearch();
  });
  $('message-search-scope').addEventListener('click', (event) => {
    const button = event.target.closest('[data-message-search-scope]');
    if (!button || button.disabled) return;
    state.messageSearch.scope = button.dataset.messageSearchScope;
    state.messageSearch.offset = 0;
    document.querySelectorAll('[data-message-search-scope]').forEach((item) => {
      item.setAttribute('aria-pressed', String(item === button));
    });
    void loadMessageSearchResults();
  });
  $('message-search-results').addEventListener('click', (event) => {
    const resultButton = event.target.closest('[data-message-search-result]');
    if (!resultButton) return;
    const index = Number(resultButton.dataset.messageSearchResult);
    state.messageSearch.selectedIndex = index;
    void jumpToSearchResult(state.messageSearch.results[index]);
  });
  $('message-search-overlay').addEventListener('click', (event) => {
    const step = event.target.closest('[data-message-search-step]');
    if (step && state.messageSearch.results.length) {
      const { results, selectedIndex } = state.messageSearch;
      const direction = Number(step.dataset.messageSearchStep);
      const nextIndex = (selectedIndex + direction + results.length) % results.length;
      state.messageSearch.selectedIndex = nextIndex;
      void jumpToSearchResult(results[nextIndex]);
      return;
    }
    const page = event.target.closest('[data-message-search-page]');
    if (!page) return;
    const nextOffset = state.messageSearch.offset + Number(page.dataset.messageSearchPage) * 25;
    if (nextOffset < 0 || nextOffset > 5000 || (Number(page.dataset.messageSearchPage) > 0
      && state.messageSearch.results.length < 25)) return;
    state.messageSearch.offset = nextOffset;
    void loadMessageSearchResults();
  });

  $('profile-preview-close').addEventListener('click', () => closeProfilePreview());
  $('profile-preview').addEventListener('click', (event) => {
    if (event.target === event.currentTarget) closeProfilePreview();
  });
  $('profile-preview-content').addEventListener('click', async (event) => {
    const tab = event.target.closest('[data-preview-tab]');
    if (tab) {
      state.profilePreviewTab = tab.dataset.previewTab;
      renderProfilePreview();
      $(`#profile-tab-${state.profilePreviewTab}`)?.focus();
      return;
    }
    const mediaButton = event.target.closest('[data-lightbox-index]');
    if (mediaButton) {
      renderProfileLightbox(Number(mediaButton.dataset.lightboxIndex));
      return;
    }
    const messageButton = event.target.closest('[data-preview-message]');
    if (messageButton && state.profilePreview?.profile) {
      const person = state.profilePreview.profile;
      closeProfilePreview(false);
      await openPersonChat(person, messageButton);
      return;
    }
    const muteButton = event.target.closest('[data-preview-mute]');
    if (muteButton && state.profilePreview) {
      muteButton.disabled = true;
      try {
        state.profilePreview.muted = await setProfilePreviewMuted(
          state.profilePreview.profile.id,
          !state.profilePreview.muted,
        );
        renderProfilePreview();
        $('[data-preview-mute]')?.focus();
        showToast(state.profilePreview.muted ? 'Profile muted.' : 'Profile unmuted.');
      } catch (error) {
        muteButton.disabled = false;
        showToast(`Could not update mute settings: ${friendlyError(error)}`);
      }
      return;
    }
    const blockButton = event.target.closest('[data-preview-block]');
    if (blockButton && state.profilePreview) {
      blockButton.disabled = true;
      try {
        state.profilePreview.blocked = await setProfilePreviewBlocked(
          state.profilePreview.profile.id,
          !state.profilePreview.blocked,
        );
        renderProfilePreview();
        $('[data-preview-block]')?.focus();
        showToast(state.profilePreview.blocked ? 'Profile blocked.' : 'Profile unblocked.');
      } catch (error) {
        blockButton.disabled = false;
        showToast(`Could not update block settings: ${friendlyError(error)}`);
      }
      return;
    }
    const reportButton = event.target.closest('[data-preview-report]');
    if (reportButton && state.profilePreview && state.profilePreviewContextChatId) {
      reportButton.disabled = true;
      try {
        await reportProfilePreview(
          state.profilePreview.profile.id,
          state.profilePreviewContextChatId,
        );
        showToast('Report submitted.');
      } catch (error) {
        reportButton.disabled = false;
        showToast(`Could not submit report: ${friendlyError(error)}`);
      }
    }
  });
  $('profile-lightbox').addEventListener('click', (event) => {
    if (event.target === event.currentTarget || event.target.closest('.lightbox-close')) {
      closeProfileLightbox();
      return;
    }
    if (event.target.closest('.lightbox-previous')) {
      renderProfileLightbox(state.profileLightboxIndex - 1);
      return;
    }
    if (event.target.closest('.lightbox-next')) renderProfileLightbox(state.profileLightboxIndex + 1);
  });
  document.addEventListener('click', async (event) => {
    const emojiPicker = $('emoji-picker');
    if (emojiPicker && !emojiPicker.hidden
      && !event.target.closest('#emoji-picker, #emoji-picker-toggle')) {
      emojiPicker.hidden = true;
      $('emoji-picker-toggle')?.setAttribute('aria-expanded', 'false');
    }
    const searchTrigger = event.target.closest('[data-open-message-search]');
    if (searchTrigger) {
      openMessageSearch(searchTrigger.dataset.openMessageSearch);
      return;
    }
    if (event.target.closest('#mention-notifications-close')) {
      setMentionNotificationsOpen(false);
      $('mention-notifications-toggle')?.focus();
      return;
    }
    const notificationToggle = event.target.closest('#mention-notifications-toggle');
    if (notificationToggle) {
      setMentionNotificationsOpen(notificationToggle.getAttribute('aria-expanded') !== 'true');
      return;
    }
    const mentionNotification = event.target.closest('[data-mention-chat][data-mention-message]');
    if (mentionNotification) {
      const { mentionChat: chatId, mentionMessage: messageId } = mentionNotification.dataset;
      const chat = state.chats.find((item) => item.chat_id === chatId);
      if (!chat) {
        showToast('This chat is no longer available.');
        return;
      }
      setMentionNotificationsOpen(false);
      try {
        await openChat(chatId, chat);
        await scrollToMessage(messageId);
      } catch (error) {
        showToast(`Could not open the mentioned message: ${friendlyError(error)}`);
      }
      return;
    }
    const reactionPanel = $('reaction-details');
    if (!reactionPanel.hidden && !event.target.closest('#reaction-details, [data-reaction-details]')) {
      closeReactionDetails();
    }
    const trigger = event.target.closest('.profile-preview-trigger[data-profile-preview-id]');
    if (!trigger) return;
    event.preventDefault();
    void openProfilePreview(
      trigger.dataset.profilePreviewId,
      trigger.dataset.profilePreviewContext ?? null,
      trigger,
    );
  });
  document.addEventListener('keydown', (event) => {
    const searchOpen = !$('message-search-overlay').hidden;
    if (event.key === 'Escape' && !$('emoji-picker').hidden) {
      event.preventDefault();
      $('emoji-picker').hidden = true;
      $('emoji-picker-toggle').setAttribute('aria-expanded', 'false');
      $('emoji-picker-toggle').focus();
      return;
    }
    if (event.key === 'Escape' && searchOpen) {
      event.preventDefault();
      closeMessageSearch();
      return;
    }
    if (event.key === 'Tab' && searchOpen) {
      const scope = $('message-search-panel');
      const focusable = [...scope.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )].filter((element) => element.getClientRects().length > 0);
      if (focusable.length) {
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      } else {
        event.preventDefault();
        scope.focus();
      }
      return;
    }
    if (event.key === 'Escape' && !$('reaction-details').hidden) {
      closeReactionDetails();
      return;
    }
    const previewOpen = !$('profile-preview').hidden;
    if (event.key === 'Escape' && previewOpen) {
      event.preventDefault();
      if (!$('profile-lightbox').hidden) closeProfileLightbox();
      else closeProfilePreview();
      return;
    }
    if (event.key === 'Tab' && previewOpen) {
      const scope = $('profile-lightbox').hidden ? $('profile-preview-panel') : $('profile-lightbox');
      const focusable = [...scope.querySelectorAll(
        'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )].filter((element) => element.getClientRects().length > 0);
      if (focusable.length) {
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      } else {
        event.preventDefault();
        scope.focus();
      }
    }
    if ($('profile-lightbox').hidden) return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      renderProfileLightbox(state.profileLightboxIndex - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      renderProfileLightbox(state.profileLightboxIndex + 1);
    }
  });

  $('main-nav').addEventListener('click', (event) => {
    const button = event.target.closest('[data-view]');
    if (button) updateNavigation(button.dataset.view);
  });
  $('unread-total-toggle').addEventListener('click', () => updateNavigation('chats'));

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
    const mute = event.target.closest('[data-mute-id]');
    if (mute) {
      const chatId = mute.dataset.muteId;
      const chat = state.chats.find((item) => item.chat_id === chatId);
      if (!chat || state.mutingChatIds.has(chatId)) return;
      const previousMuted = Boolean(chat.muted);
      const nextMuted = !previousMuted;
      chat.muted = nextMuted;
      state.mutingChatIds.add(chatId);
      renderChats();
      try {
        chat.muted = await setChatMuted(chatId, state.session.user.id, nextMuted);
        await refreshChats();
      } catch (error) {
        const currentChat = state.chats.find((item) => item.chat_id === chatId);
        if (currentChat) currentChat.muted = previousMuted;
        renderChats();
        showToast(`Could not ${nextMuted ? 'mute' : 'unmute'} chat: ${friendlyError(error)}`);
      } finally {
        state.mutingChatIds.delete(chatId);
        renderChats();
      }
      return;
    }
    const markUnread = event.target.closest('[data-mark-unread-id]');
    if (markUnread) {
      markUnread.disabled = true;
      try {
        await markChatUnread(markUnread.dataset.markUnreadId);
        await refreshChats();
        showToast('Chat marked as unread.');
      } catch (error) {
        showToast(`Could not mark chat as unread: ${friendlyError(error)}`);
      } finally {
        markUnread.disabled = false;
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
    const mentionSuggestion = event.target.closest('[data-mention-id]');
    if (mentionSuggestion) {
      selectMentionSuggestion(mentionSuggestion.dataset.mentionId);
      return;
    }
    if (event.target.closest('[data-open-pinned-messages]')) {
      renderPinnedMessageDialog();
      $('pinned-messages-dialog').hidden = false;
      $('pinned-messages-dialog').querySelector('.dialog-close').focus();
      return;
    }
    const reply = event.target.closest('[data-message-reply]');
    if (reply) {
      setReplyTarget(reply.dataset.messageReply);
      return;
    }
    if (event.target.closest('[data-cancel-reply]')) {
      state.replyingTo = null;
      updateReplyStrip();
      $('message-form [name="body"]')?.focus();
      return;
    }
    const quote = event.target.closest('[data-scroll-to-message]');
    if (quote) {
      await scrollToMessage(quote.dataset.scrollToMessage);
      return;
    }
    const details = event.target.closest('[data-reaction-details]');
    if (details) {
      await openReactionDetails(
        details.dataset.reactionMessage,
        details.dataset.reactionDetails,
        details,
      );
      return;
    }
    const reaction = event.target.closest('[data-toggle-reaction], [data-quick-reaction]');
    if (reaction) {
      await applyMessageReaction(
        reaction.dataset.reactionMessage,
        reaction.dataset.toggleReaction ?? reaction.dataset.quickReaction,
        reaction,
      );
      return;
    }
    if (event.target.closest('#conversation-back')) {
      $('conversation').classList.remove('is-open');
      stopChatLive();
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
  $('pinned-message-list').addEventListener('click', async (event) => {
    const removeButton = event.target.closest('[data-unpin-message]');
    if (removeButton) {
      removeButton.disabled = true;
      try {
        await unpinChatMessage(state.activeChatId, removeButton.dataset.unpinMessage);
        await refreshChatPins(state.activeChatId);
        showToast('Message unpinned.');
      } catch (error) {
        removeButton.disabled = false;
        showToast(`Could not unpin message: ${friendlyError(error)}`);
      }
      return;
    }
    const jumpButton = event.target.closest('[data-pinned-message]');
    if (jumpButton) {
      $('pinned-messages-dialog').hidden = true;
      await scrollToMessage(jumpButton.dataset.pinnedMessage);
    }
  });
  $('group-details-content').addEventListener('submit', async (event) => {
    if (event.target.id === 'disappearing-settings-form') {
      event.preventDefault();
      const formElement = event.target;
      const chat = state.activeChat;
      if (!chat) return;
      const submit = formElement.querySelector('button[type="submit"]');
      if (submit) submit.disabled = true;
      try {
        await setChatDisappearingTimer(
          chat.chat_id,
          Number(new FormData(formElement).get('timer_seconds')),
        );
        await openGroupDetails();
        showToast('Disappearing-message timer saved. It applies to new messages.');
      } catch (error) {
        showToast(`Could not save disappearing-message settings: ${friendlyError(error)}`);
      } finally {
        if (submit) submit.disabled = false;
      }
      return;
    }
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
    const body = messageBodyWithPickerMedia(input.value);
    if (!state.activeChatId) return;
    const chat = state.activeChat;
    const chatId = state.activeChatId;
    const queue = state.pendingChatMedia.get(chatId) ?? [];
    if (!body && !queue.length) return;
    if (body.length > 4000) {
      showToast('Message text is too long to include the selected sticker or GIF.');
      return;
    }
    if (queue.length) {
      const itemIds = queue.filter((item) => item.status !== 'uploading').map((item) => item.id);
      if (!itemIds.length) return;
      const rawBody = input.value;
      const replyToId = state.replyingTo?.id ?? null;
      try {
        await sendQueuedChatMedia(chat, itemIds, body, rawBody, replyToId);
      } catch (error) {
        showToast(`Could not send attachments: ${friendlyError(error)}`);
      } finally {
        if (state.activeChatId === chatId) {
          renderPendingChatMedia();
          input.focus();
        }
      }
      return;
    }
    if (!body) return;
    const senderId = state.session.user.id;
    const button = event.target.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      if (!state.pickerMediaDraft && state.activeChat?.chat_type === 'group' && body.startsWith('/')) {
        await executeGroupCommand(body);
        input.value = '';
        return;
      }
      const replyToId = state.replyingTo?.id ?? null;
      const message = await sendMessage(chatId, senderId, body, null, replyToId);
      if (state.activeChatId === chatId) {
        input.value = '';
        state.pickerMediaDraft = null;
        renderPickerMediaDraft();
      }
      if (state.activeChatId === chatId && !state.messages.some((item) => item.id === message.id)) {
        state.messages.push({ ...message, sender: state.profile });
        state.replyingTo = null;
        updateReplyStrip();
        renderMessages();
      }
      await refreshChats();
    } catch (error) {
      showToast(friendlyError(error));
    } finally {
      button.disabled = false;
      input.focus();
    }
  });

  $('conversation').addEventListener('click', async (event) => {
    if (event.target.closest('#emoji-picker-toggle')) {
      const picker = $('emoji-picker');
      const button = $('emoji-picker-toggle');
      if (picker.hidden) {
        renderEmojiPicker();
        button.setAttribute('aria-expanded', 'true');
        picker.querySelector('[data-insert-emoji], [data-insert-sticker]')?.focus();
      } else {
        picker.hidden = true;
        button.setAttribute('aria-expanded', 'false');
        button.focus();
      }
      return;
    }
    const pickerTab = event.target.closest('[data-emoji-picker-tab]');
    if (pickerTab) {
      renderEmojiPicker(pickerTab.dataset.emojiPickerTab);
      const picker = $('emoji-picker');
      (pickerTab.dataset.emojiPickerTab === 'gifs'
        ? picker.querySelector('#tenor-gif-search')
        : picker.querySelector('[data-insert-emoji], [data-insert-sticker]'))?.focus();
      return;
    }
    const emojiChoice = event.target.closest('[data-insert-emoji]');
    if (emojiChoice) {
      rememberEmoji(emojiChoice.dataset.insertEmoji);
      insertComposerEmoji(emojiChoice.dataset.insertEmoji);
      $('emoji-picker').hidden = true;
      $('emoji-picker-toggle').setAttribute('aria-expanded', 'false');
      return;
    }
    const stickerChoice = event.target.closest('[data-insert-sticker]');
    if (stickerChoice) {
      const sticker = STICKERS_BY_ID.get(stickerChoice.dataset.insertSticker);
      if (!sticker) return;
      state.pickerMediaDraft = { type: 'sticker', id: sticker.id };
      renderPickerMediaDraft();
      $('emoji-picker').hidden = true;
      $('emoji-picker-toggle').setAttribute('aria-expanded', 'false');
      $('message-form [name="body"]')?.focus();
      return;
    }
    const gifChoice = event.target.closest('[data-insert-gif]');
    if (gifChoice) {
      const gifUrl = safeTenorGifUrl(gifChoice.dataset.insertGif);
      if (!gifUrl) {
        showToast('That GIF could not be selected. Search again to choose a valid result.');
        return;
      }
      state.pickerMediaDraft = {
        type: 'gif',
        gifUrl,
        title: gifChoice.dataset.gifTitle ?? 'GIF',
      };
      renderPickerMediaDraft();
      $('emoji-picker').hidden = true;
      $('emoji-picker-toggle').setAttribute('aria-expanded', 'false');
      $('message-form [name="body"]')?.focus();
      return;
    }
    if (event.target.closest('[data-remove-picker-media]')) {
      state.pickerMediaDraft = null;
      renderPickerMediaDraft();
      $('message-form [name="body"]')?.focus();
      return;
    }
    const removeChatMedia = event.target.closest('[data-remove-chat-media]');
    if (removeChatMedia) {
      removeQueuedChatMedia(state.activeChatId, removeChatMedia.dataset.removeChatMedia);
      return;
    }
    const retryChatMedia = event.target.closest('[data-retry-chat-media]');
    if (retryChatMedia && state.activeChat) {
      const input = $('message-form [name="body"]');
      const rawBody = input?.value ?? '';
      const body = messageBodyWithPickerMedia(rawBody);
      if (body.length > 4000) {
        showToast('Message text is too long to include the selected sticker or GIF.');
        return;
      }
      try {
        await sendQueuedChatMedia(
          state.activeChat,
          [retryChatMedia.dataset.retryChatMedia],
          body,
          rawBody,
          state.replyingTo?.id ?? null,
        );
      } catch (error) {
        showToast(`Could not retry attachment: ${friendlyError(error)}`);
      } finally {
        if (state.activeChatId === state.activeChat?.chat_id) {
          renderPendingChatMedia();
        }
      }
      return;
    }
    const readCount = event.target.closest('[data-read-count]');
    if (readCount) {
      const count = Number(readCount.dataset.readCount);
      showToast(`${count} member${count === 1 ? '' : 's'} read this message.`);
      return;
    }
    if (event.target.closest('#attach-media')) {
      $('chat-media-input').click();
      return;
    }
    if (event.target.closest('#voice-note-discard-recording')) {
      cancelVoiceRecording();
      return;
    }
    const retryVoice = event.target.closest('[data-retry-pending-voice]');
    if (retryVoice) {
      await uploadPendingVoice(retryVoice.dataset.retryPendingVoice);
      return;
    }
    const removePendingVoice = event.target.closest('[data-discard-pending-voice]');
    if (removePendingVoice) {
      discardPendingVoice(removePendingVoice.dataset.discardPendingVoice);
      return;
    }
    if (event.target.closest('#voice-note') && event.detail === 0) {
      if (!state.voiceRecorder) {
        state.voiceHold = { released: false, cancelled: false, keyboard: true };
      }
      await toggleRecording();
      return;
    }
  });

  $('conversation').addEventListener('pointerdown', (event) => {
    const button = event.target.closest('#voice-note');
    if (!button || event.button !== 0 || state.voiceRecorder) return;
    event.preventDefault();
    button.setPointerCapture?.(event.pointerId);
    state.voiceHold = {
      pointerId: event.pointerId,
      startX: event.clientX,
      released: false,
      cancelled: false,
    };
    void toggleRecording();
  });
  document.addEventListener('pointermove', (event) => {
    const hold = state.voiceHold;
    if (!hold || hold.keyboard || hold.pointerId !== event.pointerId || hold.released) return;
    if (event.clientX <= hold.startX - 64) {
      hold.cancelled = true;
      hold.released = true;
      if (state.voiceRecorder?.state === 'recording') state.voiceRecorder.stop();
    }
  });
  document.addEventListener('pointerup', (event) => {
    const hold = state.voiceHold;
    if (!hold || hold.keyboard || hold.pointerId !== event.pointerId) return;
    hold.released = true;
    if (state.voiceRecorder?.state === 'recording') state.voiceRecorder.stop();
  });
  document.addEventListener('pointercancel', (event) => {
    const hold = state.voiceHold;
    if (!hold || hold.keyboard || hold.pointerId !== event.pointerId) return;
    hold.cancelled = true;
    hold.released = true;
    if (state.voiceRecorder?.state === 'recording') state.voiceRecorder.stop();
  });

  $('chat-media-input').addEventListener('change', (event) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    queueChatMediaFiles(files);
  });

  $('conversation').addEventListener('pointerdown', (event) => {
    const message = event.target.closest('.message[data-message-id]');
    if (!message || event.target.closest('button, a, audio, video')) return;
    clearTimeout(state.messagePressTimer);
    const { clientX, clientY } = event;
    messagePressOrigin = {
      x: clientX,
      y: clientY,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      messageId: message.dataset.messageId,
      moved: false,
      longPressed: false,
    };
    state.messagePressTimer = setTimeout(() => {
      if (messagePressOrigin) messagePressOrigin.longPressed = true;
      showMessageMenu(message.dataset.messageId, clientX, clientY);
    }, 520);
  });
  $('conversation').addEventListener('pointerup', (event) => {
    const origin = messagePressOrigin;
    if (
      origin
      && origin.pointerId === event.pointerId
      && origin.pointerType === 'touch'
      && !origin.longPressed
      && event.clientX - origin.x >= 72
      && Math.abs(event.clientY - origin.y) <= 38
      && !event.target.closest('button, a, audio, video')
    ) {
      clearTimeout(state.messagePressTimer);
      state.lastTouchTap = null;
      setReplyTarget(origin.messageId);
      messagePressOrigin = null;
      return;
    }
    if (origin?.pointerId === event.pointerId && (origin.longPressed || origin.moved)) {
      state.lastTouchTap = null;
      return;
    }
    if (event.pointerType !== 'touch') return;
    const message = event.target.closest('.message[data-message-id]');
    const previousTap = state.lastTouchTap;
    const now = Date.now();
    if (
      message
      && previousTap?.messageId === message.dataset.messageId
      && now - previousTap.at <= 350
      && Math.hypot(event.clientX - previousTap.x, event.clientY - previousTap.y) <= 28
      && $('message-context').hidden
    ) {
      state.lastTouchTap = null;
      clearTimeout(state.messagePressTimer);
      void sendHeartReaction(message.dataset.messageId);
      return;
    }
    state.lastTouchTap = message
      ? { messageId: message.dataset.messageId, at: now, x: event.clientX, y: event.clientY }
      : null;
  });
  $('conversation').addEventListener('dblclick', (event) => {
    const message = event.target.closest('.message[data-message-id]');
    if (!message || event.target.closest('button, a, audio, video')) return;
    void sendHeartReaction(message.dataset.messageId);
  });
  document.addEventListener('pointermove', (event) => {
    if (!messagePressOrigin || event.pointerId !== messagePressOrigin.pointerId) return;
    if (Math.hypot(event.clientX - messagePressOrigin.x, event.clientY - messagePressOrigin.y) > 12) {
      clearTimeout(state.messagePressTimer);
      messagePressOrigin.moved = true;
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
  $('conversation').addEventListener('mouseover', (event) => {
    const message = event.target.closest('.message[data-message-id]');
    if (message) state.hoveredMessageId = message.dataset.messageId;
  });
  $('conversation').addEventListener('focusin', (event) => {
    const message = event.target.closest('.message[data-message-id]');
    if (message) state.hoveredMessageId = message.dataset.messageId;
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
    if (action === 'reply') {
      setReplyTarget(message.id);
      return;
    }
    if (action === 'edit') {
      $('edit-message-form').elements.body.value = message.body;
      $('edit-message-dialog').hidden = false;
      return;
    }
    if (action === 'forward') {
      openForwardDialog(message.id);
      return;
    }
    if (action === 'pin') {
      try {
        const isPinned = state.pinnedMessages.some((pin) => pin.message_id === message.id);
        if (isPinned) await unpinChatMessage(state.activeChatId, message.id);
        else await pinChatMessage(state.activeChatId, message.id, state.session.user.id);
        await refreshChatPins(state.activeChatId);
        showToast(isPinned ? 'Message unpinned.' : 'Message pinned.');
      } catch (error) {
        showToast(`Could not update pinned messages: ${friendlyError(error)}`);
      }
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
  $('reaction-details').addEventListener('click', (event) => {
    if (event.target.closest('.reaction-details-close')) closeReactionDetails();
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
    if (
      event.key.toLowerCase() === 'r'
      && !event.repeat
      && !event.target.matches('input, textarea, select, [contenteditable="true"]')
      && state.hoveredMessageId
      && document.querySelector(`.message[data-message-id="${CSS.escape(state.hoveredMessageId)}"]`)
    ) {
      event.preventDefault();
      setReplyTarget(state.hoveredMessageId);
    }
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
