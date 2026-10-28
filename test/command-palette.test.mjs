import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('command palette and keyboard shortcuts power navigation and actions', async () => {
  const [html, app, styles] = await Promise.all([
    readSource('../index.html'),
    readSource('../src/live-app.mjs'),
    readSource('../src/live-styles.css'),
  ]);

  assert.match(html, /id="command-palette"/);
  assert.match(html, /id="shortcuts-overlay"/);
  assert.match(html, /id="command-palette-input"/);
  assert.match(app, /function openCommandPalette/);
  assert.match(app, /function closeCommandPalette/);
  assert.match(app, /function renderCommandPalette/);
  assert.match(app, /data-command-action/);
  assert.match(app, /metaKey \|\| event.ctrlKey/);
  assert.match(app, /event\.key\.toLowerCase\(\) === 'j'/);
  assert.match(app, /event\.key\.toLowerCase\(\) === 'k'/);
  assert.match(app, /event\.key\.toLowerCase\(\) === 'e'/);
  assert.match(app, /event.key === '\?'/);
  assert.match(app, /function renderShortcuts/);
  assert.match(styles, /#command-palette-input/);
  assert.match(styles, /command-shortcut-row/);
});
