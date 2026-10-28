import test from 'node:test';
import assert from 'node:assert/strict';
import { createTenorSearchHandler } from '../supabase/functions/tenor-search/handler.mjs';

const validAuth = () => new Response(JSON.stringify({ id: 'user-id' }), { status: 200 });
const request = (body, headers = {}) => new Request('https://app.example/functions/v1/tenor-search', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: 'Bearer user-jwt', ...headers },
  body: JSON.stringify(body),
});

test('Tenor search requires a signed-in user before contacting Tenor', async () => {
  let fetchCalls = 0;
  const handler = createTenorSearchHandler({
    getEnv: (name) => ({
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_ANON_KEY: 'public-key',
      TENOR_API_KEY: 'private-test-key',
    })[name],
    fetchImpl: async () => {
      fetchCalls += 1;
      return new Response('Unauthorized', { status: 401 });
    },
  });
  const response = await handler(request({ query: 'cats' }));
  assert.equal(response.status, 401);
  assert.equal(fetchCalls, 1);
});

test('Tenor search validates query, calls fixed hosts, and returns safe assets only', async () => {
  const calls = [];
  const handler = createTenorSearchHandler({
    getEnv: (name) => ({
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_ANON_KEY: 'public-key',
      TENOR_API_KEY: 'private-test-key',
    })[name],
    fetchImpl: async (input, init) => {
      const url = new URL(input);
      calls.push({ url, init });
      if (url.pathname === '/auth/v1/user') return validAuth();
      return new Response(JSON.stringify({
        results: [
          {
            id: 'gif-1',
            content_description: 'Cat reaction',
            media_formats: {
              gif: { url: 'https://media.tenor.com/a/cat.gif' },
              tinygif: { url: 'https://media.tenor.com/a/cat-preview.gif' },
            },
          },
          {
            id: 'unsafe',
            media_formats: { gif: { url: 'https://evil.example/tracker.gif' } },
          },
        ],
      }), { status: 200 });
    },
  });
  const response = await handler(request({ query: '  cats  ' }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url.origin, 'https://project.supabase.co');
  assert.equal(calls[1].url.origin, 'https://tenor.googleapis.com');
  assert.equal(calls[1].url.searchParams.get('q'), 'cats');
  assert.equal(calls[1].url.searchParams.get('key'), 'private-test-key');
  assert.deepEqual(body.results.map((gif) => gif.id), ['gif-1']);
  assert.match(response.headers.get('cache-control'), /no-store/);
});

test('Tenor search validates input and does not contact Tenor without its secret', async () => {
  let fetchCalls = 0;
  const handler = createTenorSearchHandler({
    getEnv: (name) => ({
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_ANON_KEY: 'public-key',
    })[name],
    fetchImpl: async () => {
      fetchCalls += 1;
      return validAuth();
    },
  });
  const invalidQuery = await handler(request({ query: 'x' }));
  assert.equal(invalidQuery.status, 400);
  const noSecret = await handler(request({ query: 'cats' }));
  assert.equal(noSecret.status, 503);
  assert.equal(fetchCalls, 1);
});

test('Tenor search explains invalid API key and rate-limit responses', async () => {
  for (const [status, message] of [
    [403, /rejected the API key or access/i],
    [429, /rate limited/i],
  ]) {
    const handler = createTenorSearchHandler({
      getEnv: (name) => ({
        SUPABASE_URL: 'https://project.supabase.co',
        SUPABASE_ANON_KEY: 'public-key',
        TENOR_API_KEY: 'private-test-key',
      })[name],
      fetchImpl: async (input) => new URL(input).pathname === '/auth/v1/user'
        ? validAuth()
        : new Response('Unavailable', { status }),
    });
    const response = await handler(request({ query: 'cats' }));
    assert.equal(response.status, status === 429 ? 429 : 502);
    assert.match((await response.json()).error, message);
  }
});

test('Tenor search handles preflight and rejects oversized or malformed requests', async () => {
  const handler = createTenorSearchHandler({ getEnv: () => undefined });
  const options = await handler(new Request('https://app.example/functions/v1/tenor-search', { method: 'OPTIONS' }));
  assert.equal(options.status, 204);
  const malformed = await handler(new Request('https://app.example/functions/v1/tenor-search', {
    method: 'POST',
    headers: { authorization: 'Bearer user-jwt' },
    body: '{',
  }));
  assert.equal(malformed.status, 400);
  const oversized = await handler(new Request('https://app.example/functions/v1/tenor-search', {
    method: 'POST',
    headers: { authorization: 'Bearer user-jwt' },
    body: JSON.stringify({ query: 'x'.repeat(3000) }),
  }));
  assert.equal(oversized.status, 413);
});
