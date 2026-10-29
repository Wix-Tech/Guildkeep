import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('message bubbles keep left/right alignment and meta row right-aligns', async () => {
  const styles = await readSource('../src/live-styles.css');

  assert.match(styles, /\.message \{[^}]*align-self: flex-start;[^}]*min-width: 0;/);
  assert.match(styles, /\.message\.outgoing \{ align-self: flex-end;/);
  assert.match(styles, /\.message-meta \{ display: flex; align-items: center; justify-content: flex-end;/);
});

test('conversation body and message width caps stay mobile-safe', async () => {
  const styles = await readSource('../src/live-styles.css');

  assert.match(styles, /\.conversation-body \{[^}]*display: flex; flex-direction: column;/);
  assert.match(styles, /\.message \{ max-width: min\(76%, 560px\);/);
});
