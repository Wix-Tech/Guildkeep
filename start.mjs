#!/usr/bin/env node
/**
 * start.mjs — one command to run the whole thing.
 *
 *   npm start          (or: node start.mjs)
 *
 * It checks your Node version, creates and seeds the database if needed, then
 * starts both servers and prints the two links to open. Ctrl+C stops both.
 *
 * Ports: 8787 (search) and 8788 (admin). If either is busy, the next free port
 * is used and the chosen one is printed.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const children = [];
let stopping = false;

const paint = process.stdout.isTTY
  ? { dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m`, ok: (s) => `\x1b[32m${s}\x1b[0m`, bad: (s) => `\x1b[31m${s}\x1b[0m` }
  : { dim: (s) => s, bold: (s) => s, ok: (s) => s, bad: (s) => s };

function quit(message) {
  console.error(`\n${paint.bad('✖')} ${message}\n`);
  process.exit(1);
}

/* ---------------------------------------------------------------- 1. Node */

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 5)) {
  quit(
    `This needs Node 22.5 or newer (you have ${process.versions.node}).\n\n` +
      `  Get it at https://nodejs.org — pick the "LTS" button, install, then run this again.\n` +
      `  Already installed an older one? Use nvm:  nvm install 22 && nvm use 22`,
  );
}

/* ----------------------------------------------------------- 2. Free port */

function isFree(port) {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, '0.0.0.0');
  });
}

// Ports handed out so far. Without this, two probe-then-bind calls can pick the
// same free port before either child has bound it.
const taken = new Set();

async function pickPort(wanted) {
  for (let port = wanted; port < wanted + 40; port += 1) {
    if (taken.has(port)) continue;
    if (await isFree(port)) {
      taken.add(port);
      return port;
    }
  }
  quit(`Ports ${wanted}–${wanted + 39} are all busy. Close something and try again.`);
}

/* ------------------------------------------------------------ 3. Database */

console.log(paint.dim('\nstarting up…'));

const { openRepository } = await import('./db/open.mjs');
let repo;
try {
  repo = await openRepository();
} catch (err) {
  quit(`Could not open the database: ${err.message}`);
}

const [{ n: messageCount }] = await repo.raw('SELECT COUNT(*) AS n FROM messages');
if (Number(messageCount) === 0) {
  console.log('• empty database — adding the demo group, chats and messages…');
  await repo.seed();
}
const [{ n: seeded }] = await repo.raw('SELECT COUNT(*) AS n FROM messages');

/* ------------------------------------------------------------- 4. Servers */

const searchPort = await pickPort(Number(process.env.PORT ?? 8787));
const adminPort = await pickPort(Number(process.env.ADMIN_PORT ?? 8788));

function start(name, file, port) {
  const child = spawn(process.execPath, [join(here, file)], {
    cwd: here,
    env: { ...process.env, PORT: String(port), HOST: '0.0.0.0' },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  child.on('exit', (code) => {
    if (stopping) return;
    console.error(`\n${paint.bad('✖')} ${name} stopped unexpectedly (exit ${code}). See the messages above.`);
    shutdown();
  });
  children.push(child);
  return child;
}

function shutdown() {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(0), 200);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start('search server', 'server.mjs', searchPort);
start('admin server', 'admin-server.mjs', adminPort);

// give both a moment to bind before we tell the user to click
await new Promise((r) => setTimeout(r, 1200));
if (stopping) process.exit(1);

console.log('');
console.log(`  ${paint.ok('✔')} ready — ${seeded} messages in the database`);
console.log('');
console.log(`  ${paint.bold('Search UI')}    http://localhost:${searchPort}`);
console.log(`  ${paint.bold('Admin bot')}    http://localhost:${adminPort}`);
console.log('');
console.log(paint.dim('  Open the first link and type "sourd" — you should get the bakery message.'));
console.log(paint.dim('  In the admin console, send  /lock maintenance  as Adebayo to see a command work.'));
console.log(paint.dim('  Press Ctrl+C to stop.'));
console.log('');
