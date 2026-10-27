import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('composer emoji and sticker picker inserts text and renders selected stickers prominently', async () => {
  const [app, styles] = await Promise.all([
    readSource('../src/live-app.mjs'),
    readSource('../src/live-styles.css'),
  ]);

  assert.match(app, /id="emoji-picker-toggle"/);
  assert.match(app, /function renderEmojiPicker/);
  assert.match(app, /role="tab" data-emoji-picker-tab="stickers"/);
  assert.match(app, /function insertComposerEmoji\(emoji\)/);
  assert.match(app, /composer\.setRangeText\(emoji, start, end, 'end'\)/);
  assert.match(app, /event\.key === 'Escape' && !\$\(\'emoji-picker\'\)\.hidden/);
  assert.match(app, /STICKER_EMOJIS\.has\(message\.body\?\.trim\(\)\)/);
  assert.match(app, /class="message .*?\$\{sticker \? 'is-sticker' : ''\}/);
  assert.match(styles, /\.emoji-picker-grid/);
  assert.match(styles, /\.message\.is-sticker \.message-text/);
  assert.match(styles, /@media \(max-width: 380px\)[\s\S]*?\.emoji-picker-grid/);
});
