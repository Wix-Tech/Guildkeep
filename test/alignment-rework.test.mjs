import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('conversation header and titles keep alignment and ellipsize safely', async () => {
  const styles = await readSource('../src/live-styles.css');

  assert.match(styles, /\.conversation-head \{ flex: 0 0 66px; gap: 12px; align-items: center;/);
  assert.match(styles, /\.conversation-title span \{ min-width: 0; overflow: hidden;/);
});
