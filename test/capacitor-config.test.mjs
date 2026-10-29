import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('capacitor native app shell is configured for the web build', async () => {
  const config = await readSource('../capacitor.config.ts');
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

  assert.match(config, /appId: 'com\.guildkeep\.app'/);
  assert.match(config, /appName: 'Guildkeep'/);
  assert.match(config, /webDir: 'dist'/);
  assert.ok(pkg.dependencies?.['@capacitor/core']);
  assert.ok(pkg.dependencies?.['@capacitor/cli']);
  assert.ok(pkg.dependencies?.['@capacitor/android']);
  assert.ok(pkg.devDependencies?.typescript);
  assert.ok(existsSync(path.join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml')));
});
