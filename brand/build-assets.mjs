#!/usr/bin/env node
/**
 * brand/build-assets.mjs — generate every brand asset from src/brand.mjs.
 *
 *   node brand/build-assets.mjs      (or: npm run brand)
 *
 * Outputs
 *   brand/logo.svg                 the mark, 512 px, on a dark plate
 *   brand/logo-transparent.svg     same mark, no plate (for light surfaces)
 *   brand/favicon.svg              the mark, sized for a favicon
 *   brand/icon-{192,512}.png       PWA / Android
 *   brand/icon-maskable-512.png    Android adaptive icon (20% safe padding)
 *   brand/apple-touch-icon.png     180×180, no transparency
 *   brand/og.png                   1200×630 social card
 *   brand/BRAND.md                 the written meta pack
 *
 * Everything is deterministic, so re-running after a rename is safe.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { Resvg } from '@resvg/resvg-js';
import { BRAND, PALETTE, markSvg, manifest, paletteCss } from '../src/brand.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const out = (f) => join(here, f);

await mkdir(join(here), { recursive: true });

/* ------------------------------------------------------------- SVG marks */

const svg = {
  'logo.svg': markSvg({ size: 512 }),
  'logo-transparent.svg': markSvg({ size: 512, plate: false }),
  'favicon.svg': markSvg({ size: 64 }),
  'logo-mono.svg': markSvg({ size: 512, plate: false }).replace(/url\(#gk\)/g, 'currentColor'),
};
for (const [name, content] of Object.entries(svg)) await writeFile(out(name), content);

/* ------------------------------------------------------------ PNG plates */

function png(svgString, width, { background = null } = {}) {
  const resvg = new Resvg(svgString, {
    fitTo: { mode: 'width', value: width },
    background,
  });
  return resvg.render().asPng();
}

const mark512 = markSvg({ size: 512 });
await writeFile(out('icon-512.png'), png(mark512, 512));
await writeFile(out('icon-192.png'), png(mark512, 192));
await writeFile(out('favicon-32.png'), png(mark512, 32));

// Maskable icons are cropped by the launcher, so the mark shrinks to 80% of
// the canvas and the plate bleeds to the edges. Composed in PIL so the plate
// stays flat while the mark scales.
await writeFile(out('_mark-core.png'), png(markSvg({ size: 512, plate: false }), 512));
await new Promise((resolve, reject) => {
  const py = `
from PIL import Image
bg = Image.new("RGB", (512, 512), "${BRAND.backgroundColor}")
mark = Image.open("${out('_mark-core.png')}").convert("RGBA")
inner = int(512 * 0.8)
mark = mark.resize((inner, inner), Image.LANCZOS)
bg.paste(mark, ((512 - inner) // 2, (512 - inner) // 2), mark)
bg.save("${out('icon-maskable-512.png')}")
`;
  import('node:fs/promises').then(({ writeFile: wf }) =>
    wf(out('_mask.py'), py).then(() =>
      import('node:child_process').then(({ execFile }) =>
        execFile('python3', [out('_mask.py')], (err, so, se) =>
          err ? reject(new Error(se || err.message)) : resolve(so),
        ),
      ),
    ),
  );
});
await import('node:fs/promises').then(({ unlink }) =>
  Promise.all([unlink(out('_mask.py')), unlink(out('_mark-core.png'))]).catch(() => {}),
);

// iOS: opaque, no alpha channel, 180×180
await writeFile(out('apple-touch-icon.png'), png(mark512, 180, { background: BRAND.backgroundColor }));

/* --------------------------------------------------------- social card */

/** Draw the 1200×630 card with PIL, using the rendered mark as one layer. */
async function socialCard() {
  const { execFile } = await import('node:child_process');
  const { writeFile: wf } = await import('node:fs/promises');
  await wf(out('_mark.png'), png(mark512, 320));

  const py = `
from PIL import Image, ImageDraw, ImageFont, ImageFilter
W, H = 1200, 630
BG = "${PALETTE.ink}"
GREEN = "${PALETTE.primary}"
CYAN = "${PALETTE.primarySoft}"
MUTED = "${PALETTE.muted}"
TEXT = "${PALETTE.text}"
PANEL = "${PALETTE.panel3}"

img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)

# soft top glow, drawn as one blurred ellipse so there is no banding
glow = Image.new("RGB", (W, H), BG)
gd = ImageDraw.Draw(glow)
gd.ellipse([-120, -640, W + 120, 120], fill=tuple(int("${PALETTE.glow}".replace("#", "")[i:i+2], 16) for i in (0, 2, 4)))
glow = glow.filter(ImageFilter.GaussianBlur(150))
img = Image.blend(Image.new("RGB", (W, H), BG), glow, 0.55)
d = ImageDraw.Draw(img)

mark = Image.open("${out('_mark.png')}").convert("RGBA")
img.paste(mark, (84, 155), mark)

def font(path, size):
    return ImageFont.truetype(path, size)

bold = font("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 104)
semi = font("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 38)
small = font("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 30)
tiny = font("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 24)

d.text((452, 210), "${BRAND.name}", font=bold, fill=TEXT)
d.text((456, 340), "${BRAND.tagline}", font=semi, fill=GREEN)
d.text((456, 400), "Hybrid search  ·  Admin commands  ·  Undo", font=small, fill=MUTED)

# three accent chips
x = 456
for label, colour in [("lock", GREEN), ("open", GREEN), ("status", CYAN), ("kick", CYAN), ("undo", GREEN)]:
    w = d.textlength(label, font=tiny) + 34
    d.rounded_rectangle([x, 470, x + w, 512], radius=21, outline=colour, width=2)
    d.text((x + 17, 479), label, font=tiny, fill=colour)
    x += w + 14

d.text((84, 560), "${BRAND.domain}", font=small, fill=MUTED)
img.save("${out('og.png')}")
print("og.png", img.size)
`;
  await wf(out('_card.py'), py);
  await new Promise((resolve, reject) =>
    execFile('python3', [out('_card.py')], (err, stdout, stderr) =>
      err ? reject(new Error(stderr || err.message)) : (console.log(stdout.trim()), resolve()),
    ),
  );
  const { unlink } = await import('node:fs/promises');
  await unlink(out('_card.py')).catch(() => {});
  await unlink(out('_mark.png')).catch(() => {});
}

await socialCard();

/* ------------------------------------------------------------ palette.css */

await writeFile(join(here, '..', 'src', 'palette.css'), paletteCss());

/* ------------------------------------------------------------- manifest */

await writeFile(out('manifest.webmanifest'), JSON.stringify(manifest(), null, 2) + '\n');

/* ------------------------------------------------------------- meta pack */

const doc = `# ${BRAND.name} — brand sheet

> ${BRAND.tagline}. ${BRAND.description}

## Name

**${BRAND.name}** — *guild* (a group of people who share a craft) + *keep* (the
fortified core of a castle, and the verb "to keep": to keep order, to keep the
archive). Two syllables, spelled the way it sounds, no hyphen.

Why it fits: the product does exactly two things — it **keeps** the group's
history searchable and it keeps the group's rules **enforced**. The mark is the
same idea in one shape: a chat bubble that is also a castle.

| Field | Value |
|---|---|
| Product name | ${BRAND.name} |
| Short name (icon label) | ${BRAND.shortName} |
| Domain (placeholder) | ${BRAND.domain} |
| NPM / package scope | \`@${BRAND.name.toLowerCase()}/\` |
| Code-name for the repo | \`${BRAND.name.toLowerCase()}\` |

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
| One-liner | ${BRAND.tagline} |
| Meta description (155 chars) | ${BRAND.description} |
| Elevator | Guildkeep makes a group chat searchable and self-policing: instant search over the archive, and admin commands that actually stick — with confirmation on the dangerous ones and undo on everything. |
| Empty search state | "Nothing yet. Try fewer words." |
| Search error | "Search is offline. Your local results still work." |
| Locked-group reply | "🔒 Group locked by {actor} ({reason}). Only admins can post now." |
| Destructive command | "Remove {name} from the group? Reply /confirm within 30s (or re-run with --yes)." |
| After undo | "↩️ Restored {name} to the group." |

## Colour — black and burnt orange

| Token | Hex | Use |
|---|---|---|
| Ink | \`${PALETTE.ink}\` | page background, icon plate |
| Panel | \`${PALETTE.panel}\` / \`${PALETTE.panel2}\` / \`${PALETTE.panel3}\` | cards, headers, inputs — three steps, all warm-tinted |
| Line | \`${PALETTE.line}\` | hairlines and dividers |
| Text | \`${PALETTE.text}\` | body copy on ink |
| Muted | \`${PALETTE.muted}\` | secondary copy, timestamps |
| Burnt orange | \`${PALETTE.primary}\` | primary action, the mark, "allowed" states |
| Orange deep | \`${PALETTE.primaryDeep}\` | gradient end of the mark, pressed states |
| Orange light | \`${PALETTE.primarySoft}\` | links, hover, small text on black |
| Highlight | \`${PALETTE.highlight}\` | matched search terms (kept distinct from the brand orange) |
| Danger | \`${PALETTE.danger}\` | kicks, bans, errors — never used for anything else |

Contrast on ink: text 18:1 · burnt orange 4.7:1 (AA body) · light orange 7.7:1 ·
muted 7.0:1. Burnt orange is the tightest one, so **small text on black uses
\`${PALETTE.primarySoft}\`, not \`${PALETTE.primary}\`** — that is the rule the
whole UI follows. Nothing green, nothing teal: the accent is the only hue.

## Type

System stack only, so nothing has to be downloaded:
\`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif\`.
Wordmark: 600 weight, \`-0.01em\` tracking. Body 15px/1.45.

## The mark

One chat bubble wearing three battlements, with a magnifier punched out of it —
keep + conversation + search. Sizes down to 16 px because there are only two
shapes and one cut-out.

\`\`\`
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
\`\`\`

### Usage

- Clear space around the mark: at least 1/4 of its width.
- Minimum size: 16 px (mark only), 24 px next to the wordmark.
- Don't: rotate, add shadows or outlines, recolour to anything outside the
  palette, put the plate-less mark on a busy photo, or set the wordmark in
  all-caps.

## Meta tags

Already inlined into both built pages by \`build-demo.mjs\` and
\`build-admin-demo.mjs\`, and served as static files by \`server.mjs\`:

\`\`\`html
<title>${BRAND.pages.search.title}</title>
<meta name="description" content="${BRAND.description}" />
<meta name="theme-color" content="${BRAND.themeColor}" />
<meta property="og:image" content="https://${BRAND.domain}/og.png" />
<meta name="twitter:card" content="summary_large_image" />
\`\`\`

Full set: \`metaTags()\` in \`src/brand.mjs\`. The demo pages ship
\`<meta name="robots" content="noindex">\` — flip it to \`index,follow\` when you
point a real domain at them.

## Files that read the brand

| File | What it uses |
|---|---|
| \`src/brand.mjs\` | the only place the name, colours and copy live |
| \`build-demo.mjs\`, \`build-admin-demo.mjs\` | page \`<head>\`, header mark, inline favicon |
| \`server.mjs\`, \`admin-server.mjs\` | \`/favicon.svg\`, \`/og.png\`, \`/manifest.webmanifest\`, icon PNGs |
| \`brand/build-assets.mjs\` | regenerates everything above |

Rename the product: edit \`BRAND\` in \`src/brand.mjs\`, run \`npm run brand\` and
\`npm run build\`, restart.
`;

await writeFile(out('BRAND.md'), doc);

/* ----------------------------------------------------------- showcase page */

/**
 * brand/showcase.html — one self-contained page showing every asset.
 * Everything is inlined (SVG markup, base64 PNGs) so it renders inside the
 * sandboxed workspace preview, which has no network access.
 */
async function showcase() {
  const { readFile } = await import('node:fs/promises');
  const b64 = async (f) => (await readFile(out(f))).toString('base64');

  const icon512 = await b64('icon-512.png');
  const maskable = await b64('icon-maskable-512.png');
  const og = await b64('og.png');
  const fav32 = await b64('favicon-32.png');

  const swatches = [
    ['Ink', PALETTE.ink, 'page + plate'],
    ['Panel', PALETTE.panel, 'cards'],
    ['Burnt orange', PALETTE.primary, 'primary, allowed'],
    ['Orange deep', PALETTE.primaryDeep, 'gradient end'],
    ['Orange light', PALETTE.primarySoft, 'links, small text'],
    ['Highlight', PALETTE.highlight, 'matched terms'],
    ['Text', PALETTE.text, 'body copy'],
    ['Muted', PALETTE.muted, 'secondary'],
    ['Line', PALETTE.line, 'hairlines'],
    ['Danger', PALETTE.danger, 'kicks, errors'],
  ]
    .map(
      ([name, hex, use]) => `<div class="sw">
        <span class="chip" style="background:${hex}"></span>
        <b>${name}</b><code>${hex}</code><span class="use">${use}</span>
      </div>`,
    )
    .join('\n');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${BRAND.name} — brand sheet</title>
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(markSvg({ size: 64 }))}" />
<style>
  :root {
    --bg: ${PALETTE.ink};
    --panel: ${PALETTE.panel};
    --panel2: ${PALETTE.panel3};
    --line: ${PALETTE.line};
    --text: ${PALETTE.text};
    --muted: ${PALETTE.muted};
    --green: ${PALETTE.primary};
    --cyan: ${PALETTE.primarySoft};
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 40px 20px 80px; background: var(--bg); color: var(--text);
    font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    background-image: radial-gradient(900px 400px at 50% -10%, ${PALETTE.glow}, var(--bg) 65%);
  }
  .wrap { max-width: 900px; margin: 0 auto; }
  h1 { font-size: 30px; margin: 0 0 4px; letter-spacing: -0.02em; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--muted); margin: 40px 0 12px; font-weight: 600; }
  p { margin: 0 0 12px; }
  .lede { color: var(--muted); max-width: 60ch; }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: 16px; padding: 22px; }
  .row { display: flex; gap: 18px; align-items: center; flex-wrap: wrap; }
  .lockup { display: flex; align-items: center; gap: 14px; }
  .wordmark { font-size: 30px; font-weight: 600; letter-spacing: -0.01em; }
  .wordmark span { color: var(--muted); font-weight: 400; }
  .sizes { display: flex; gap: 22px; align-items: flex-end; }
  .sizes figure { margin: 0; text-align: center; }
  .sizes figcaption { color: var(--muted); font-size: 11px; margin-top: 6px; }
  .swatches { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; }
  .sw { display: flex; align-items: center; gap: 10px; font-size: 13px; background: var(--panel2); border: 1px solid var(--line); border-radius: 10px; padding: 9px 11px; }
  .sw .chip { width: 22px; height: 22px; border-radius: 6px; border: 1px solid #ffffff22; flex: none; }
  .note { background: var(--panel2); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; color: var(--muted); font-size: 13px; }
  .note b { color: var(--text); }
  .sw code { color: var(--muted); font-size: 12px; }
  .sw .use { color: var(--muted); font-size: 11px; margin-left: auto; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  @media (max-width: 720px) { .grid2 { grid-template-columns: 1fr; } }
  img.shot { width: 100%; display: block; border-radius: 10px; }
  .tab { display: inline-flex; align-items: center; gap: 8px; background: ${PALETTE.panel3}; border-radius: 8px 8px 0 0; padding: 8px 12px; font-size: 12.5px; color: var(--text); }
  .tab img { border-radius: 3px; }
  .name { font-size: 44px; letter-spacing: -0.02em; margin: 0; }
  .name b { color: var(--green); font-weight: 600; }
  ul { margin: 0; padding-left: 20px; color: var(--muted); }
  ul b { color: var(--text); font-weight: 500; }
  .good { border-left: 3px solid var(--green); padding-left: 12px; }
  .bad { border-left: 3px solid ${PALETTE.danger}; padding-left: 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); }
  th { color: var(--muted); font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; }
</style>
</head>
<body>
<div class="wrap">

  <div class="lockup" style="margin-bottom:26px">
    ${markSvg({ size: 56 })}
    <div>
      <div class="wordmark">${BRAND.name}</div>
      <div class="lede" style="margin:0">${BRAND.tagline}</div>
    </div>
  </div>

  <h2>The name</h2>
  <p class="name">Guild<b>keep</b></p>
  <p class="lede"><b style="color:var(--text)">guild</b> — a group of people who share a craft.
  <b style="color:var(--text)">keep</b> — the fortified core of a castle; and the verb: to keep order,
  to keep the archive. The product does both: it keeps the group's history searchable and keeps its
  rules enforced. Two syllables, spelled the way it sounds, no hyphen.</p>
  <div class="grid2" style="margin-top:14px">
    <div class="card good"><b>Why it works</b>
      <ul>
        <li>Abstract enough to cover both features (search + admin)</li>
        <li>No "chat", "wa", "mod" or "bot" — nothing to defend against</li>
        <li>Short, pronounceable in any language, types cleanly</li>
        <li>Reads as a place, so "in Guildkeep" sounds natural</li>
      </ul>
    </div>
    <div class="card bad"><b>Checked and rejected</b>
      <ul>
        <li><b>Reeve</b> — several live products</li>
        <li><b>Quorum</b> — three software companies</li>
        <li><b>Warden / Steward / Marshal</b> — crowded moderation space</li>
        <li><b>Guildhall</b> — generic, event-venue software</li>
      </ul>
    </div>
  </div>

  <h2>The mark</h2>
  <p class="lede">A chat bubble wearing three battlements, with a magnifier punched out of it —
  keep + conversation + search. Two shapes and one cut-out, so it survives 16 px.</p>
  <div class="card">
    <div class="sizes">
      <figure>${markSvg({ size: 128 })}<figcaption>128</figcaption></figure>
      <figure>${markSvg({ size: 64 })}<figcaption>64</figcaption></figure>
      <figure>${markSvg({ size: 32 })}<figcaption>32</figcaption></figure>
      <figure>${markSvg({ size: 16 })}<figcaption>16</figcaption></figure>
      <figure style="margin-left:12px">${markSvg({ size: 64, plate: false })}<figcaption>no plate</figcaption></figure>
      <figure style="margin-left:12px"><span style="color:var(--green);display:inline-block">${markSvg({ size: 64, plate: false }).replace(/url\(#gk\)/g, 'currentColor')}</span><figcaption>single colour</figcaption></figure>
    </div>
  </div>

  <div class="note" style="margin-top:14px"><b>Nothing is hand-coloured.</b>
    Every hue lives in <code>PALETTE</code> in <code>src/brand.mjs</code>; the build writes
    <code>src/palette.css</code> and both stylesheets only use variables. The logo, icons, OG card and
    these swatches read the same object.</div>

  <h2>In the browser tab</h2>
  <div class="card" style="background:var(--panel2)">
    <div class="tab"><img src="data:image/png;base64,${fav32}" width="16" height="16" alt="" /> ${BRAND.name} · Search</div>
    <div style="height:8px"></div>
    <div class="tab" style="background:#32373b"><img src="data:image/png;base64,${fav32}" width="16" height="16" alt="" /> ${BRAND.name} · Admin</div>
  </div>

  <h2>Colour</h2>
  <div class="swatches">${swatches}</div>
  <p class="lede" style="margin-top:12px;font-size:13.5px">Contrast on ink: text 18:1 · burnt orange 4.7:1 · light orange 7.7:1 · muted 7.0:1 — all WCAG AA for body text.</p>

  <h2>App icon</h2>
  <div class="grid2">
    <div class="card"><img class="shot" src="data:image/png;base64,${icon512}" alt="app icon" style="width:96px" /><p style="margin-top:10px;color:var(--muted);font-size:13px">icon-512.png — PWA, Android, GitHub avatar</p></div>
    <div class="card"><img class="shot" src="data:image/png;base64,${maskable}" alt="maskable icon" style="width:96px;border-radius:50%" /><p style="margin-top:10px;color:var(--muted);font-size:13px">icon-maskable-512.png — cropped to a circle it still reads</p></div>
  </div>

  <h2>Social card · 1200×630</h2>
  <div class="card"><img class="shot" src="data:image/png;base64,${og}" alt="Open Graph card" /></div>

  <h2>Meta tags</h2>
  <div class="card">
    <table>
      <tr><th>Slot</th><th>Value</th></tr>
      <tr><td>Title (search)</td><td>${BRAND.pages.search.title}</td></tr>
      <tr><td>Title (admin)</td><td>${BRAND.pages.admin.title}</td></tr>
      <tr><td>Description</td><td>${BRAND.description}</td></tr>
      <tr><td>Theme colour</td><td><code>${BRAND.themeColor}</code></td></tr>
      <tr><td>OG image</td><td>https://${BRAND.domain}/og.png</td></tr>
      <tr><td>Domain (placeholder)</td><td>${BRAND.domain}</td></tr>
      <tr><td>Robots</td><td>noindex (demos) — flip when you go live</td></tr>
    </table>
  </div>

  <p class="lede" style="margin-top:36px;font-size:13px">Rename in one place: <code>BRAND</code> in
  <code>src/brand.mjs</code> → <code>npm run brand</code> → <code>npm run build</code>.
  Full written sheet: <code>brand/BRAND.md</code>.</p>
</div>
</body>
</html>`;

  await writeFile(out('showcase.html'), html);
  console.log(`wrote product/brand/showcase.html (${(html.length / 1024).toFixed(1)} kB)`);
}

await showcase();

console.log(`wrote ${Object.keys(svg).length} SVGs, 5 PNGs, og.png, manifest and BRAND.md to product/brand/`);
