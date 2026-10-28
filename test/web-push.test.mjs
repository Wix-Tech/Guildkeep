import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  getCurrentPushSubscription,
  isWebPushSupported,
  serializePushSubscription,
  subscribeToWebPush,
  unsubscribeFromWebPush,
} from '../src/web-push.mjs';

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8');

function makeSubscription() {
  return {
    endpoint: 'https://push.example.test/subscription/opaque',
    getKey(name) {
      return name === 'p256dh'
        ? Uint8Array.from([1, 2, 3]).buffer
        : Uint8Array.from([4, 5]).buffer;
    },
    async unsubscribe() { return true; },
  };
}

test('push support is detected without requiring browser globals in Node', () => {
  const navigatorObject = { serviceWorker: {} };
  assert.equal(isWebPushSupported({
    navigatorObject,
    notificationApi: { permission: 'default' },
    publicKey: 'key',
    pushManagerAvailable: true,
  }), true);
  assert.equal(isWebPushSupported({
    navigatorObject,
    notificationApi: null,
    publicKey: 'key',
    pushManagerAvailable: true,
  }), false);
  assert.equal(isWebPushSupported({
    navigatorObject,
    notificationApi: { permission: 'default' },
    publicKey: '',
    pushManagerAvailable: true,
  }), false);
});

test('enabling push requests permission on demand and persists the browser subscription keys', async () => {
  const subscription = makeSubscription();
  let requestedPermission = false;
  let subscriptionOptions;
  const registration = {
    pushManager: {
      async getSubscription() { return null; },
      async subscribe(options) {
        subscriptionOptions = options;
        return subscription;
      },
    },
  };
  const navigatorObject = {
    serviceWorker: {
      async register(path, options) {
        assert.equal(path, '/sw.js');
        assert.deepEqual(options, { scope: '/' });
        return registration;
      },
      ready: Promise.resolve(registration),
    },
  };
  const { subscription: result, details } = await subscribeToWebPush({
    publicKey: 'AQIDBA',
    navigatorObject,
    pushManagerAvailable: true,
    notificationApi: {
      permission: 'default',
      async requestPermission() {
        requestedPermission = true;
        return 'granted';
      },
    },
  });
  assert.equal(requestedPermission, true);
  assert.deepEqual(subscriptionOptions.applicationServerKey, Uint8Array.from([1, 2, 3, 4]));
  assert.equal(subscriptionOptions.userVisibleOnly, true);
  assert.equal(result, subscription);
  assert.deepEqual(details, {
    endpoint: subscription.endpoint,
    p256dh: 'AQID',
    auth: 'BAU',
  });
});

test('push setup reports denied permission and does not create a subscription', async () => {
  let registered = false;
  await assert.rejects(subscribeToWebPush({
    publicKey: 'AQIDBA',
    pushManagerAvailable: true,
    navigatorObject: {
      serviceWorker: {
        async register() { registered = true; },
      },
    },
    notificationApi: {
      permission: 'denied',
      async requestPermission() { return 'denied'; },
    },
  }), /blocked for Guildkeep in your browser settings/i);
  assert.equal(registered, false);
});

test('existing subscriptions can be serialized and unsubscribed', async () => {
  const subscription = makeSubscription();
  assert.equal(
    serializePushSubscription(subscription).endpoint,
    subscription.endpoint,
  );
  assert.equal(await getCurrentPushSubscription({
    navigatorObject: {
      serviceWorker: {
        async getRegistration(scope) {
          assert.equal(scope, '/');
          return { pushManager: { async getSubscription() { return subscription; } } };
        },
      },
    },
  }), subscription);
  assert.equal(await unsubscribeFromWebPush({ subscription }), true);
});

test('the service worker displays and routes push notifications without accepting external URLs', async () => {
  const worker = await readSource('../public/sw.js');
  assert.match(worker, /addEventListener\('push'/);
  assert.match(worker, /showNotification\(title, options\)/);
  assert.match(worker, /guildkeep-push-click/);
  assert.match(worker, /target\.origin !== self\.location\.origin/);
  assert.match(worker, /openWindow\(target\.toString\(\)\)/);
});

test('notification settings expose device opt-in, previews, and each chosen event category', async () => {
  const [app, html, manifest, webPush] = await Promise.all([
    readSource('../src/live-app.mjs'),
    readSource('../index.html'),
    readSource('../public/manifest.webmanifest'),
    readSource('../src/web-push.mjs'),
  ]);
  assert.match(app, /settings-push-toggle/);
  assert.match(webPush, /requestPermission/);
  assert.match(app, /direct_messages_enabled/);
  assert.match(app, /mentions_enabled/);
  assert.match(app, /group_channel_messages_enabled/);
  assert.match(app, /status_reactions_enabled/);
  assert.match(app, /Alerts show the sender and a message preview/);
  assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/);
  assert.match(manifest, /"display": "standalone"/);
});
