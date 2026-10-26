/**
 * admin-bundle.test.mjs — smoke-test the bundled admin console.html.
 *
 * Runs the inline module from admin-demo.html against a DOM stub, then drives
 * the console the way a user would (submit a command, change actor) and asserts
 * on what the transcript received.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

function makeElement(id) {
  return {
    id,
    innerHTML: '',
    textContent: '',
    value: '',
    hidden: false,
    scrollTop: 0,
    scrollHeight: 100,
    dataset: {},
    children: [],
    style: {},
    listeners: {},
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(type, fn) {
      (this.listeners[type] ??= []).push(fn);
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    focus() {},
    closest() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
}

test('admin-demo.html bundles cleanly and responds to commands', async () => {
  const html = await readFile(new URL('../admin-demo.html', import.meta.url), 'utf8');
  const script = /<script type="module">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(script, 'inline module present');

  const dir = await mkdtemp(join(tmpdir(), 'admin-'));
  const file = join(dir, 'bundle.mjs');
  await writeFile(file, script[1], 'utf8');

  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeElement(id));
      return elements.get(id);
    },
    createElement(tag) {
      return makeElement(tag);
    },
    querySelectorAll() {
      return [];
    },
    addEventListener() {},
  };
  globalThis.document = document;
  globalThis.window = globalThis;

  const el = (id) => document.getElementById(id);

  await import(pathToFileURL(file).href);

  // the initial render populated the group panel and roster
  assert.match(el('group-panel').innerHTML, /Design Guild/);
  assert.match(el('members').innerHTML, /Adebayo/);
  assert.match(el('members').innerHTML, /owner/);
  assert.ok(el('transcript').children.length > 0, 'bot greeted the room');

  const submit = async (cmd) => {
    el('cmd').value = cmd;
    const handler = el('form').listeners.submit[0];
    handler({ preventDefault() {} });
  };

  // acting as Adebayo (admin) by default: /lock works
  await submit('/lock maintenance');
  const afterLock = el('transcript').children.map((c) => c.innerHTML).join('\n');
  assert.match(afterLock, /Group locked/);
  assert.match(el('group-panel').innerHTML, /admins only/);

  // switch to a plain member: /lock must be denied
  const onActor = el('actor').listeners.change[0];
  onActor({ target: { value: 'u2' } });
  await submit('/lock');
  const afterDeny = el('transcript').children.map((c) => c.innerHTML).join('\n');
  assert.match(afterDeny, /Admins only/);

  // a member's plain message is blocked while the group is locked
  await submit('hello everyone');
  const afterMsg = el('transcript').children.map((c) => c.innerHTML).join('\n');
  assert.match(afterMsg, /only admins can post/);

  // effects are surfaced for the last command
  assert.match(el('effects').textContent, /"type"/);
});
