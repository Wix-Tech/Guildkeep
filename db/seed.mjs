#!/usr/bin/env node
/**
 * seed.mjs — populate a database with a realistic starter dataset.
 *
 *   node product/db/migrate.mjs            # create/upgrade product/data/app.db
 *   node product/db/seed.mjs               # insert the demo group + chats
 *   node product/db/seed.mjs --reset       # wipe first (dev only)
 *
 * Deterministic: fixed ids, fixed timestamps relative to a fixed clock, so
 * seeds, tests and demos all agree.
 */
import { openDb, migrate, transaction, all, run } from './db.mjs';
import { createGroup, addGroupMember, rebuildSearchIndex } from './repository.mjs';
import { DB_PATH } from './paths.mjs';

export const NOW = Date.UTC(2026, 9, 26, 17, 0, 0);
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

export const USERS = [
  ['u_nadia', 'Nadia Haddad', '+234 801 000 0001', 'person', 'PM, search & discovery.', 200],
  ['u_adebayo', 'Adebayo Okafor', '+234 801 000 0002', 'person', 'Backend engineer. SQLite performance nerd.', 150],
  ['u_tomas', 'Tomás Silva', '+234 801 000 0003', 'person', 'Photographer. Fujifilm X100V.', 40],
  ['u_priya', 'Priya Nair', '+234 801 000 0004', 'person', 'Data scientist. Embeddings and vector search.', 320],
  ['u_kofi', 'Kofi Mensah', '+234 801 000 0005', 'person', 'Growth marketing.', 90],
  ['u_chiamaka', 'Chiamaka Eze', '+234 801 000 0006', 'person', 'Lawyer, Abuja.', 300],
  ['u_lukas', 'Lukas Meyer', '+234 801 000 0007', 'person', 'iOS engineer, Berlin.', 260],
  ['u_wei', 'Chen Wei', '+234 801 000 0008', 'person', 'Android platform engineer.', 250],
  ['b_bakery', 'Naples Bakery', '+39 081 000 0009', 'business', 'Fresh sourdough and pastries.', 12],
  ['b_pharmacy', 'Ikoyi Pharmacy', '+234 801 000 0010', 'business', '24/7 pharmacy, delivery in Lagos.', 160],
];

export const GROUP_MEMBERS = [
  ['u_nadia', 'owner'],
  ['u_adebayo', 'admin'],
  ['u_tomas', 'member'],
  ['u_priya', 'member'],
  ['u_kofi', 'member'],
  ['u_chiamaka', 'member'],
];

export const MESSAGES = [
  // group: search quality
  ['msg_1', 'chat_g_design', 'u_priya', 'Semantic recall is better on paraphrases but the distance threshold needs tuning.', 3 * DAY],
  ['msg_2', 'chat_g_design', 'u_adebayo', 'The FTS query compiler now appends a wildcard only to the last token, so "search eng" matches "search engine".', 2 * DAY],
  ['msg_3', 'chat_g_design', 'u_nadia', 'Ranking evaluation for prefix matching is done: recall@10 went from 0.62 to 0.81.', 1 * DAY],
  ['msg_4', 'chat_g_design', 'u_kofi', 'Zero results are usually typos. Bigram matching on contacts fixed 30% of them.', 5 * DAY],
  ['msg_5', 'chat_g_design', 'u_wei', 'The message index rebuild takes 41 seconds on a 200k message database.', 29 * HOUR],
  ['msg_6', 'chat_g_design', 'u_adebayo', 'Careful: deleting rows does not shrink the FTS index, we need to run optimize.', 2 * DAY + 12 * HOUR],
  ['msg_7', 'chat_g_design', 'u_nadia', 'Zero-result rate is down to 6.4% this week.', 2 * HOUR],
  ['msg_8', 'chat_g_design', 'u_priya', 'The nearest-neighbour lookup returns 50 candidates and we keep the 20 closest.', 8 * DAY],
  // direct: priya
  ['msg_9', 'chat_d_priya', 'u_priya', 'I pushed the embedding pipeline. 96 dimensions, quantised, ~14 MB for 300k messages.', 38 * HOUR],
  ['msg_10', 'chat_d_priya', 'u_nadia', 'Do we merge semantic and keyword results, or show them as separate sections?', 2 * DAY + 14 * HOUR],
  ['msg_11', 'chat_d_priya', 'u_priya', 'Merged, but we log ftsCount, semanticCount and the overlap so we can measure each half.', 2 * DAY + 16 * HOUR],
  // direct: adebayo
  ['msg_12', 'chat_d_adebayo', 'u_adebayo', 'Did the migration finish on staging?', 21 * HOUR],
  ['msg_13', 'chat_d_adebayo', 'u_nadia', 'It did. 12 minutes, no downtime, index rebuild ran afterwards.', 20 * HOUR],
  ['msg_14', 'chat_d_adebayo', 'u_adebayo', 'Nice. Let us schedule production for Sunday night.', 19 * HOUR],
  // direct: tomas
  ['msg_15', 'chat_d_tomas', 'u_tomas', 'Text normalisation strips accents so "Tomas" finds "Tomás".', 15 * DAY],
  ['msg_16', 'chat_d_tomas', 'u_nadia', 'Good. The results screen should feel instant even with 300k messages.', 18 * DAY],
  // business
  ['msg_17', 'chat_b_bakery', 'b_bakery', 'Your sourdough order is ready for pickup. Reply 1 to confirm.', 7 * HOUR],
  ['msg_18', 'chat_b_bakery', 'u_nadia', '1', 6 * HOUR],
  ['msg_19', 'chat_b_bakery', 'b_bakery', 'Confirmed. Pickup until 7pm, 12 Via Toledo.', 6 * HOUR - 60_000],
  ['msg_20', 'chat_b_pharmacy', 'b_pharmacy', 'Your prescription is ready. Delivery within 90 minutes in Lagos.', 10 * HOUR],
  ['msg_21', 'chat_b_pharmacy', 'u_nadia', 'Please deliver to Lekki Phase 1.', 9 * HOUR],
];

export async function seed(db, { reset = false, now = NOW } = {}) {
  if (reset) {
    transaction(db, () => {
      for (const table of [
        'message_fts',
        'messages',
        'chats',
        'audit_log',
        'group_statuses',
        'warnings',
        'group_members',
        'group_settings',
        'groups',
        'users',
      ]) {
        try {
          run(db, `DELETE FROM ${table}`);
        } catch {
          /* virtual table may not exist yet */
        }
      }
      run(db, `DELETE FROM sqlite_sequence WHERE name IN ('messages','warnings','audit_log')`);
    });
  }

  transaction(db, () => {
    for (const [id, name, phone, kind, about, hue] of USERS) {
      run(
        db,
        `INSERT INTO users (id, name, phone, kind, about, avatar_hue, last_active_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO NOTHING`,
        id,
        name,
        phone,
        kind,
        about,
        hue,
        now - 3 * DAY,
      );
    }

    // the demo group first: messages need its chat to exist
    const existing = all(db, 'SELECT id FROM groups WHERE id = ?', 'g_design');
    if (!existing.length) {
      createGroup(db, {
        id: 'g_design',
        name: 'Design Guild',
        ownerId: 'u_nadia',
        ownerName: 'Nadia Haddad',
        ownerPhone: '+234 801 000 0001',
        now,
      });
    }
    run(
      db,
      `UPDATE chats SET pinned = 1, avatar_hue = 280, name = 'Design Guild' WHERE group_id = ?`,
      'g_design',
    );

    for (const [id, name, kind, pinned, peer] of [
      ['chat_g_design', 'Design Guild', 'group', 1, null],
      ['chat_d_priya', 'Priya Nair', 'direct', 0, 'u_priya'],
      ['chat_d_adebayo', 'Adebayo Okafor', 'direct', 0, 'u_adebayo'],
      ['chat_d_tomas', 'Tomás Silva', 'direct', 0, 'u_tomas'],
      ['chat_b_bakery', 'Naples Bakery', 'business', 0, 'b_bakery'],
      ['chat_b_pharmacy', 'Ikoyi Pharmacy', 'business', 0, 'b_pharmacy'],
    ]) {
      if (id === 'chat_g_design') continue; // created with the group below
      run(
        db,
        `INSERT INTO chats (id, kind, name, pinned, peer_user_id, avatar_hue)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO NOTHING`,
        id,
        kind,
        name,
        pinned,
        peer,
        (id.length * 29) % 360,
      );
    }

    for (const [id, chatId, senderId, text, ago] of MESSAGES) {
      run(
        db,
        `INSERT INTO messages (id, chat_id, sender_id, text, timestamp)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (id) DO NOTHING`,
        id,
        chatId,
        senderId,
        text,
        now - ago,
      );
    }

    for (const [userId, role] of GROUP_MEMBERS) {
      const user = USERS.find((u) => u[0] === userId);
      addGroupMember(db, {
        groupId: 'g_design',
        userId,
        name: user?.[1] ?? userId,
        phone: user?.[2] ?? null,
        role,
        now,
      });
    }

    run(
      db,
      `UPDATE group_settings SET
         rules = ?, welcome = ?, warn_limit = 3, warn_action = 'mute', updated_at = ?
       WHERE group_id = ?`,
      '1. Critique the work, not the person.\n2. No links without context.\n3. Thursday 4pm is critique time.',
      'Welcome {name} — say hi and check /rules.',
      now,
      'g_design',
    );

    run(
      db,
      `INSERT INTO group_statuses (id, group_id, text, author_id, author_name, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO NOTHING`,
      'status_seed_1',
      'g_design',
      'Critique moved to 5pm this Thursday.',
      'u_nadia',
      'Nadia Haddad',
      now - 2 * HOUR,
      now - 2 * HOUR + DAY,
    );
  });

  rebuildSearchIndex(db);

  return {
    users: all(db, 'SELECT COUNT(*) AS n FROM users')[0].n,
    groups: all(db, 'SELECT COUNT(*) AS n FROM groups')[0].n,
    members: all(db, 'SELECT COUNT(*) AS n FROM group_members')[0].n,
    chats: all(db, 'SELECT COUNT(*) AS n FROM chats')[0].n,
    messages: all(db, 'SELECT COUNT(*) AS n FROM messages')[0].n,
    indexed: all(db, 'SELECT COUNT(*) AS n FROM message_fts')[0].n,
  };
}

/* CLI */
if (process.argv[1] && process.argv[1].endsWith('seed.mjs')) {
  const db = openDb(DB_PATH);
  await migrate(db);
  const counts = await seed(db, { reset: process.argv.includes('--reset') });
  console.log(`seeded ${DB_PATH}`);
  console.log(counts);
  db.close();
}
