#!/usr/bin/env node
/**
 * build-admin-demo.mjs — bundle the admin bot + console into one file.
 *
 *   node product/build-admin-demo.mjs   →  product/admin-demo.html
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = (f) => readFile(join(here, 'src', f), 'utf8');

function flatten(code) {
  return code
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^import\s+['"][^'"]+['"];?\s*$/gm, '')
    .trim();
}

const [engine, app, baseCss, adminCss] = await Promise.all([
  src('group-admin.mjs'),
  src('admin-app.mjs'),
  src('styles.css'),
  src('admin-styles.css'),
]);

const QUICK = [
  ['/help', 'false'],
  ['/lock maintenance', 'true'],
  ['/open', 'true'],
  ['/status "Critique moved to 5pm"', 'true'],
  ['/slowmode 30s', 'true'],
  ['/antilink on', 'false'],
  ['/warn @Tomás spam', 'true'],
  ['/mute @Priya 10m', 'true'],
  ['/kick @Kofi', 'true'],
  ['/add +234 802 555 1212 Zainab', 'true'],
  ['/stats', 'true'],
  ['/audit', 'true'],
  ['/undo', 'true'],
];

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Group admin bot — console</title>
<style>
${baseCss}
${adminCss}
</style>
</head>
<body>
  <div class="shell">
    <div class="titlebar">
      <h1>Group admin bot</h1>
      <small>lock · open · status · add · kick · warn · slow mode · undo</small>
    </div>

    <div class="console">
      <div class="panel" id="group-panel"></div>

      <div class="panel">
        <div class="actor-bar">
          <label for="actor">Acting as</label>
          <select id="actor">
            <option value="u0">Nadia — owner</option>
            <option value="u1">Adebayo — admin</option>
            <option value="u2">Tomás — member</option>
            <option value="u3">Priya — member</option>
          </select>
          <button class="ghost-btn" id="reset" type="button">Reset</button>
        </div>

        <div class="transcript" id="transcript"></div>

        <form class="composer" id="form" autocomplete="off">
          <input id="cmd" placeholder="Type /help, or just chat to test the moderation gates" aria-label="Command" />
          <button type="submit">Send</button>
        </form>

        <div class="quick" id="quick">
          ${QUICK.map(([cmd, run]) => `<button class="chip" type="button" data-cmd="${cmd.replace(/"/g, '&quot;')}" data-run="${run}">${cmd}</button>`).join('\n          ')}
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><h2>Members</h2><span class="epoch">roles &amp; standing</span></div>
        <ul id="members"></ul>
      </div>

      <div class="panel">
        <div class="panel-head"><h2>Audit log</h2><span class="epoch">who did what</span></div>
        <ul id="audit"></ul>
        <pre id="effects"></pre>
      </div>
    </div>
  </div>

<script type="module">
/* ---- group-admin.mjs ---- */
${flatten(engine)}

/* ---- admin-app.mjs ---- */
${flatten(app)}
</script>
</body>
</html>
`;

await writeFile(join(here, 'admin-demo.html'), html, 'utf8');
console.log(`wrote product/admin-demo.html (${(html.length / 1024).toFixed(1)} kB)`);
