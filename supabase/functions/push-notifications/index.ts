import webpush from 'npm:web-push@3.6.7';
import { createPushNotificationHandler } from './handler.mjs';

Deno.serve(createPushNotificationHandler({
  getEnv: (name) => Deno.env.get(name),
  sendNotification: (subscription, payload, vapid) => {
    webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
    return webpush.sendNotification(subscription, JSON.stringify(payload));
  },
}));
