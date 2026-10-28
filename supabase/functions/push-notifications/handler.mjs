const MAX_JOB_IDS = 100;
const MAX_PREVIEW_LENGTH = 180;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PUSH_SERVICE_HOSTS = [
  'fcm.googleapis.com',
  'push.services.mozilla.com',
  'push.apple.com',
  'notify.windows.com',
];
const SERVICE_HEADERS = { 'content-type': 'application/json' };

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' },
  });
}

function equalSecret(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

function uuid(value) {
  return typeof value === 'string' && UUID.test(value);
}

function supportedPushEndpoint(value) {
  try {
    const endpoint = new URL(value);
    return endpoint.protocol === 'https:'
      && !endpoint.username
      && !endpoint.password
      && !endpoint.port
      && PUSH_SERVICE_HOSTS.some((host) =>
        endpoint.hostname === host || endpoint.hostname.endsWith(`.${host}`)
      );
  } catch {
    return false;
  }
}

function safeNotification(job) {
  if (!job || !Number.isSafeInteger(Number(job.id)) || !uuid(job.user_id)) return null;
  if (!job.data || typeof job.data !== 'object') return null;
  const data = {};
  if (job.data.type === 'message' && uuid(job.data.chat_id) && uuid(job.data.message_id)) {
    data.type = 'message';
    data.chat_id = job.data.chat_id;
    data.message_id = job.data.message_id;
    data.url = `/?push_chat=${encodeURIComponent(data.chat_id)}&push_message=${encodeURIComponent(data.message_id)}`;
  } else if (job.data.type === 'status_reaction' && uuid(job.data.status_id)) {
    data.type = 'status_reaction';
    data.status_id = job.data.status_id;
    data.url = `/?push_status=${encodeURIComponent(data.status_id)}`;
  } else {
    return null;
  }
  const title = String(job.title ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 120);
  const body = String(job.body ?? '').replace(/\[\[guildkeep-(?:sticker|gif):[^\]]+\]\]/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, MAX_PREVIEW_LENGTH);
  if (!title) return null;
  return {
    id: String(job.id),
    payload: {
      title,
      body: body || 'You have a new Guildkeep notification.',
      icon: '/guildkeep.svg',
      badge: '/guildkeep.svg',
      tag: `guildkeep-${data.type}-${data.message_id ?? data.status_id}`,
      data,
    },
  };
}

export function createPushNotificationHandler({
  getEnv,
  fetchImpl = fetch,
  sendNotification,
}) {
  return async function handlePushNotifications(request) {
    if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405);

    const expectedSecret = getEnv('PUSH_WEBHOOK_SECRET');
    if (!expectedSecret || !equalSecret(request.headers.get('x-push-webhook-secret'), expectedSecret)) {
      return jsonResponse({ error: 'Not authorized.' }, 401);
    }

    const supabaseUrl = getEnv('SUPABASE_URL');
    const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');
    const vapidPublicKey = getEnv('VAPID_PUBLIC_KEY');
    const vapidPrivateKey = getEnv('VAPID_PRIVATE_KEY');
    const vapidSubject = getEnv('VAPID_SUBJECT');
    if (!supabaseUrl || !serviceKey || !vapidPublicKey || !vapidPrivateKey || !vapidSubject || !sendNotification) {
      console.error('Push delivery is missing required server configuration.');
      return jsonResponse({ error: 'Push delivery is not configured.' }, 503);
    }

    let payload;
    try {
      payload = await request.json();
    } catch (error) {
      console.error('Push delivery received malformed JSON.', error);
      return jsonResponse({ error: 'Invalid request body.' }, 400);
    }
    const jobIds = Array.isArray(payload?.job_ids)
      ? [...new Set(payload.job_ids.filter((id) =>
        (typeof id === 'number' && Number.isSafeInteger(id) && id > 0)
        || (typeof id === 'string' && /^\d{1,18}$/.test(id))
      ).map(String))].slice(0, MAX_JOB_IDS)
      : [];
    if (!jobIds.length) return jsonResponse({ error: 'At least one valid job ID is required.' }, 400);

    const baseUrl = supabaseUrl.replace(/\/+$/, '');
    const serviceHeaders = {
      ...SERVICE_HEADERS,
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
    };
    const dbRequest = async (path, options = {}) => fetchImpl(new URL(path, `${baseUrl}/`), {
      ...options,
      headers: { ...serviceHeaders, ...options.headers },
    });

    let claimed;
    try {
      const response = await dbRequest('/rest/v1/rpc/claim_push_notification_jobs', {
        method: 'POST',
        body: JSON.stringify({ target_job_ids: jobIds }),
      });
      if (!response.ok) {
        console.error('Could not claim push notification jobs.', response.status);
        return jsonResponse({ error: 'Could not claim push notification jobs.' }, 502);
      }
      claimed = await response.json();
      if (!Array.isArray(claimed)) {
        console.error('Push notification job claim returned an invalid response.');
        return jsonResponse({ error: 'Could not claim push notification jobs.' }, 502);
      }
    } catch (error) {
      console.error('Push notification job claim failed.', error);
      return jsonResponse({ error: 'Could not claim push notification jobs.' }, 502);
    }

    let sent = 0;
    let retried = 0;
    for (const job of claimed) {
      const safe = safeNotification(job);
      if (!safe) {
        console.error('Push notification job has an invalid payload.', job?.id);
        await dbRequest(`/rest/v1/push_notification_jobs?id=eq.${encodeURIComponent(String(job.id))}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'failed', last_error: 'Invalid notification payload', processing_at: null }),
        });
        continue;
      }

      try {
        const subscriptionsUrl = new URL('/rest/v1/push_subscriptions', `${baseUrl}/`);
        subscriptionsUrl.searchParams.set('select', 'id,endpoint,p256dh,auth');
        subscriptionsUrl.searchParams.set('user_id', `eq.${job.user_id}`);
        const subscriptionsResponse = await fetchImpl(subscriptionsUrl, { headers: serviceHeaders });
        if (!subscriptionsResponse.ok) throw new Error('Subscription lookup failed.');
        const subscriptions = await subscriptionsResponse.json();
        if (!Array.isArray(subscriptions)) throw new Error('Subscription lookup returned invalid data.');

        const delivered = new Set(Array.isArray(job.delivered_subscription_ids)
          ? job.delivered_subscription_ids.map(String)
          : []);
        let failed = false;
        for (const subscription of subscriptions) {
          if (!uuid(subscription.id) || delivered.has(subscription.id)) continue;
          if (!supportedPushEndpoint(subscription.endpoint)) {
            console.error('Stored push subscription has an unsupported endpoint.', safe.id);
            const removeResponse = await dbRequest(
              `/rest/v1/push_subscriptions?id=eq.${encodeURIComponent(subscription.id)}`,
              { method: 'DELETE' },
            );
            if (!removeResponse.ok) throw new Error('Could not remove unsupported push subscription.');
            delivered.add(subscription.id);
            continue;
          }
          try {
            await sendNotification({
              endpoint: subscription.endpoint,
              keys: { p256dh: subscription.p256dh, auth: subscription.auth },
            }, safe.payload, { publicKey: vapidPublicKey, privateKey: vapidPrivateKey, subject: vapidSubject });
            delivered.add(subscription.id);
            const markResponse = await dbRequest(
              `/rest/v1/push_notification_jobs?id=eq.${encodeURIComponent(safe.id)}&status=eq.processing`,
              {
                method: 'PATCH',
                body: JSON.stringify({ delivered_subscription_ids: [...delivered] }),
              },
            );
            if (!markResponse.ok) throw new Error('Could not record push delivery.');
            sent += 1;
          } catch (error) {
            const statusCode = Number(error?.statusCode ?? error?.status);
            if (statusCode === 404 || statusCode === 410) {
              const removeResponse = await dbRequest(
                `/rest/v1/push_subscriptions?id=eq.${encodeURIComponent(subscription.id)}`,
                { method: 'DELETE' },
              );
              if (!removeResponse.ok) throw new Error('Could not remove expired push subscription.');
              delivered.add(subscription.id);
              continue;
            }
            failed = true;
            console.error('Could not send push notification to a subscription.', safe.id, statusCode || 'unknown');
          }
        }

        const jobUrl = `/rest/v1/push_notification_jobs?id=eq.${encodeURIComponent(safe.id)}&status=eq.processing`;
        if (failed) {
          const attempts = Number(job.attempts) || 0;
          const retryResponse = await dbRequest(jobUrl, {
            method: 'PATCH',
            body: JSON.stringify({
              status: attempts >= 5 ? 'failed' : 'pending',
              processing_at: null,
              delivered_subscription_ids: [...delivered],
              last_error: attempts >= 5 ? 'Push delivery failed after five attempts.' : 'Push service temporarily unavailable.',
            }),
          });
          if (!retryResponse.ok) throw new Error('Could not schedule push retry.');
          retried += 1;
        } else {
          const deleteResponse = await dbRequest(jobUrl, { method: 'DELETE' });
          if (!deleteResponse.ok) throw new Error('Could not clear delivered push notification.');
        }
      } catch (error) {
        console.error('Push notification job failed.', safe.id, error);
        const attempts = Number(job.attempts) || 0;
        const retryResponse = await dbRequest(
          `/rest/v1/push_notification_jobs?id=eq.${encodeURIComponent(safe.id)}&status=eq.processing`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              status: attempts >= 5 ? 'failed' : 'pending',
              processing_at: null,
              last_error: attempts >= 5 ? 'Push delivery failed after five attempts.' : 'Push service temporarily unavailable.',
            }),
          },
        );
        if (!retryResponse.ok) {
          console.error('Could not record failed push notification job.', safe.id);
          return jsonResponse({ error: 'Could not record push delivery failure.' }, 502);
        }
        retried += 1;
      }
    }
    return jsonResponse({ claimed: claimed.length, sent, retried });
  };
}
