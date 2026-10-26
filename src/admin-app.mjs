/**
 * admin-app.mjs — the group admin console (demo UI for group-admin.mjs).
 *
 * Three panes: the group state, the member roster, and the command transcript.
 * You can act as the owner, an admin, or a plain member to see the permission
 * gates and the moderation gates from the outside.
 */

import { createGroupBot, describeSettings } from './group-admin.mjs';

const SEED = {
  group: { id: 'g1', name: 'Design Guild' },
  members: [
    { id: 'u0', name: 'Nadia', role: 'owner', phone: '+234 801 000 0001' },
    { id: 'u1', name: 'Adebayo', role: 'admin', phone: '+234 801 000 0002' },
    { id: 'u2', name: 'Tomás', role: 'member', phone: '+234 801 000 0003' },
    { id: 'u3', name: 'Priya', role: 'member', phone: '+234 801 000 0004' },
    { id: 'u4', name: 'Kofi', role: 'member', phone: '+234 801 000 0005' },
    { id: 'u5', name: 'Chiamaka', role: 'member', phone: '+234 801 000 0006' },
  ],
  settings: {
    rules: '1. Critique the work, not the person.\n2. No links without context.\n3. Thursday 4pm is critique time.',
    welcome: 'Welcome {name} — say hi and check /rules.',
  },
};

let bot = createGroupBot(SEED);
let actorId = 'u1';
let lastEffects = null;

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

const ROLE_BADGE = { owner: '👑 owner', admin: '⭐ admin', member: 'member' };

function timeLabel(ts = Date.now()) {
  return new Date(ts).toTimeString().slice(0, 5);
}

/* ------------------------------------------------------------------ */
/* Transcript                                                          */
/* ------------------------------------------------------------------ */

function pushLine({ who = 'system', text, tone = 'normal', meta = '' }) {
  const log = $('transcript');
  const row = document.createElement('div');
  row.className = `line ${who} ${tone}`;
  row.innerHTML = `
    ${who !== 'system' ? `<span class="line-who">${esc(who)}</span>` : ''}
    <span class="line-body">${esc(text).replace(/\n/g, '<br>')}</span>
    ${meta ? `<span class="line-meta">${esc(meta)}</span>` : ''}`;
  log.appendChild(row);
  log.scrollTop = log.scrollHeight;
}

function clearTranscript() {
  $('transcript').innerHTML = '';
  pushLine({ text: `Bot connected to “${bot.state.group.name}”. Type /help.` });
}

/* ------------------------------------------------------------------ */
/* Panels                                                              */
/* ------------------------------------------------------------------ */

function renderGroupPanel() {
  const g = bot.snapshot().group;
  const chip = (on, onLabel, offLabel = onLabel) =>
    `<span class="state ${on ? 'on' : 'off'}">${esc(on ? onLabel : offLabel)}</span>`;

  $('group-panel').innerHTML = `
    <div class="panel-head">
      <h2>${esc(g.name)}</h2>
      <span class="epoch">invite epoch ${g.inviteEpoch}</span>
    </div>
    <div class="states">
      ${chip(g.locked || g.announcement, '🔒 admins only', '🔓 everyone can post')}
      ${chip(g.slowSeconds > 0, `🐌 ${g.slowSeconds}s`, '🐌 slow off')}
      ${chip(g.antiLink, '🔗 anti-link on', '🔗 anti-link off')}
    </div>
    ${g.pinned ? `<div class="note">📌 <b>Pinned:</b> ${esc(g.pinned.text)}</div>` : ''}
    ${
      g.statuses.length
        ? `<div class="note">📢 <b>Status</b><ul class="statuses">${g.statuses
            .map(
              (s) =>
                `<li class="${s.expired ? 'expired' : ''}">${esc(s.text)}<span class="by">${esc(s.authorName)} · ${timeLabel(s.at)}${s.expired ? ' · expired' : ''}</span></li>`,
            )
            .join('')}</ul></div>`
        : ''
    }
    <pre class="stats">${esc(describeSettings(bot.state))}</pre>`;
}

function renderMembers() {
  const { members } = bot.snapshot();
  const order = { owner: 0, admin: 1, member: 2, bot: 3 };
  members.sort((a, b) => order[a.role] - order[b.role]);

  $('members').innerHTML = members
    .map((m) => {
      const flags = [
        m.muted ? '<span class="flag mute">muted</span>' : '',
        m.banned ? '<span class="flag ban">banned</span>' : '',
        m.warnings.length ? `<span class="flag warn">${m.warnings.length}⚠</span>` : '',
      ].join('');
      return `
      <li class="member ${m.id === actorId ? 'is-actor' : ''} ${m.role}">
        <span class="member-avatar">${esc(m.name.slice(0, 1))}</span>
        <span class="member-main">
          <span class="member-name">${esc(m.name)} ${flags}</span>
          <span class="member-role">${ROLE_BADGE[m.role] ?? m.role} · ${esc(m.phone ?? '')}</span>
        </span>
      </li>`;
    })
    .join('');
}

function renderAudit() {
  const rows = bot.snapshot().audit.slice(0, 8);
  $('audit').innerHTML = rows.length
    ? rows
        .map((a) => {
          const who = bot.state.members.get(a.actor)?.name ?? a.actor ?? 'system';
          const target = a.target ? ` → ${bot.state.members.get(a.target)?.name ?? a.target}` : '';
          return `<li><span class="t">${timeLabel(a.at)}</span> <b>${esc(who)}</b> /${esc(a.command)}${esc(target)}${a.detail ? ` <i>${esc(a.detail)}</i>` : ''}</li>`;
        })
        .join('')
    : '<li class="empty">No admin actions yet.</li>';
}

function renderEffects() {
  if (!lastEffects?.length) {
    $('effects').textContent = '// effects from the last command appear here';
    return;
  }
  $('effects').textContent = JSON.stringify(lastEffects, null, 2);
}

function renderAll() {
  renderGroupPanel();
  renderMembers();
  renderAudit();
  renderEffects();
  $('actor').value = actorId;
}

/* ------------------------------------------------------------------ */
/* Input handling                                                      */
/* ------------------------------------------------------------------ */

function currentActor() {
  return bot.state.members.get(actorId);
}

function submit(raw) {
  const text = raw.trim();
  if (!text) return;
  const actor = currentActor();
  if (!actor) return;

  pushLine({ who: actor.name, text, meta: timeLabel() });

  if (text.startsWith('/') || text.startsWith('!')) {
    const res = bot.handle({ authorId: actorId, text });
    pushLine({
      who: 'bot',
      text: res.message,
      tone: res.ok ? (res.kind === 'confirm' ? 'confirm' : res.kind === 'action' ? 'action' : 'normal') : 'error',
      meta: res.command ? `/${res.command}` : '',
    });
    lastEffects = res.effects ?? [];
  } else {
    const verdict = bot.receive({ authorId: actorId, text });
    if (verdict.action === 'delete') {
      const why = {
        group_locked: 'The group is locked — only admins can post.',
        muted: 'You are muted in this group.',
        banned: 'You are banned from this group.',
        anti_link: 'Links are not allowed here — that message was removed.',
        slow_mode: `Slow mode: wait ${Math.ceil((verdict.retryInMs ?? 0) / 1000)}s before posting again.`,
      }[verdict.reason] ?? 'Message removed.';
      pushLine({ who: 'bot', text: `🚫 ${why}`, tone: 'error', meta: verdict.reason });
      lastEffects = [{ type: 'message_deleted', reason: verdict.reason }];
    } else {
      pushLine({
        who: 'bot',
        text: `delivered to ${bot.state.members.size - 1} members`,
        tone: 'delivered',
        meta: 'moderation: allow',
      });
      lastEffects = [{ type: 'message_delivered' }];
    }
  }

  renderAll();
}

/* ------------------------------------------------------------------ */
/* Wiring                                                              */
/* ------------------------------------------------------------------ */

function wire() {
  $('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('cmd');
    submit(input.value);
    input.value = '';
    input.focus();
  });

  $('actor').addEventListener('change', (e) => {
    actorId = e.target.value;
    const actor = currentActor();
    pushLine({ text: `You are now acting as ${actor.name} (${actor.role}).` });
    renderAll();
  });

  $('quick').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cmd]');
    if (!btn) return;
    const input = $('cmd');
    input.value = btn.dataset.cmd;
    input.focus();
    if (btn.dataset.run === 'true') {
      submit(btn.dataset.cmd);
      input.value = '';
    }
  });

  $('reset').addEventListener('click', () => {
    bot = createGroupBot(SEED);
    lastEffects = null;
    clearTranscript();
    pushLine({ text: 'Group state reset.' });
    renderAll();
  });
}

clearTranscript();
wire();
renderAll();
