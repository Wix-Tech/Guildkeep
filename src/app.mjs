/**
 * app.mjs — the search UI (ChatsSearchEngine + SearchFragment equivalent).
 *
 * Behaviour ported from WhatsApp:
 *  - a tokenized search bar with filter chips (TokenizedSearchInput)
 *  - debounced, cancellable queries (createSearchSession)
 *  - one section per result kind, staggered first page (PaginationStrategyStaggered)
 *  - "load more" paging driven by the page cursor (EngineState.hasMorePages)
 *  - recent searches when the field is empty (RecentSearchItemsManager)
 *  - a debug strip that shows the compiled FTS expression and hybrid counters
 *    (SearchPerformanceLogger's marker annotations, surfaced honestly)
 */

import {
  buildIndex,
  search,
  createSearchSession,
  normalize,
} from './search-engine.mjs';
import { corpus, recentSearches, DEMO_NOW } from './corpus.mjs';

const SECTION_META = {
  contacts: { label: 'Contacts', icon: '👤' },
  groups: { label: 'Groups', icon: '👥' },
  messages: { label: 'Messages', icon: '💬' },
  business: { label: 'Business accounts', icon: '🏪' },
};

const state = {
  query: '',
  page: 0,
  filters: { messages: true, contacts: true, groups: true, business: true },
  result: null,
  loading: false,
  selectedId: null,
};

const index = buildIndex(corpus);
const conversation = document.getElementById('conversation');
const conversationContent = document.getElementById('conversation-content');
const welcomeMarkup = conversationContent.innerHTML;

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

/** Highlight every query term (and its prefixes) in a string. */
function highlight(text, query) {
  const words = normalize(query)
    .split(' ')
    .filter((w) => w.length > 1 && !w.startsWith('-'));
  if (!words.length) return esc(text);
  const pattern = words
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .sort((a, b) => b.length - a.length)
    .map((w) => `${w}[\\p{L}\\p{N}]*`)
    .join('|');
  const re = new RegExp(`(${pattern})`, 'giu');
  return esc(text).replace(re, '<mark>$1</mark>');
}

function timeAgo(ts) {
  const diff = DEMO_NOW - ts;
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return `${Math.round(days / 7)}w`;
}

function avatar(name, hue = 200) {
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
  return `<span class="avatar" style="--hue:${hue}">${esc(initials)}</span>`;
}

function rowsWithHeaders(items) {
  let last = null;
  return items
    .map((item) => {
      const head =
        item.section !== last && item.section !== 'messages'
          ? `<div class="section-head">${SECTION_META[item.section].icon} ${SECTION_META[item.section].label}</div>`
          : '';
      last = item.section;
      return head + renderResultRow(item, state.query);
    })
    .join('');
}

function renderResultRow(item, query) {
  if (item.section === 'messages') {
    const chat = item.chat ?? { name: 'Chat', avatarHue: 200 };
    const who = item.doc.senderId === 'me' ? 'You' : item.doc.senderId;
    return `
      <button class="row" data-id="${esc(item.id)}" aria-pressed="${state.selectedId === item.id}">
        ${avatar(chat.name, chat.avatarHue)}
        <span class="row-main">
          <span class="row-top">
            <span class="row-title">${esc(chat.name)}</span>
            <span class="row-time">${timeAgo(item.doc.timestamp)}</span>
          </span>
          <span class="row-sub">${highlight(item.doc.text, query)}</span>
        </span>
        ${item.matchKind !== 'fts' ? `<span class="badge ${item.matchKind}">${item.matchKind}</span>` : ''}
      </button>`;
  }

  const c = item.doc;
  const kindLabel =
    c.kind === 'business' ? 'Business account' : c.kind === 'group' ? 'Group' : 'Contact';
  return `
    <button class="row" data-id="${esc(item.id)}" aria-pressed="${state.selectedId === item.id}">
      ${avatar(c.name, c.kind === 'business' ? 12 : c.kind === 'group' ? 280 : 150)}
      <span class="row-main">
        <span class="row-top">
          <span class="row-title">${highlight(c.name, query)}</span>
        </span>
        <span class="row-sub">${esc(kindLabel)}${c.about ? ` · ${highlight(c.about, query)}` : ''}</span>
      </span>
      ${item.matchKind !== 'fts' ? `<span class="badge ${item.matchKind}">${item.matchKind}</span>` : ''}
    </button>`;
}

function clearConversation() {
  state.selectedId = null;
  conversation.classList.remove('is-open');
  conversationContent.className = 'welcome';
  conversationContent.innerHTML = welcomeMarkup;
}

function openConversation(item) {
  const name =
    item.section === 'messages'
      ? item.chat?.name ?? corpus.chats.find((candidate) => candidate.id === item.doc.chatId)?.name ?? 'Chat'
      : item.doc.name;
  const matchedChat = item.section === 'messages'
    ? item.chat
    : corpus.chats.find((candidate) => candidate.name === name);
  const chat =
    matchedChat ??
    corpus.chats.find((candidate) => candidate.name === name || candidate.id === item.doc.chatId);

  state.selectedId = item.id;
  conversation.classList.add('is-open');

  if (!chat) {
    conversationContent.className = 'contact-card';
    conversationContent.innerHTML = `
      ${avatar(name, item.doc.kind === 'business' ? 12 : item.doc.kind === 'group' ? 280 : 150)}
      <h2>${esc(name)}</h2>
      <p>${esc(item.doc.about || 'No profile details available.')}</p>`;
    return;
  }

  const messages = corpus.messages
    .filter((message) => message.chatId === chat.id)
    .sort((a, b) => a.timestamp - b.timestamp);
  const messageRows = messages
    .map((message) => {
      const isOutgoing = message.senderId === 'me';
      const sender = corpus.contacts.find((contact) => contact.id === message.senderId)?.name ?? chat.name;
      return `
        <div class="message ${isOutgoing ? 'outgoing' : ''} ${message.id === item.doc.id ? 'match' : ''}">
          ${!isOutgoing && chat.kind === 'group' ? `<span class="message-sender">${esc(sender)}</span>` : ''}
          <span>${highlight(message.text, state.query)}</span>
          <span class="message-meta">${new Date(message.timestamp).toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })}</span>
        </div>`;
    })
    .join('');

  conversationContent.className = 'conversation-view';
  conversationContent.innerHTML = `
    <div class="conversation-head">
      <button class="conversation-back" type="button" aria-label="Back to chats">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="m15 18-6-6 6-6" />
        </svg>
      </button>
      ${avatar(chat.name, chat.avatarHue)}
      <div class="conversation-title">
        <strong>${esc(chat.name)}</strong>
        <span>${chat.kind === 'group' ? 'Group conversation' : chat.kind === 'business' ? 'Business conversation' : 'Conversation'} · read-only preview</span>
      </div>
    </div>
    <div class="conversation-body">
      <div class="day-label">Conversation preview</div>
      ${messageRows || '<div class="loading">No messages in this conversation yet.</div>'}
    </div>
    <div class="conversation-note">The matching message is outlined in burnt orange. This demo preview is read-only.</div>`;
}

function render() {
  const list = document.getElementById('results');
  const empty = document.getElementById('empty');
  const res = state.result;

  if (!state.query.trim()) {
    clearConversation();
    empty.innerHTML = `
      <div class="empty-block">
        <div class="empty-title">Search messages, contacts and groups</div>
        <div class="chips recent">
          ${recentSearches
            .map((q) => `<button class="chip ghost" data-recent="${esc(q)}">${esc(q)}</button>`)
            .join('')}
        </div>
        <p class="hint">
          Try <code>sourd</code> (prefix), <code>"distance threshold"</code> (phrase),
          <code>index -rebuild</code> (negation), <code>from:Adebayo</code> (field),
          or <code>rebuilt indexing</code> (semantic only).
        </p>
      </div>`;
    empty.hidden = false;
    list.innerHTML = '';
    document.getElementById('debug').hidden = true;
    return;
  }

  empty.hidden = true;
  if (!res) {
    list.innerHTML = '<div class="loading">Searching…</div>';
    return;
  }

  if (res.total === 0) {
    list.innerHTML = `<div class="loading">No results for “${esc(res.query)}”.</div>`;
  } else {
    list.innerHTML = rowsWithHeaders(res.items);
  }

  const more = document.getElementById('more');
  more.hidden = res.nextCursor === null;
  more.textContent = res.nextCursor === null ? '' : 'Load more';

  const dbg = document.getElementById('debug');
  dbg.hidden = false;
  dbg.innerHTML = `
    <div class="dbg-line"><span class="dbg-k">compiled</span> <code>${esc(res.ftsQuery || '—')}</code></div>
    <div class="dbg-line">
      <span class="dbg-k">layers</span>
      fts <b>${res.debug.ftsCount}</b> ·
      fuzzy <b>${res.debug.fuzzyHits}</b> ·
      semantic <b>${res.debug.semanticHits}</b> ·
      fused <b>${res.debug.fusedCount}</b>
    </div>
    <div class="dbg-line"><span class="dbg-k">page</span> ${res.page + 1} · ${res.total} total · ${res.debug.elapsedMs} ms</div>`;
}

const session = createSearchSession(index, {
  debounceMs: 250,
  onResults(result, meta) {
    state.loading = false;
    if (state.page === 0) state.result = result;
    else {
      // append the next page (staggered continuation)
      state.result = {
        ...result,
        items: [...state.result.items, ...result.items],
        total: result.total,
        nextCursor: result.nextCursor,
        page: result.page,
        sections: result.sections,
        debug: result.debug,
      };
    }
    document.getElementById('spinner').hidden = true;
    if (meta?.fromCache) state.result.debug = { ...state.result.debug, cached: true };
    render();
  },
  onStart() {
    document.getElementById('spinner').hidden = false;
  },
});

function requestResults(page = 0) {
  state.page = page;
  if (page === 0) {
    state.result = null;
    render();
  }
  session.update(state.query, { filters: state.filters, page });
}

function wire() {
  const input = document.getElementById('q');

  input.addEventListener('input', () => {
    state.query = input.value;
    state.result = null;
    clearConversation();
    if (!state.query.trim()) {
      session.cancel();
      render();
      return;
    }
    requestResults(0);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      input.value = '';
      state.query = '';
      state.result = null;
      render();
    }
  });

  for (const chip of document.querySelectorAll('[data-filter]')) {
    chip.addEventListener('click', () => {
      const key = chip.dataset.filter;
      if (key === 'all') {
        state.filters = { messages: true, contacts: true, groups: true, business: true };
      } else {
        state.filters = {
          messages: false,
          contacts: false,
          groups: false,
          business: false,
          [key]: true,
        };
      }
      clearConversation();
      for (const c of document.querySelectorAll('[data-filter]')) {
        c.classList.toggle('active', c.dataset.filter === key);
      }
      if (state.query.trim()) requestResults(0);
    });
  }

  document.getElementById('results').addEventListener('click', (e) => {
    const row = e.target.closest('.row');
    if (!row) return;
    const item = state.result?.items.find((result) => result.id === row.dataset.id);
    if (item) {
      openConversation(item);
      render();
    }
  });

  conversation.addEventListener('click', (e) => {
    if (!e.target.closest('.conversation-back')) return;
    clearConversation();
    render();
  });

  document.getElementById('empty').addEventListener('click', (e) => {
    const recent = e.target.closest('[data-recent]');
    if (recent) {
      input.value = recent.dataset.recent;
      state.query = input.value;
      state.result = null;
      clearConversation();
      render();
      requestResults(0);
    }
  });

  document.getElementById('more').addEventListener('click', () => {
    if (state.result?.nextCursor != null) requestResults(state.result.nextCursor);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== input) {
      e.preventDefault();
      input.focus();
    }
  });
}

function toast(text) {
  const el = document.getElementById('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 1400);
}

wire();
render();
document.getElementById('q').focus();
