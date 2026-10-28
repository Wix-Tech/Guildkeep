import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGiphyGifToken,
  giphyAttributionUrl,
  normalizeGiphyQuery,
  normalizeGiphyResults,
  safeGiphyGifUrl,
  searchGiphyGifs,
} from '../src/giphy-gifs.mjs';

const originalUrl = 'https://media3.giphy.com/media/abc/giphy.gif';
const previewUrl = 'https://media3.giphy.com/media/abc/200w.gif';

test('GIPHY queries are trimmed and limited to the documented maximum', () => {
  assert.equal(normalizeGiphyQuery('  cats  '), 'cats');
  assert.throws(() => normalizeGiphyQuery(' '), /at least 2 characters/);
  assert.throws(() => normalizeGiphyQuery('x'.repeat(51)), /50 characters/);
});

test('GIF URLs accept GIPHY media and legacy Tenor assets only', () => {
  assert.equal(safeGiphyGifUrl(originalUrl), originalUrl);
  assert.equal(safeGiphyGifUrl('https://media.tenor.com/abc/tenor.gif'),
    'https://media.tenor.com/abc/tenor.gif');
  assert.equal(safeGiphyGifUrl('https://media.giphy.com.evil.example/a.gif'), null);
  assert.equal(safeGiphyGifUrl('http://media.giphy.com/a.gif'), null);
  assert.equal(safeGiphyGifUrl('https://giphy.com/a.gif'), null);
  assert.throws(() => createGiphyGifToken('https://example.com/a.gif'), /hosted on GIPHY or Tenor/);
  assert.equal(giphyAttributionUrl(originalUrl), 'https://giphy.com');
  assert.equal(giphyAttributionUrl('https://media.tenor.com/abc/tenor.gif'), 'https://tenor.com');
});

test('GIPHY results are safely normalized for preview and full-size URLs', () => {
  const results = normalizeGiphyResults({
    data: [
      {
        id: 'gif-1',
        title: 'Happy cat',
        images: {
          original: { url: originalUrl },
          fixed_width_small: { url: previewUrl },
        },
      },
      { id: 'unsafe', images: { original: { url: 'https://evil.example/a.gif' } } },
    ],
  });
  assert.deepEqual(results, [{
    id: 'gif-1',
    title: 'Happy cat',
    previewUrl,
    gifUrl: originalUrl,
  }]);
  assert.deepEqual(normalizeGiphyResults({ data: 'invalid' }), []);
});

test('GIPHY search calls the client-side Search API with its key and safe settings', async () => {
  let calledUrl;
  const results = await searchGiphyGifs(' cats ', 'public-test-key', async (url) => {
    calledUrl = new URL(url);
    return Response.json({
      data: [{
        id: 'gif-1',
        title: 'Cat',
        images: { original: { url: originalUrl }, fixed_width_small: { url: previewUrl } },
      }],
    });
  });
  assert.equal(calledUrl.origin, 'https://api.giphy.com');
  assert.equal(calledUrl.pathname, '/v1/gifs/search');
  assert.equal(calledUrl.searchParams.get('api_key'), 'public-test-key');
  assert.equal(calledUrl.searchParams.get('q'), 'cats');
  assert.equal(calledUrl.searchParams.get('rating'), 'pg');
  assert.equal(results[0].gifUrl, originalUrl);
});

test('GIPHY errors are explained and a missing public key is explicit', async () => {
  await assert.rejects(searchGiphyGifs('cats', ''), /VITE_GIPHY_API_KEY/);
  await assert.rejects(
    searchGiphyGifs('cats', 'public-test-key', async () => new Response('', { status: 403 })),
    /GIPHY rejected the API key or app access/,
  );
  await assert.rejects(
    searchGiphyGifs('cats', 'public-test-key', async () => new Response('', { status: 429 })),
    /rate limited/,
  );
});
