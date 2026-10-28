# Guildkeep, hybrid search, and group admin

The hosted client uses Supabase for authentication, Postgres, and real-time
messaging. The offline search demo is a separate port of the WhatsApp Android
search architecture (see [`../EVIDENCE.md`](../EVIDENCE.md)).

Two features live here:

1. **Hybrid search** (below) — ported from the WhatsApp search architecture in `../EVIDENCE.md`.
2. **Group admin bot** — admin-only commands to lock/open a group, post to the group status,
   add/kick/ban members, warn, mute, slow-mode, moderate links, and undo. See
   [Group admin bot](#group-admin-bot).

```
product/
├─ db/schema/*.sql         the schema, applied in order by the migration runner
├─ db/db.mjs               open / migrate / re-entrant transactions (node:sqlite)
├─ db/repository.mjs       adapters: DB ⇄ bot, DB ⇄ search index (SQLite)
├─ db/pg.mjs               the same contract for PostgreSQL (tsvector, JSONB, BOOLEAN)
├─ db/pg/schema.sql        the PostgreSQL schema
├─ db/open.mjs             openRepository(): DATABASE_URL picks the engine
├─ db/migrate.mjs          `npm run db:migrate`
├─ db/seed.mjs             demo group + chats + 21 messages (`--reset` to wipe)
├─ db/demo.mjs             end-to-end walkthrough: command → effects → SQL rows
├─ data/app.db             the dev database (created by migrate/seed)
├─ src/group-admin.mjs     the admin bot — command table, permissions, moderation gates
├─ index.html              hosted chat app entry point
├─ src/live-app.mjs        Supabase auth, chat list, messages, and realtime client
├─ src/supabase-chat.mjs   Supabase data access
├─ src/live-styles.css     hosted chat app styles
├─ brand/                  Guildkeep logos, icons, and brand sheet
├─ db/supabase/            hosted chat schema, RLS, and RPC migrations
├─ supabase/functions/     authenticated Edge Functions, including Tenor GIF search
├─ vercel.json             Vercel static build settings
├─ src/admin-app.mjs       the console UI
├─ src/admin-styles.css    console styles
├─ build-admin-demo.mjs    → admin-demo.html
├─ admin-server.mjs        bot HTTP API (reads/writes the database; port 8788)
├─ admin-demo.html         the built console
├─ test/group-admin.test.mjs  30 behavioural tests
├─ test/admin-bundle.test.mjs  bundle smoke test (drives the real UI code)
├─ src/search-engine.mjs   the engine — tokenizer, query compiler, inverted index,
│                          bigram fuzzy layer, vector layer, ranking, staggered paging
├─ src/corpus.mjs          deterministic demo dataset (13 chats / 17 contacts / 55 messages)
├─ src/app.mjs             the UI (search bar, filter chips, sections, recent searches)
├─ src/styles.css          styles for the demo
├─ build-demo.mjs          bundles engine + corpus + UI → demo.html (no external requests)
├─ server.mjs              search HTTP API (reads the database) + static host
├─ demo.html               the built, self-contained demo
├─ Dockerfile              production image (node:22-alpine, no dev deps)
├─ docker-compose.yml      real Postgres + both servers, one command
├─ .env.example            DATABASE_URL, ports, pool size
└─ test/                   100 tests (node:test): search, bot, bundles, SQLite, Postgres, RLS
```

## Run

New here? [`../QUICKSTART.md`](../QUICKSTART.md) is the two-minute version —
`cd product && npm start` and click the printed link. No install needed.

```bash
npm --prefix product start              # migrate + seed if needed, run both servers
npm --prefix product install            # install Supabase, Vite, PGlite, and optional pg
npm --prefix product run db:reset       # migrate + seed the SQLite dev DB
npm --prefix product test               # run the test suite
npm --prefix product run build          # build both demos and hosted chat app
npm --prefix product run serve:search   # http://0.0.0.0:8787
npm --prefix product run serve:admin    # http://0.0.0.0:8788
```

The bundled `demo.html` remains an offline, read-only search preview. The separate
`index.html` app is the hosted real-time client: Supabase Auth, separate
one-to-one chats, groups, public channels, contact-only status updates, profile
photos, media and voice-note messages, reactions, read receipts, typing
indicators, member-only online presence, and message actions for
editing, deleting, and forwarding. Group and channel admins can edit names,
descriptions, visibility, chat pictures, posting controls, and rules from the
details screen. Users can choose contacts-only or private status visibility and
delete their own active status posts. Messages can also be replied to from the
action menu, by swiping right on mobile, or with the desktop reply shortcut;
quote previews jump to the original message and show “Message deleted” when it
was removed. Profile photos, chat attachments, and status
media are limited to 25 MB per file. Chat attachments support multiple
selection, drag-and-drop, previews with removal, upload progress, and retrying
failed files. Status updates expire after 24 hours;
voice notes can be recorded by holding the microphone, sent on release, or
cancelled by sliding left. Their waveform, duration, scrubbing, and 1×/1.5×/2×
playback speed are stored with each message; failed sends keep a retry action.
The composer has emoji, sticker, and GIF tabs. Emoji recents are stored in the
browser; eight original, local SVG stickers render at 120 px without a message
bubble. GIF search runs through the authenticated `tenor-search` Supabase Edge
Function, keeps the Tenor key server-side, and loads selected GIFs from Tenor's
CDN. Search terms are sent to Tenor; GIF search requires a `TENOR_API_KEY`
Supabase Function secret and displays an error if the function or key is not
configured. The picker displays Tenor's "Search Tenor" and "Powered By Tenor"
attribution, and each shared GIF includes "Via Tenor". Never put this key in a
`VITE_` variable or commit it.
Message URLs render as local domain cards without fetching remote metadata or
images. Only public-domain HTTP(S) links become clickable; unsafe/local targets
remain plain text.
Group owners can add and remove
members, assign admins, lock/open posting, enable announcement mode, configure
slow mode and anti-link, set rules, rename the group, and post text statuses.
Channel owners/admins can publish; channel invite links can be shared. Group,
channel, status, and media access rules are enforced in Postgres and Supabase
Storage policies, not trusted to the browser. The app uses Telegram-style
category navigation, including a mobile bottom bar, and a dark-only
black/burnt-orange theme. Searching from the chat list also finds
people by display-name or username prefix; **Message** opens the direct
conversation and focuses its composer. Message search is available from the
conversation header and top bar, searches either the active conversation or
accessible conversations, matches word prefixes, and opens the selected message
with a two-second highlight. Typing `@` in a direct or group chat suggests its
members; selecting a name inserts their username mention. The notification bell
lists unread mentions and jumps to the selected message.
Messages can be pinned in direct chats; only group or channel owners and
admins can pin or remove pins there. Pinned messages are shared with chat
members, update live, and can be opened from the conversation banner.
Chat-list actions can mark a conversation unread for the current member without
changing another participant's read receipt. The conversation shows a divider
at the first received message after the read cursor; unread totals count
received messages, not messages sent by the current user. Per-chat mute hides
the numeric chat-row badge but retains an unread dot. The top-bar chat badge and
document title show the aggregate unread message count.
Opening a chat member's profile shows their about and last-seen details,
common groups, and shared media, links, and files in a responsive side panel or
mobile bottom sheet. Shared content is limited server-side to chats both people
can access.

### Hosted chat app (Supabase + Vercel)

1. Create a Supabase project, then run `db/supabase/001_chat_app.sql`,
   `db/supabase/002_profile_search.sql`,
   `db/supabase/003_groups_profile_reactions.sql`, and
   `db/supabase/004_channels_media_status.sql`, then
   `db/supabase/005_chat_and_status_settings.sql` and
   `db/supabase/006_profile_preview.sql` and
   `db/supabase/007_chat_reaction_scoping.sql`, and
   `db/supabase/008_message_replies.sql` and
   `db/supabase/009_read_typing_presence.sql` and
   `db/supabase/010_message_search.sql`, and
   `db/supabase/011_pinned_messages.sql`, and
   `db/supabase/012_mark_chat_unread.sql`, and
   `db/supabase/013_mentions_notifications.sql`,
   `db/supabase/014_chat_pin_limit.sql`, and
   `db/supabase/015_unread_behavior.sql`, and
   `db/supabase/016_voice_note_metadata.sql` in order in its SQL Editor. To roll
   back message replies, run `db/supabase/008_message_replies.down.sql`; to
   roll back reaction scoping, run
   `db/supabase/007_chat_reaction_scoping.down.sql`; to roll back read receipts
   and private chat-live policies, run
   `db/supabase/009_read_typing_presence.down.sql`; to roll back message search,
   run `db/supabase/010_message_search.down.sql`; to roll back pinned messages,
   run `db/supabase/011_pinned_messages.down.sql`. The
   mark-unread function can be removed with
   `db/supabase/012_mark_chat_unread.down.sql`; mention notifications can be
   removed with `db/supabase/013_mentions_notifications.down.sql`; the pin
   limit and unread behavior can be rolled back with the corresponding
   `014_chat_pin_limit.down.sql` and `015_unread_behavior.down.sql` files.
   Voice-note metadata can be removed with
   `db/supabase/016_voice_note_metadata.down.sql`. The
   migrations create the chat tables, secure profile search and direct-chat
   RPCs, profile trigger, row-level security policies, group roles/admin
   commands, message reactions, invite flows, channels, contact-only statuses,
   chat-avatar storage, admin settings RPCs, status privacy controls, profile
   preview data/actions, read receipts, private chat-live Realtime policies,
   recipient-only mention notifications for direct and group chats, per-chat
   mute preferences, and unread indicators.
   Read receipts are visible only to members of the same chat; typing and
   presence use private per-chat channels and are never stored as message rows.
   Message replies are
   constrained to the same chat, retain a deleted-message quote for soft
   deletes, and clear the reference when the original is hard deleted. Reaction
   scoping backfills each reaction's chat ID from its message, enforces that relationship, and
   enables chat-filtered Realtime updates. Message search stores a generated
   `tsvector`, indexes it with GIN, enforces membership/public-channel access in
   its RPC, and limits queries to 100 characters and pages to 50 results.
2. Copy `.env.example` to `.env.local` and set `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` from the Supabase project API settings. These are
   browser-visible client settings; never use a Supabase secret/service-role key.
3. Run `npm run dev:web` in `product/` to test locally. Build with
   `npm run build:web`; Vercel is configured by `vercel.json` to serve `dist/`.
4. Import the project into Vercel with `product/` as the project root and add the
   same two `VITE_` variables to the Vercel project's environment settings.
   Configure the Supabase Auth site URL and redirect URLs to include the local
   development origin and the deployed Vercel domain.
   For Tenor GIF search, create a Tenor API key, add it as the `TENOR_API_KEY`
   secret under Supabase **Edge Functions → Secrets**, then deploy the function
   with `supabase functions deploy tenor-search --project-ref <project-ref>`.
   Do not add the Tenor key to `.env.local`, Vercel `VITE_` settings, or source
   control. GIF search is authenticated and sends search terms to Tenor.
5. Create two accounts using distinct usernames. Search for the other account
   in the chat list or choose **New chat**; select **Message**, then send a
   message in the conversation composer.
6. Use **New group** to create a group. Share its invite link from group details;
   admins can type `/help` in a group conversation to see available commands.
7. Test multi-file attachments by selecting and dragging files into a chat,
   previewing/removing queued items, observing upload progress, and retrying an
   intentionally failed upload. Confirm each file sends as its own message.
   Test status and voice-note flows with files under 25 MB. Apply all
   sixteen SQL migrations before testing channels, group/channel settings,
   profile photos, statuses, message media, and replies.
8. In two accounts, open the same direct chat. Scroll the recipient to the
   bottom to send a read receipt; confirm the sender sees a grey sent tick turn
   orange with two ticks. Type in the composer to confirm the other member sees
   a temporary typing indicator, then verify online/last-seen details.
9. Send multiple messages from one account, then open the receiving account's
   chat list. Confirm the unread total appears in the top bar and document
   title, the row shows the unread count, and the conversation divider appears
   before the first unread message. Mute that chat and confirm its number is
   replaced by a dot; unmute it and scroll to the bottom to clear the divider
   and unread count.

Email confirmation behavior is controlled by the Supabase Auth project settings.
The client never contains a service-role key. Direct chat creation and message
visibility are enforced in Postgres with row-level security.

Either server runs on PostgreSQL instead, with no code change:

```bash
DATABASE_URL=postgres://app:app@localhost:5432/app npm run serve:search
docker compose up --build               # real Postgres + both servers
```

## API

```
GET /api/search?q=sourd&page=0&pageSize=20&messages=true&contacts=true&groups=true&business=true&chat=ch9
GET /api/health
```

```json
{
  "query": "sourd",
  "ftsQuery": "content:sourd*",
  "items": [
    { "id": "msg:m1038", "section": "messages", "matchKind": "fts", "score": 1.79, "doc": { ... } },
    { "id": "contact:b1", "section": "business", "matchKind": "fts", "score": 1.73, "doc": { ... } }
  ],
  "total": 2,
  "nextCursor": null,
  "debug": { "ftsCount": 2, "fuzzyHits": 0, "semanticHits": 2, "fusedCount": 2, "elapsedMs": 26.8 }
}
```

`matchKind` is `fts` | `fuzzy` | `semantic` — the client uses it to badge results, and you
use it to measure each layer the way WhatsApp's `SemanticSearchResultsInfo` counters do.

## Query syntax (mirrors the FTS expression WhatsApp compiles)

| You type | Compiles to | Meaning |
|---|---|---|
| `search eng` | `content:search content:eng*` | implicit AND, prefix on the **last** token |
| `"distance threshold"` | `content:"distance threshold"` | adjacency-scored phrase |
| `index -rebuild` | `content:index -content:rebuild` | negation, applied to **every** layer |
| `from:adebayo` | `from:adebayo` | field filter (`from:`, `in:`, `is:`, `has:`) |
| `Ribiero` | (bigram layer) | typo tolerance, contacts only |

## Swapping in your own data

`buildIndex()` wants exactly three arrays:

```js
import { buildIndex, search } from './src/search-engine.mjs';

const index = buildIndex({
  chats:    [{ id, name, kind: 'direct'|'group'|'business'|'channel', pinned?, avatarHue? }],
  contacts: [{ id, name, kind: 'person'|'group'|'business', about?, tags?, phone?, lastActiveAt? }],
  messages: [{ id, chatId, senderId, text, timestamp }],
});

search(index, { query: 'sourdough', filters: { messages: true } });
```

For a few hundred thousand messages this index is fine in memory. Past that, keep the
same API and back `search()` with SQLite FTS5 (`fts5(tokenize='unicode61', prefix='2 3')`)
— the query compiler, ranking merge, pagination and UI do not change.

## Keeping the index fresh (the part people forget)

WhatsApp tokenizes in a **durable background job keyed by rowId/sortId** and lets contacts go
stale in a `fts_dirty_version` column that a drain job batches (975 rows at a time). The
equivalent here:

- **insert/update** → add the document to the index in the same transaction that writes the row;
  never re-tokenize the whole corpus for one edit.
- **delete** → remove postings for that docId (or keep a tombstone and filter at query time).
- **migration** → version your tokenizer (`fts_ready` in WhatsApp). If the tokenizer changes,
  write a new column/table and flip the version — otherwise old rows become unsearchable.
- **repair** → keep a rebuild path (`DbRepairEngine/rebuildFtsTables`) and run "optimize" after
  large deletes so the index does not grow forever.

## Deliberate differences from WhatsApp

| WhatsApp | Here | Why |
|---|---|---|
| on-device embedding model | hashed char-trigram vectors (`embed`) | no model to ship; the interface (kNN + distance threshold) is identical, so you can swap in a real embedder later |
| FTS4 `MATCH` in SQLite | in-memory inverted index | same semantics (AND + prefix + phrase + negation), no native dependency |
| 3 counters logged to analytics | `debug` block on every response | same idea, visible in the UI |
| contacts-only bigram index | same | groups/business reuse it via `kind` |

## Next steps if this goes into production

1. **Measure before tuning**: keep `ftsCount` / `semanticHits` / `fusedCount` and log
   zero-result queries — that is the single most useful signal.
2. Debounce per input, and cancel in flight (`createSearchSession` already does last-write-wins).
3. Cap the query (`compileQuery` truncates at 4096 chars) and never let a user string
   reach the FTS parser unescaped.
4. Put the server endpoint behind the same engine, and make the client prefer the local
   index for the first page so the UI never waits on the network.


---

# Group admin bot

`product/src/group-admin.mjs` — one state machine plus a declarative command table.
Pure and deterministic (clock is injectable), so it is testable and safe to embed.

```js
import { createGroupBot } from './src/group-admin.mjs';

const bot = createGroupBot({
  group: { id: 'g1', name: 'Design Guild' },
  members: [
    { id: 'u0', name: 'Nadia', role: 'owner',  phone: '+234 801 000 0001' },
    { id: 'u1', name: 'Adebayo', role: 'admin', phone: '+234 801 000 0002' },
    { id: 'u2', name: 'Tomás', role: 'member', phone: '+234 801 000 0003' },
  ],
  settings: { rules: '1. Be kind.', welcome: 'Welcome {name}!' },
});

bot.handle({ authorId: 'u1', text: '/lock maintenance' });
// { ok: true, message: '🔒 Group locked by Adebayo (maintenance)…',
//   effects: [{ type: 'group_locked', reason: 'maintenance' }] }

bot.receive({ authorId: 'u2', text: 'hello' });
// { action: 'delete', reason: 'group_locked' }
```

Run the console: `node product/build-admin-demo.mjs` then open `admin-demo.html`
(in-memory, no database needed), or `node product/admin-server.mjs` for the
DB-backed HTTP API (port 8788).

## Commands

| Command | Level | What it does |
|---|---|---|
| `/help [cmd]` | everyone | list commands **you** may run |
| `/rules` | everyone | print the stored rules |
| `/stats` | admin | group health block (members, posting mode, slow, anti-link, warnings) |
| `/lock [reason]` · `/open` | admin | admins-only posting, and back |
| `/announce on\|off` | admin | announcement mode (admins post, members read) |
| `/slowmode off\|10s\|1m\|5m` | admin | per-member posting cooldown |
| `/antilink on\|off` | admin | delete member messages containing links (+1 warning) |
| `/status <text>` · `/status clear` | admin | post to the **group status** (24h TTL) |
| `/add +phone [name]` | admin | add a member (validates + dedupes, posts welcome) |
| `/kick @member [reason]` | admin | remove a member (⚠ needs confirm) |
| `/ban @member` · `/unban @member` | admin | remove + block from posting; lift it |
| `/mute @member [10m]` · `/unmute` | admin | silence, optionally timed |
| `/warn @member` · `/warns` · `/clearwarns` | admin | warnings, auto-mute/kick at the limit |
| `/promote @member` | admin | make an admin |
| `/demote @admin` · `/rename <name>` · `/purge <n\|all>` | **owner** | admin rights, group name, message purge |
| `/pin <text\|off>` · `/tagall [msg]` · `/invite reset` | admin | pinned message, mention all, rotate invite link |
| `/setrules <text>` · `/welcome <text\|off>` | admin | rules and join message (`{name}` placeholder) |
| `/audit [n]` · `/undo` · `/confirm` · `/cancel` | admin | who did what, revert, confirm prompts |

## Safety rules baked in

- **Permissions before arguments** — a member cannot probe for member lists by passing bad args.
- **Rank ordering** — admins outrank members; only the owner touches admins, the owner is untouchable.
- **Two-step destructive commands** — `kick`, `ban`, `purge`, `invite reset` park the intent and
  require `/confirm` within 30 s (or `--yes`) before anything changes.
- **Muted members cannot run commands** either — muting is not cosmetic.
- **Every mutation is an effect** (`group_locked`, `member_removed`, `group_status_post`, …) that you
  persist yourself, and **every executed command is audited** with actor/target/detail.
- **Undo** covers lock/announce/slow/anti-link/kick/ban/mute/add/role/rename/status.

## Wiring it to a real messenger

1. On an inbound group message: `bot.handle()` if it starts with `/`, else `bot.receive()`.
2. If `receive()` says `delete`, delete the message and optionally reply with the reason
   (`group_locked`, `muted`, `anti_link`, `slow_mode`, `banned`).
3. Apply the `effects` array in the same transaction as your own state (post the status, add the
   member, rotate the invite, …). Nothing in the bot touches storage directly.
4. Keep one bot instance per group, and load members/roles from your DB on cold start.

## A note on provenance

The search feature is a **clean-room reimplementation** of behaviour observed from a released
binary — no WhatsApp source code, assets or strings are copied into `product/`, and the decompiled
excerpts in `../evidence/` are kept for analysis/provenance only. The admin bot is not modelled on
WhatsApp at all; it is a conventional command bot (Telegram-style `/commands`) built for this
project. Nothing here needs the APK to run.


---

# Data model and persistence

Everything above is pure logic. This is what makes it survive a restart.

```bash
npm --prefix product run db:migrate     # create/upgrade product/data/app.db
npm --prefix product run db:seed        # demo group, 10 users, 6 chats, 21 messages
npm --prefix product run db:demo        # command → effects → the SQL rows it wrote
npm --prefix product test               # 85 tests: search, bot, SQLite, PostgreSQL
```

The SQLite path has no dependencies: it uses **`node:sqlite`**, built into Node
22.5+. If your runtime lacks it, replace `product/db/db.mjs` with a
`better-sqlite3` shim — nothing else imports a driver.

PostgreSQL needs one: `pg` (optional dependency, already in `package.json`) for a
real server, or `@electric-sql/pglite` (dev dependency) to run Postgres in-process
with no server at all.

## Tables

```
users ─────┬──────────── group_members ──────────── groups ──── group_settings (1:1)
           │                  │                        │
           │                  │                        ├─────── group_statuses
           │                  │                        ├─────── warnings
           │                  │                        ├─────── audit_log
           │                  │                        ├─────── pending_actions
           │                  │                        └─────── undo_stack
           │                  │
           └──────────── messages ──── chats ───────────┘ (chats.group_id)
                              │
                              └──── message_fts (FTS5, content='messages',
                                                 content_rowid='sort_id')
```

| Table | Why it exists |
|---|---|
| `users` | people **and** business accounts (`kind`), unique phone |
| `groups` | identity + invite state (`invite_epoch`, `invite_token`) |
| `group_settings` | one row per group: `locked`, `announcement`, `slow_seconds`, `anti_link`, `welcome`, `rules`, `warn_limit`, `warn_action`, pinned message |
| `group_members` | role, mute (with `muted_until`), ban, join/last-post time |
| `warnings` | append-only; the bot derives counts and escalation from it |
| `group_statuses` | the 24 h group status feed |
| `audit_log` | every command attempt, allowed or denied, with the effects it produced |
| `pending_actions` | parked `/confirm` prompts — a destructive action must not evaporate on deploy |
| `undo_stack` | `/undo` works across requests, not just within one |
| `chats` | direct / group / business / channel threads; one chat per group |
| `messages` | `sort_id` is the immutable ordering key, `deleted` is a soft delete |
| `message_fts` | FTS5 index over message text, kept in sync by triggers |

## Four decisions worth keeping

**1. Never index by a mutable key.** `messages.id` is a stable string, but the
search index is keyed by `sort_id` (monotonic INTEGER). Re-keying, merging
chats or importing history never invalidates the index — you just append.

**2. The FTS index is maintained by the database, not the app.**
`message_fts` is FTS5 with `content='messages'`, `content_rowid='sort_id'`, and
three triggers (insert / delete / update). Application code never writes to the
index, so it cannot drift. `POST /api/reindex` runs FTS5's `rebuild` if you ever
need to re-derive it.

> Gotcha: on an external-content FTS5 table, `SELECT COUNT(*) FROM message_fts`
> returns the **content** row count, not index membership. Always probe with
> `WHERE message_fts MATCH ?`. One of the tests exists purely to document this.

**3. The bot never touches SQL, and the repository never parses a command.**
`group-admin.mjs` returns `effects`; `repository.applyEffects()` maps each effect
to rows inside one transaction. Adding a command means adding an effect type, and
the adapter stays the only place that knows column names.

**4. Confirmations and undo are state, so they live in the database.**
A `/kick` prompt is a `pending_actions` row with a 30 s expiry; the undo stack is
mirrored to `undo_stack` after every command. Restart the server mid-flow and
`/confirm` still lands.

## Two databases, one contract

`db/open.mjs` decides the engine from `DATABASE_URL`; every route and every
adapter call is identical afterwards.

```js
import { openRepository } from './db/open.mjs';

const repo = await openRepository();                 // DATABASE_URL decides
const repo2 = await openRepository('sqlite::memory:');           // SQLite
const repo3 = await openRepository('postgres://app:app@db/app'); // PostgreSQL
```

| | SQLite (`db/repository.mjs`) | PostgreSQL (`db/pg.mjs`) |
|---|---|---|
| when | dev, single box, tests | production, several app instances |
| driver | `node:sqlite` (built in) | `pg` (optional dep) — or PGlite, Postgres compiled to WASM, for CI with no server |
| text search | FTS5 `MATCH "sourd"*` | generated `search_tsv` + GIN, `@@ to_tsquery('simple','sourd:*')` |
| booleans | `INTEGER` 0/1 | `BOOLEAN` |
| JSON columns | `TEXT` + `JSON.stringify` | `JSONB` |
| ordering key | `sort_id` AUTOINCREMENT | `sort_id` GENERATED ALWAYS AS IDENTITY |
| paging | `sort_id < ?` | `sort_id < $1` |

Both expose the same methods — `migrate, seed, transaction, loadGroupBot,
applyEffects, syncPendingActions, syncUndoStack, recordAudit, loadAudit,
snapshotGroup, loadSearchCorpus, searchCandidates, rebuildSearchIndex, raw`
— and `test/pg.test.mjs` proves it: it replays a 10-command script and the
same search queries on both engines and asserts the resulting group state and
ranked results are identical.

Notes from building it, worth knowing before you deploy:

- **Only `?` in `raw()`.** The PG adapter rewrites `?` to `$1…$n`, so hand-written
  SQL in shared code keeps working. Internal adapter code uses `$n` directly.
- **Quote your aliases.** `AS "chatId"` — PostgreSQL folds unquoted identifiers to
  lowercase, so `/api/fts` would otherwise return `chatid` on PG and `chatId`
  on SQLite.
- **`WHERE NOT deleted`** is the one spelling both engines accept for a boolean
  column (`deleted = 0` is a type error on PG).
- **No `timestamptz`.** Timestamps stay epoch-milliseconds `BIGINT` on both, so
  JavaScript numbers round-trip without timezone drift.
- **Settings effects upsert.** A group without a `group_settings` row used to
  accept `/lock` and change nothing, because every settings effect is an
  `UPDATE`. Both adapters now insert the row first; a regression test covers it.
- **PGlite is one process.** It is a WASM Postgres with a fixed heap; two
  instances in one 2 GB sandbox get OOM-killed. Use `pg` (or Docker) for
  anything that needs more than one connection.

### Picking a driver in dev

| Situation | What happens |
|---|---|
| `DATABASE_URL` unset | SQLite at `product/data/app.db` |
| `DATABASE_URL=postgres://…`, `pg` installed | connects to that server |
| `DATABASE_URL=postgres://…`, no `pg` | falls back to in-process PGlite |
| `PGLITE=1` | forces in-process PGlite (no data survives a restart) |
| `SEED_ON_EMPTY=1` | seeds the demo fixtures into an empty database on boot |

## Going live

A checklist, in the order the failures actually bite:

1. **Run migrations at boot, not by hand.** `openRepository()` already calls
   `migrate()`; the SQLite runner is idempotent (`db/migrate.mjs --status` shows
   what is applied) and the PG schema is `CREATE … IF NOT EXISTS` throughout.
2. **One process per container, replicas behind a load balancer.** Both servers
   are stateless apart from the database; `/undo` and `/confirm` live in rows,
   so any replica can serve the next request.
3. **Do not seed in production.** Leave `SEED_ON_EMPTY` unset — it only exists so
   `docker compose up` gives you something to click.
4. **Watch the search signal, not the CPU.** Log zero-result queries and
   `debug.ftsCount` / `debug.semanticHits`; that is what tells you whether the
   prefix or the fuzzy layer is doing the work.
5. **Cap what reaches the parser.** `compileQuery` truncates at 4096 chars; both
   FTS paths quote every token, so a user string can never inject an operator.
6. **Backups are the schema's job, not the app's.** `pg_dump` for PostgreSQL,
   `.backup` (or copy the WAL-consistent file) for SQLite.

## The adapter contract

```js
import { loadGroupBot, applyEffects, syncPendingActions, syncUndoStack, recordAudit } from './db/repository.mjs';

const bot = loadGroupBot(db, 'g_design');           // state ← rows
const result = bot.handle({ authorId, text });       // pure logic
applyEffects(db, { groupId, actorId, effects: result.effects });   // rows ← effects
syncPendingActions(db, { groupId, bot });            // parked /confirm prompts
syncUndoStack(db, { groupId, bot });                 // /undo survives restarts
recordAudit(db, { groupId, actorId, command: result.command, ok: result.ok });
```

That is exactly what `admin-server.mjs` does per request (see `handleCommand`) —
through `repo.*`, so the same code path runs on SQLite and PostgreSQL. The
SQLite functions above are the reference implementation; `db/pg.mjs` mirrors
them one-for-one with `$n` placeholders.

## Search against the database

```js
import { loadSearchCorpus, fts5Candidates } from './db/repository.mjs';
import { buildIndex, search } from './src/search-engine.mjs';

const index = buildIndex(loadSearchCorpus(db));   // chats + contacts + live messages
search(index, { query: 'sourd' });                // full ranking, fuzzy + semantic

fts5Candidates(db, 'sourd');                      // { sortIds: [20], match: '"sourd"*' }
// on either engine, through a repository:
await repo.searchCandidates('sourd');            // { sortIds: [17], match | tsquery }
```

Two paths, one truth. The JS engine gives ranking, fuzzy and semantic layers; the
FTS5 path is what you use when the corpus is too big to hold in memory — call
`fts5Candidates()` first, then rank only those `sort_id`s. A test asserts the two
agree on prefix hits today, so you will notice if they diverge.

## Where your code plugs in

| If you need… | Change this |
|---|---|
| Postgres instead of SQLite | nothing — set `DATABASE_URL`; see [Two databases, one contract](#two-databases-one-contract) |
| A third database (MySQL, D1, DynamoDB) | copy `db/pg.mjs` and implement the same 15 methods; `db/open.mjs` gets one more branch |
| Messages arriving from a real messenger | call `bot.receive()` on every inbound message; when it returns `delete`, delete it and reply with the reason |
| More moderation rules | add an effect type to `applyEffects()` and a command to the table |
| A different embedding model | replace `embed()` in `src/search-engine.mjs`; the kNN/threshold interface stays |
