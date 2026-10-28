self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data?.json() ?? {};
  } catch (error) {
    console.error('Guildkeep received an invalid push notification.', error);
  }
  const title = typeof payload.title === 'string' && payload.title.trim()
    ? payload.title.slice(0, 120)
    : 'Guildkeep';
  const options = {
    body: typeof payload.body === 'string' ? payload.body.slice(0, 220) : 'You have a new notification.',
    icon: '/guildkeep.svg',
    badge: '/guildkeep.svg',
    tag: typeof payload.tag === 'string' ? payload.tag.slice(0, 100) : 'guildkeep-notification',
    data: payload.data && typeof payload.data === 'object' ? payload.data : {},
    renotify: false,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data ?? {};
  const target = new URL(data.url ?? '/', self.location.origin);
  if (target.origin !== self.location.origin) target.href = '/';
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin !== self.location.origin) continue;
      await client.focus();
      client.postMessage({ type: 'guildkeep-push-click', data });
      return;
    }
    await self.clients.openWindow(target.toString());
  })());
});
