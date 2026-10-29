import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('dialogs and overlays keep edge spacing and stay within viewport height', async () => {
  const styles = await readSource('../src/live-styles.css');

  assert.match(styles, /\.dialog-backdrop \{[^}]*padding: max\(18px, env\(safe-area-inset-top, 0px\)\)/);
  assert.match(styles, /\.dialog \{[^}]*max-height: calc\(100dvh - 36px\);[^}]*overflow-y: auto;/);
});
