import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('status feed exposes a working post-status action on mobile', async () => {
  const [app, styles] = await Promise.all([
    readSource('../src/live-app.mjs'),
    readSource('../src/live-styles.css'),
  ]);
  const feedRenderer = app.slice(
    app.indexOf('function renderStatusFeed('),
    app.indexOf('function renderSettingsPage('),
  );
  const conversationClickHandler = app.slice(
    app.indexOf("$('conversation').addEventListener('click', async (event) => {"),
    app.indexOf("$('group-details-content').addEventListener('click'"),
  );

  assert.match(feedRenderer, /class="status-feed-header"/);
  assert.match(feedRenderer, /data-new-status/);
  assert.match(conversationClickHandler, /event\.target\.closest\('\[data-new-status\]'\)/);
  assert.match(conversationClickHandler, /openStatusComposer\(\)/);
  assert.match(app, /function openStatusComposer\(\)/);
  assert.match(styles, /\.status-feed-header \.primary-button/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*?\.status-feed-header/);
});
