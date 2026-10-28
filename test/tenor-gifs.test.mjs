import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTenorGifToken,
  normalizeTenorQuery,
  normalizeTenorResults,
  safeTenorGifUrl,
  TENOR_GIF_LIMIT,
} from '../src/tenor-gifs.mjs';

test('Tenor search queries are trimmed and bounded', () => {
  assert.equal(normalizeTenorQuery('  cats  '), 'cats');
  assert.throws(() => normalizeTenorQuery(' '), /at least 2 characters/);
  assert.throws(() => normalizeTenorQuery(`x${'a'.repeat(80)}`), /80 characters/);
});

test('only HTTPS GIF assets from the Tenor CDN are accepted', () => {
  const tenorGif = 'https://media.tenor.com/abc123/tenor.gif';
  assert.equal(safeTenorGifUrl(tenorGif), tenorGif);
  assert.equal(safeTenorGifUrl('http://media.tenor.com/abc123/tenor.gif'), null);
  assert.equal(safeTenorGifUrl('https://media.tenor.com.evil.example/tenor.gif'), null);
  assert.equal(safeTenorGifUrl('https://example.com/image.gif'), null);
  assert.equal(safeTenorGifUrl('https://media.tenor.com/abc123/page.html'), null);
  assert.throws(() => createTenorGifToken('https://example.com/image.gif'), /hosted on Tenor/);
});

test('Tenor responses are normalized, bounded, and reject untrusted media URLs', () => {
  const valid = {
    id: 'gif-1',
    content_description: 'Happy <cat>',
    media_formats: {
      gif: { url: 'https://media.tenor.com/abc123/full.gif' },
      tinygif: { url: 'https://media.tenor.com/abc123/preview.gif' },
    },
  };
  const payload = {
    results: [
      valid,
      { id: 'unsafe', media_formats: { gif: { url: 'https://evil.example/tracker.gif' } } },
      ...Array.from({ length: TENOR_GIF_LIMIT + 2 }, (_, index) => ({
        id: `extra-${index}`,
        media_formats: { gif: { url: `https://media.tenor.com/${index}/full.gif` } },
      })),
    ],
  };
  const results = normalizeTenorResults(payload);
  assert.ok(results.length <= TENOR_GIF_LIMIT);
  assert.equal(results.length, TENOR_GIF_LIMIT - 1);
  assert.deepEqual(results[0], {
    id: 'gif-1',
    title: 'Happy <cat>',
    previewUrl: 'https://media.tenor.com/abc123/preview.gif',
    gifUrl: 'https://media.tenor.com/abc123/full.gif',
  });
  assert.equal(normalizeTenorResults({ results: 'invalid' }).length, 0);
});
