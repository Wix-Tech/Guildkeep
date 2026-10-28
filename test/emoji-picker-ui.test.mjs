import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('composer picker provides emoji recents, original stickers, and Tenor GIF search', async () => {
  const [app, styles, supabaseChat, stickers] = await Promise.all([
    readSource('../src/live-app.mjs'),
    readSource('../src/live-styles.css'),
    readSource('../src/supabase-chat.mjs'),
    readdir(new URL('../src/stickers/', import.meta.url)),
  ]);
  assert.match(app, /document\.querySelector\(idOrSelector\)/);
  assert.match(app, /document\.getElementById\(idOrSelector\)/);
  const stickerAssets = await Promise.all(stickers
    .filter((name) => name.endsWith('.svg'))
    .map((name) => readFile(new URL(`../src/stickers/${name}`, import.meta.url), 'utf8')));

  assert.match(app, /id="emoji-picker-toggle"/);
  assert.match(app, />☺ Emoji<\/button>/);
  assert.match(app, /function renderEmojiPicker/);
  assert.match(app, /role="tab" data-emoji-picker-tab="stickers"/);
  assert.match(app, /role="tab" data-emoji-picker-tab="gifs"/);
  assert.match(app, /function insertComposerEmoji\(emoji\)/);
  assert.match(app, /composer\.setRangeText\(emoji, start, end, 'end'\)/);
  assert.match(app, /state\.emojiSelection\?\.start \?\? composer\.selectionStart/);
  assert.match(app, /added to your message\. Press Send when ready\./);
  assert.match(app, /const clickPath = event\.composedPath\(\)/);
  assert.match(app, /!clickPath\.includes\(emojiPicker\)/);
  const emojiSelectionHandler = app.split('const emojiChoice = event.target.closest(\'[data-insert-emoji]\');')[1]
    ?.split('const stickerChoice = event.target.closest(\'[data-insert-sticker]\');')[0];
  const stickerSelectionHandler = app.split('const stickerChoice = event.target.closest(\'[data-insert-sticker]\');')[1]
    ?.split('const gifChoice = event.target.closest(\'[data-insert-gif]\');')[0];
  const gifSelectionHandler = app.split('const gifChoice = event.target.closest(\'[data-insert-gif]\');')[1]
    ?.split('if (event.target.closest(\'[data-remove-picker-media]\'))')[0];
  assert.ok(emojiSelectionHandler && stickerSelectionHandler && gifSelectionHandler);
  assert.doesNotMatch(emojiSelectionHandler, /\.hidden\s*=\s*true/);
  assert.doesNotMatch(stickerSelectionHandler, /\.hidden\s*=\s*true/);
  assert.doesNotMatch(gifSelectionHandler, /\.hidden\s*=\s*true/);
  assert.match(app, /event\.key === 'Escape' && !\$\(\'emoji-picker\'\)\.hidden/);
  assert.match(app, /RECENT_EMOJI_STORAGE_KEY/);
  assert.match(app, /data-insert-sticker/);
  assert.match(app, /data-insert-gif/);
  assert.match(app, /class="message-sticker"[^>]+width="120" height="120"/);
  assert.match(app, /class="picker-media-draft"/);
  assert.match(app, /class="message .*?\$\{sticker \? 'is-sticker' : ''\}/);
  assert.match(supabaseChat, /functions\.invoke\('tenor-search'/);
  assert.equal(stickers.filter((name) => name.endsWith('.svg')).length, 8);
  for (const asset of stickerAssets) {
    assert.match(asset, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.doesNotMatch(asset, /<script\b|\b(?:href|src)="https?:/i);
  }
  assert.match(app, /placeholder="Search Tenor"/);
  assert.match(app, />Powered By Tenor</);
  assert.match(app, /<figcaption><a href="https:\/\/tenor\.com"[^>]*>Via Tenor<\/a><\/figcaption>/);
  assert.match(styles, /\.emoji-picker-grid/);
  assert.match(styles, /\.toast\s*\{[^}]*bottom:\s*calc\(84px/);
  assert.match(styles, /\.message\.is-sticker\s*\{[^}]*background:\s*transparent/);
  assert.match(styles, /\.message-sticker\s*\{[^}]*width:\s*120px[^}]*height:\s*120px/);
  assert.match(styles, /\.emoji-picker-recent/);
  assert.match(styles, /\.gif-picker-grid/);
  assert.match(styles, /@media \(max-width: 380px\)[\s\S]*?\.emoji-picker-grid/);
});
