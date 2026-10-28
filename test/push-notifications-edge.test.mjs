import test from 'node:test';
import assert from 'node:assert/strict';
import { createPushNotificationHandler } from '../supabase/functions/push-notifications/handler.mjs';

const JOB_ID = '37';
const USER_ID = '00000000-0000-4000-8000-000000000001';
const CHAT_ID = '00000000-0000-4000-8000-000000000002';
const MESSAGE_ID = '00000000-0000-4000-8000-000000000003';
const SUBSCRIPTION_ID = '00000000-0000-4000-8000-000000000004';
const SECRET = 'a-secret-for-testing-that-is-long-enough';
const JOB = {
  id: JOB_ID,
  user_id: USER_ID,
  title: 'Alex · Engineering',
  body: 'Hello [[guildkeep-sticker:hello]] there',
  data: { type: 'message', chat_id: CHAT_ID, message_id: MESSAGE_ID },
  attempts: 1,
  delivered_subscription_ids: [],
};
const SUBSCRIPTION = {
  id: SUBSCRIPTION_ID,
  endpoint: 'https://fcm.googleapis.com/subscription/opaque',
  p256dh: 'base64url-public-key',
  auth: 'base64url-auth',
};

function request(body, secret = SECRET) {
  return new Request('https://function.example.test/push-notifications', {
    method: 'POST',
    headers: secret ? { 'x-push-webhook-secret': secret } : {},
    body: JSON.stringify(body),
  });
}

function response(data, status = 200) {
  return new Response(data === null ? null : JSON.stringify(data), { status });
}

function dependencies({ fetchImpl, sendNotification, env = {} }) {
  return {
    getEnv: (name) => ({
      PUSH_WEBHOOK_SECRET: SECRET,
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
      VAPID_PUBLIC_KEY: 'public-vapid-key',
      VAPID_PRIVATE_KEY: 'private-vapid-key',
      VAPID_SUBJECT: 'mailto:security@guildkeep.example',
      ...env,
    })[name],
    fetchImpl,
    sendNotification,
  };
}

test('push endpoint authenticates the database webhook before accessing the database', async () => {
  let fetchCount = 0;
  const handler = createPushNotificationHandler(dependencies({
    fetchImpl: async () => { fetchCount += 1; return response([]); },
    sendNotification: async () => {},
  }));
  const result = await handler(request({ job_ids: [JOB_ID] }, 'wrong-secret'));
  assert.equal(result.status, 401);
  assert.equal(fetchCount, 0);
});

test('valid jobs send private-service Web Push and remove completed queue rows', async () => {
  const calls = [];
  let sentPayload;
  const handler = createPushNotificationHandler(dependencies({
    fetchImpl: async (url, options = {}) => {
      const path = new URL(url).pathname;
      calls.push({ path, method: options.method ?? 'GET', body: options.body });
      if (path.endsWith('/rpc/claim_push_notification_jobs')) return response([JOB]);
      if (path.endsWith('/push_subscriptions')) return response([SUBSCRIPTION]);
      if (path.endsWith('/push_notification_jobs')) return response(null, 204);
      throw new Error(`Unexpected request: ${path}`);
    },
    sendNotification: async (subscription, payload, vapid) => {
      assert.equal(subscription.endpoint, SUBSCRIPTION.endpoint);
      assert.equal(vapid.privateKey, 'private-vapid-key');
      sentPayload = payload;
    },
  }));
  const result = await handler(request({ job_ids: [Number(JOB_ID), JOB_ID] }));
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { claimed: 1, sent: 1, retried: 0 });
  assert.equal(sentPayload.body, 'Hello there');
  assert.match(sentPayload.data.url, new RegExp(`push_chat=${CHAT_ID}`));
  assert.ok(calls.some((call) => call.method === 'PATCH'));
  assert.ok(calls.some((call) => call.method === 'DELETE'));
});

test('expired browser endpoints are deleted and the job is completed', async () => {
  const deletedPaths = [];
  const handler = createPushNotificationHandler(dependencies({
    fetchImpl: async (url, options = {}) => {
      const path = new URL(url).pathname;
      if (path.endsWith('/rpc/claim_push_notification_jobs')) return response([JOB]);
      if (path.endsWith('/push_subscriptions') && !options.method) return response([SUBSCRIPTION]);
      if (options.method === 'DELETE') {
        deletedPaths.push(path);
        return response(null, 204);
      }
      throw new Error(`Unexpected request: ${path}`);
    },
    sendNotification: async () => { throw Object.assign(new Error('gone'), { statusCode: 410 }); },
  }));
  const result = await handler(request({ job_ids: [JOB_ID] }));
  assert.equal(result.status, 200);
  assert.equal(deletedPaths.length, 2);
});

test('unsupported push endpoints are removed without making an outbound request', async () => {
  const deletedPaths = [];
  let sendCount = 0;
  const handler = createPushNotificationHandler(dependencies({
    fetchImpl: async (url, options = {}) => {
      const path = new URL(url).pathname;
      if (path.endsWith('/rpc/claim_push_notification_jobs')) return response([JOB]);
      if (path.endsWith('/push_subscriptions') && !options.method) {
        return response([{ ...SUBSCRIPTION, endpoint: 'https://127.0.0.1/admin' }]);
      }
      if (options.method === 'DELETE') {
        deletedPaths.push(path);
        return response(null, 204);
      }
      throw new Error(`Unexpected request: ${path}`);
    },
    sendNotification: async () => { sendCount += 1; },
  }));
  const result = await handler(request({ job_ids: [JOB_ID] }));
  assert.equal(result.status, 200);
  assert.equal(sendCount, 0);
  assert.equal(deletedPaths.length, 2);
});

test('temporary delivery failures are retried without losing successful-device state', async () => {
  const patches = [];
  const handler = createPushNotificationHandler(dependencies({
    fetchImpl: async (url, options = {}) => {
      const path = new URL(url).pathname;
      if (path.endsWith('/rpc/claim_push_notification_jobs')) return response([JOB]);
      if (path.endsWith('/push_subscriptions')) return response([SUBSCRIPTION]);
      if (options.method === 'PATCH') {
        patches.push(JSON.parse(options.body));
        return response(null, 204);
      }
      throw new Error(`Unexpected request: ${path}`);
    },
    sendNotification: async () => { throw Object.assign(new Error('temporary'), { statusCode: 503 }); },
  }));
  const result = await handler(request({ job_ids: [JOB_ID] }));
  assert.deepEqual(await result.json(), { claimed: 1, sent: 0, retried: 1 });
  assert.ok(patches.some((patch) => patch.status === 'pending'));
});

test('malformed batches and invalid claimed notification data are rejected safely', async () => {
  const handler = createPushNotificationHandler(dependencies({
    fetchImpl: async (url) => new URL(url).pathname.endsWith('/rpc/claim_push_notification_jobs')
      ? response([{ ...JOB, data: { type: 'message', url: 'https://evil.example' } }])
      : response(null, 204),
    sendNotification: async () => assert.fail('invalid jobs must not be sent'),
  }));
  assert.equal((await handler(request({ job_ids: [] }))).status, 400);
  const result = await handler(request({ job_ids: [JOB_ID] }));
  assert.equal(result.status, 200);
});
