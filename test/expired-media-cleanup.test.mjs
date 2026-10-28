import test from 'node:test';
import assert from 'node:assert/strict';
import { createExpiredMediaCleanupHandler } from '../supabase/functions/cleanup-expired-media/handler.mjs';

const config = {
  SUPABASE_URL: 'https://guildkeep.example.test',
  SUPABASE_ANON_KEY: 'public-key',
  SUPABASE_SERVICE_ROLE_KEY: 'server-only-key',
};
const mediaPaths = [
  '00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002/one.png',
  '00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000003/two.pdf',
];

function response(payload, status = 200) {
  return new Response(payload === null ? null : JSON.stringify(payload), { status });
}

function request() {
  return new Request('https://function.example.test', {
    method: 'POST',
    headers: { authorization: 'Bearer valid-session-token' },
    body: '{}',
  });
}

test('expired-media cleanup requires an authenticated user', async () => {
  let fetchCalls = 0;
  const handler = createExpiredMediaCleanupHandler({
    getEnv: (name) => config[name],
    fetchImpl: async () => {
      fetchCalls += 1;
      return response({});
    },
  });
  const result = await handler(new Request('https://function.example.test', { method: 'POST' }));
  assert.equal(result.status, 401);
  assert.equal(fetchCalls, 0);
});

test('expired-media cleanup removes storage objects before acknowledging queue rows', async () => {
  const calls = [];
  const handler = createExpiredMediaCleanupHandler({
    getEnv: (name) => config[name],
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: new URL(url), options });
      if (calls.length === 1) return response({ id: 'authenticated-user' });
      if (calls.length === 2) {
        return response(mediaPaths.map((media_path) => ({ media_path })));
      }
      if (calls.length === 3) return response(null);
      if (calls.length === 4) return response(null);
      return response([]);
    },
  });

  const result = await handler(request());
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { deleted: 2 });
  assert.equal(calls[0].url.pathname, '/auth/v1/user');
  assert.equal(calls[0].options.headers.apikey, 'public-key');
  assert.equal(calls[1].url.pathname, '/rest/v1/expired_message_media');
  assert.equal(calls[1].options.headers.authorization, 'Bearer server-only-key');
  assert.equal(calls[2].url.pathname, '/storage/v1/object/chat-media');
  assert.equal(calls[2].options.method, 'DELETE');
  assert.deepEqual(JSON.parse(calls[2].options.body), { prefixes: mediaPaths });
  assert.equal(calls[3].options.method, 'DELETE');
  assert.match(calls[3].url.searchParams.get('media_path'), /^in\./);
  assert.equal(calls[4].url.searchParams.get('limit'), '100');
});

test('expired-media cleanup retains queue rows when storage deletion fails', async () => {
  let calls = 0;
  const handler = createExpiredMediaCleanupHandler({
    getEnv: (name) => config[name],
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return response({ id: 'authenticated-user' });
      if (calls === 2) return response([{ media_path: mediaPaths[0] }]);
      return response({ message: 'storage unavailable' }, 503);
    },
  });

  const result = await handler(request());
  assert.equal(result.status, 502);
  assert.deepEqual(await result.json(), { error: 'Could not remove expired attachments.' });
  assert.equal(calls, 3, 'the cleanup queue must not be acknowledged after a failed storage delete');
});

test('expired-media cleanup rejects paths outside the chat upload layout', async () => {
  let calls = 0;
  const handler = createExpiredMediaCleanupHandler({
    getEnv: (name) => config[name],
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return response({ id: 'authenticated-user' });
      return response([{ media_path: '../private/secret.png' }]);
    },
  });

  const result = await handler(request());
  assert.equal(result.status, 500);
  assert.deepEqual(await result.json(), { error: 'The cleanup queue contains an invalid attachment path.' });
  assert.equal(calls, 2, 'invalid queue data must not be sent to Supabase Storage');
});
