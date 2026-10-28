import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addRecentEmoji,
  createStickerToken,
  normalizeRecentEmojis,
  RECENT_EMOJI_LIMIT,
  splitPickerContent,
} from '../src/emoji-picker.mjs';
import { createTenorGifToken } from '../src/tenor-gifs.mjs';

const emojis = ['😀', '😂', '🥰', '😍', '😊', '😎', '😭', '😮', '🤔', '🙏'];

test('recent emojis are unique, allowed, ordered newest-first, and capped', () => {
  assert.deepEqual(
    normalizeRecentEmojis(['😀', '😂', '😀', 'not-an-emoji', ...emojis], emojis),
    emojis.slice(0, RECENT_EMOJI_LIMIT),
  );
  assert.deepEqual(addRecentEmoji(['😀', '😂'], '😂', emojis), ['😂', '😀']);
  assert.deepEqual(addRecentEmoji(['😀'], '🔥', emojis), ['😀']);
});

test('picker content tokens preserve surrounding text and sticker IDs', () => {
  const stickerToken = createStickerToken('hello');
  const gifToken = createTenorGifToken('https://media.tenor.com/abc123/tenor.gif');
  assert.deepEqual(splitPickerContent(`Hi ${stickerToken}!`), [
    { type: 'text', value: 'Hi ' },
    { type: 'sticker', value: 'hello', token: stickerToken },
    { type: 'text', value: '!' },
  ]);
  assert.deepEqual(splitPickerContent(gifToken), [
    { type: 'gif', value: 'https://media.tenor.com/abc123/tenor.gif', token: gifToken },
  ]);
  assert.throws(() => createStickerToken('../hello'), /Sticker ID/);
});
