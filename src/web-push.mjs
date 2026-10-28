function base64UrlToBytes(value) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value.replace(/-/g, '+').replace(/_/g, '/')}${padding}`;
  const raw = atob(base64);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

function bytesToBase64Url(value) {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function isWebPushSupported({
  navigatorObject = globalThis.navigator,
  notificationApi = globalThis.Notification,
  publicKey = '',
  pushManagerAvailable = Boolean(globalThis.PushManager),
} = {}) {
  return Boolean(
    publicKey
    && notificationApi
    && navigatorObject?.serviceWorker
    && pushManagerAvailable,
  );
}

export async function getCurrentPushSubscription({
  navigatorObject = globalThis.navigator,
} = {}) {
  const registration = await navigatorObject?.serviceWorker?.getRegistration('/');
  return registration?.pushManager?.getSubscription() ?? null;
}

export function serializePushSubscription(subscription) {
  const p256dh = subscription.getKey('p256dh');
  const auth = subscription.getKey('auth');
  if (!p256dh || !auth) throw new Error('The browser returned an incomplete push subscription.');
  return {
    endpoint: subscription.endpoint,
    p256dh: bytesToBase64Url(new Uint8Array(p256dh)),
    auth: bytesToBase64Url(new Uint8Array(auth)),
  };
}

export async function subscribeToWebPush({
  publicKey,
  navigatorObject = globalThis.navigator,
  notificationApi = globalThis.Notification,
  pushManagerAvailable = Boolean(globalThis.PushManager),
} = {}) {
  if (!isWebPushSupported({
    navigatorObject,
    notificationApi,
    publicKey,
    pushManagerAvailable,
  })) {
    throw new Error('Push notifications are not supported or configured in this browser.');
  }
  if (!navigatorObject.serviceWorker?.register) {
    throw new Error('The Guildkeep service worker could not be registered.');
  }
  const permission = notificationApi.permission === 'granted'
    ? 'granted'
    : await notificationApi.requestPermission();
  if (permission !== 'granted') {
    throw new Error(permission === 'denied'
      ? 'Notifications are blocked for Guildkeep in your browser settings.'
      : 'Allow notifications to enable push alerts.');
  }
  const registration = await navigatorObject.serviceWorker.register('/sw.js', { scope: '/' });
  await navigatorObject.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing ?? await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64UrlToBytes(publicKey),
  });
  return { subscription, details: serializePushSubscription(subscription) };
}

export async function unsubscribeFromWebPush({
  navigatorObject = globalThis.navigator,
  subscription = null,
} = {}) {
  const activeSubscription = subscription ?? await getCurrentPushSubscription({ navigatorObject });
  if (!activeSubscription) return false;
  return activeSubscription.unsubscribe();
}
