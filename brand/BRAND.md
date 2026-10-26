# Guildkeep — brand sheet

> Search and admin for group chat. Hybrid search across your group chat archive, plus bot commands for admins: lock, open, status, add, kick, warn, undo.

## Name

**Guildkeep** — *guild* (a group of people who share a craft) + *keep* (the
fortified core of a castle, and the verb "to keep": to keep order, to keep the
archive). Two syllables, spelled the way it sounds, no hyphen.

Why it fits: the product does exactly two things — it **keeps** the group's
history searchable and it keeps the group's rules **enforced**. The mark is the
same idea in one shape: a chat bubble that is also a castle.

| Field | Value |
|---|---|
| Product name | Guildkeep |
| Short name (icon label) | Guildkeep |
| Domain (placeholder) | guildkeep.app |
| NPM / package scope | `@guildkeep/` |
| Code-name for the repo | `guildkeep` |

### Checked, but taken — do not use these

| Name | Status |
|---|---|
| Reeve | several live products (reeve.page, meetreeve.com) |
| Quorum | Quorum Software, Quorum.us, Quorum Information Technologies |
| Modu / Warden / Steward / Bailiff / Marshal / Crier | crowded in moderation/community tooling |
| Guildhall | generic and used by event/venue software |

Before launch, run the name through a trademark search in your class (Nice
class 9 and 42 for software) and register the domain. Nothing here is legal
advice — it is a starting point that avoids the obvious collisions.

## Voice and copy

| Slot | Copy |
|---|---|
| One-liner | Search and admin for group chat |
| Meta description (155 chars) | Hybrid search across your group chat archive, plus bot commands for admins: lock, open, status, add, kick, warn, undo. |
| Elevator | Guildkeep makes a group chat searchable and self-policing: instant search over the archive, and admin commands that actually stick — with confirmation on the dangerous ones and undo on everything. |
| Empty search state | "Nothing yet. Try fewer words." |
| Search error | "Search is offline. Your local results still work." |
| Locked-group reply | "🔒 Group locked by {actor} ({reason}). Only admins can post now." |
| Destructive command | "Remove {name} from the group? Reply /confirm within 30s (or re-run with --yes)." |
| After undo | "↩️ Restored {name} to the group." |

## Colour — black and burnt orange

| Token | Hex | Use |
|---|---|---|
| Ink | `#050505` | page background, icon plate |
| Panel | `#111110` / `#191715` / `#221f1c` | cards, headers, inputs — three steps, all warm-tinted |
| Line | `#2b2724` | hairlines and dividers |
| Text | `#f7f2ea` | body copy on ink |
| Muted | `#a09789` | secondary copy, timestamps |
| Burnt orange | `#cc5500` | primary action, the mark, "allowed" states |
| Orange deep | `#7a3300` | gradient end of the mark, pressed states |
| Orange light | `#e8873a` | links, hover, small text on black |
| Highlight | `#ffb056` | matched search terms (kept distinct from the brand orange) |
| Danger | `#ff6b52` | kicks, bans, errors — never used for anything else |

Contrast on ink: text 18:1 · burnt orange 4.7:1 (AA body) · light orange 7.7:1 ·
muted 7.0:1. Burnt orange is the tightest one, so **small text on black uses
`#e8873a`, not `#cc5500`** — that is the rule the
whole UI follows. Nothing green, nothing teal: the accent is the only hue.

## Type

System stack only, so nothing has to be downloaded:
`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`.
Wordmark: 600 weight, `-0.01em` tracking. Body 15px/1.45.

## The mark

One chat bubble wearing three battlements, with a magnifier punched out of it —
keep + conversation + search. Sizes down to 16 px because there are only two
shapes and one cut-out.

```
logo.svg              512 px, dark plate — the default
logo-transparent.svg  no plate, for light backgrounds
logo-mono.svg         single colour, inherits currentColor
favicon.svg           64 px, for the browser tab
icon-512.png          PWA / Android
icon-192.png          PWA
icon-maskable-512.png Android adaptive (20% safe padding)
apple-touch-icon.png  180 px, opaque for iOS
favicon-32.png        32 px raster fallback
og.png                1200×630 social card
```

### Usage

- Clear space around the mark: at least 1/4 of its width.
- Minimum size: 16 px (mark only), 24 px next to the wordmark.
- Don't: rotate, add shadows or outlines, recolour to anything outside the
  palette, put the plate-less mark on a busy photo, or set the wordmark in
  all-caps.

## Meta tags

Already inlined into both built pages by `build-demo.mjs` and
`build-admin-demo.mjs`, and served as static files by `server.mjs`:

```html
<title>Guildkeep · Search</title>
<meta name="description" content="Hybrid search across your group chat archive, plus bot commands for admins: lock, open, status, add, kick, warn, undo." />
<meta name="theme-color" content="#050505" />
<meta property="og:image" content="https://guildkeep.app/og.png" />
<meta name="twitter:card" content="summary_large_image" />
```

Full set: `metaTags()` in `src/brand.mjs`. The demo pages ship
`<meta name="robots" content="noindex">` — flip it to `index,follow` when you
point a real domain at them.

## Files that read the brand

| File | What it uses |
|---|---|
| `src/brand.mjs` | the only place the name, colours and copy live |
| `build-demo.mjs`, `build-admin-demo.mjs` | page `<head>`, header mark, inline favicon |
| `server.mjs`, `admin-server.mjs` | `/favicon.svg`, `/og.png`, `/manifest.webmanifest`, icon PNGs |
| `brand/build-assets.mjs` | regenerates everything above |

Rename the product: edit `BRAND` in `src/brand.mjs`, run `npm run brand` and
`npm run build`, restart.
