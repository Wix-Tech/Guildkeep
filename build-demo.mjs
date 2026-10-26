#!/usr/bin/env node
/**
 * build-demo.mjs — bundle engine + corpus + UI into one self-contained demo.html.
 *
 * The demo has no network dependencies at all, which is why it runs inside the
 * sandboxed workspace preview (and can be emailed as a single file).
 *
 *   node product/build-demo.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = (f) => readFile(join(here, 'src', f), 'utf8');

/** Strip import/export-from statements so the modules can share one scope. */
function flatten(code) {
  return code
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^import\s+['"][^'"]+['"];?\s*$/gm, '')
    .trim();
}

const [engine, corpus, app, css] = await Promise.all([
  src('search-engine.mjs'),
  src('corpus.mjs'),
  src('app.mjs'),
  src('styles.css'),
]);

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Ember — messages</title>
<style>
${css}
</style>
</head>
<body>
  <div class="app-shell">
    <header class="app-topbar">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20.5 11.5a8.5 8.5 0 0 1-12.7 7.4L3 20l1.1-4.2A8.5 8.5 0 1 1 20.5 11.5Z" />
            <path d="M8 11.5h.01M12 11.5h.01M16 11.5h.01" />
          </svg>
        </span>
        <span class="brand-copy"><strong>EMBER</strong><span>Messages</span></span>
      </div>
      <div class="topbar-profile"><span>Personal workspace</span><span class="profile-avatar">M</span></div>
    </header>

    <main class="chat-layout">
      <aside class="chat-sidebar" aria-label="Chats and search">
        <div class="sidebar-heading">
          <h1>Chats</h1>
          <span class="online-label"><span class="online-dot"></span> All conversations</span>
        </div>
      <div class="searchbar">
        <label for="q">
          <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" />
          </svg>
          <input id="q" type="search" placeholder="Search messages, contacts and groups"
               autocomplete="off" spellcheck="false" aria-label="Search" />
        </label>
        <div id="spinner" class="spinner" hidden aria-label="Searching"></div>
      </div>

      <div class="chips">
        <button class="chip active" data-filter="all">All</button>
        <button class="chip" data-filter="messages">Messages</button>
        <button class="chip" data-filter="contacts">Contacts</button>
        <button class="chip" data-filter="groups">Groups</button>
        <button class="chip" data-filter="business">Business</button>
      </div>

      <div class="chat-list">
        <div id="empty"></div>
        <div id="results"></div>
        <button id="more" hidden>Load more</button>
      </div>
      <div id="debug" hidden></div>
      </aside>

      <section class="conversation" id="conversation" aria-label="Conversation preview">
        <div id="conversation-content" class="welcome">
          <div class="welcome-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20.5 11.5a8.5 8.5 0 0 1-12.7 7.4L3 20l1.1-4.2A8.5 8.5 0 1 1 20.5 11.5Z" />
              <path d="M8 11.5h.01M12 11.5h.01M16 11.5h.01" />
            </svg>
          </div>
          <h2>Stay close to every conversation</h2>
          <p>Search across your messages, people, and groups. Choose a result to open its conversation preview.</p>
          <div class="welcome-features">
            <div class="welcome-feature"><strong>Find it fast</strong>Search across messages and chats.</div>
            <div class="welcome-feature"><strong>Search smarter</strong>Find typos and related phrases.</div>
            <div class="welcome-feature"><strong>Pick up anytime</strong>Your recent searches are ready.</div>
          </div>
          <div class="keyboard-hint">Quick search <kbd>/</kbd></div>
        </div>
      </section>
    </main>
  </div>

  <div id="toast"></div>

<script type="module">
/* ---- search-engine.mjs ---- */
${flatten(engine)}

/* ---- corpus.mjs ---- */
${flatten(corpus)}

/* ---- app.mjs ---- */
${flatten(app)}
</script>
</body>
</html>
`;

await writeFile(join(here, 'demo.html'), html, 'utf8');
console.log(
  `wrote product/demo.html (${(html.length / 1024).toFixed(1)} kB, no external requests)`,
);
