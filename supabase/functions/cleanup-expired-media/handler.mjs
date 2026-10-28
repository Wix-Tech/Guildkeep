const MAX_BATCHES = 20;
const BATCH_SIZE = 100;
const CHAT_MEDIA_PATH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[^/]{1,255}$/i;
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
  'cache-control': 'no-store',
  vary: 'origin',
};

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json; charset=utf-8' },
  });
}

function messageMediaFilter(paths) {
  const quotedPaths = paths.map((path) =>
    `"${path.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  );
  return `in.(${quotedPaths.join(',')})`;
}

export function createExpiredMediaCleanupHandler({ getEnv, fetchImpl = fetch }) {
  return async function handleExpiredMediaCleanup(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405);

    const authorization = request.headers.get('authorization');
    if (!/^Bearer\s+\S+$/i.test(authorization ?? '')) {
      return jsonResponse({ error: 'Sign in to clean up expired attachments.' }, 401);
    }

    const supabaseUrl = getEnv('SUPABASE_URL');
    const anonKey = getEnv('SUPABASE_ANON_KEY') ?? getEnv('SUPABASE_PUBLISHABLE_KEY');
    const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !anonKey || !serviceKey) {
      console.error('Expired-media cleanup is missing Supabase server configuration.');
      return jsonResponse({ error: 'Expired-media cleanup is not configured.' }, 503);
    }

    try {
      const authResponse = await fetchImpl(new URL('/auth/v1/user', supabaseUrl), {
        headers: { apikey: anonKey, authorization },
      });
      if (authResponse.status === 401 || authResponse.status === 403) {
        return jsonResponse({ error: 'Sign in to clean up expired attachments.' }, 401);
      }
      if (!authResponse.ok) {
        console.error('Supabase could not validate the expired-media cleanup session.', authResponse.status);
        return jsonResponse({ error: 'Could not validate your session.' }, 502);
      }

      const serviceHeaders = {
        apikey: serviceKey,
        authorization: `Bearer ${serviceKey}`,
      };
      let deleted = 0;
      for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
        const queueUrl = new URL('/rest/v1/expired_message_media', supabaseUrl);
        queueUrl.searchParams.set('select', 'media_path');
        queueUrl.searchParams.set('order', 'expired_at.asc');
        queueUrl.searchParams.set('limit', String(BATCH_SIZE));
        const queueResponse = await fetchImpl(queueUrl, { headers: serviceHeaders });
        if (!queueResponse.ok) {
          console.error('Could not read the expired-media cleanup queue.', queueResponse.status);
          return jsonResponse({ error: 'Could not read the expired-media cleanup queue.' }, 502);
        }

        let queue;
        try {
          queue = await queueResponse.json();
        } catch (error) {
          console.error('The expired-media cleanup queue returned invalid JSON.', error);
          return jsonResponse({ error: 'The expired-media cleanup queue returned an invalid response.' }, 502);
        }
        if (!Array.isArray(queue)) {
          console.error('The expired-media cleanup queue returned an invalid response shape.');
          return jsonResponse({ error: 'The expired-media cleanup queue returned an invalid response.' }, 502);
        }
        if (!queue.length) return jsonResponse({ deleted });

        const paths = queue.map((item) => item?.media_path);
        if (paths.some((path) => typeof path !== 'string' || !CHAT_MEDIA_PATH.test(path))) {
          console.error('The expired-media cleanup queue contains an invalid storage path.');
          return jsonResponse({ error: 'The cleanup queue contains an invalid attachment path.' }, 500);
        }

        const removeUrl = new URL('/storage/v1/object/chat-media', supabaseUrl);
        const removeResponse = await fetchImpl(removeUrl, {
          method: 'DELETE',
          headers: { ...serviceHeaders, 'content-type': 'application/json' },
          body: JSON.stringify({ prefixes: paths }),
        });
        if (!removeResponse.ok) {
          console.error('Supabase Storage could not remove expired attachments.', removeResponse.status);
          return jsonResponse({ error: 'Could not remove expired attachments.' }, 502);
        }

        const deleteQueueUrl = new URL('/rest/v1/expired_message_media', supabaseUrl);
        deleteQueueUrl.searchParams.set('media_path', messageMediaFilter(paths));
        const queueDeleteResponse = await fetchImpl(deleteQueueUrl, {
          method: 'DELETE',
          headers: { ...serviceHeaders, prefer: 'return=minimal' },
        });
        if (!queueDeleteResponse.ok) {
          console.error('Could not clear the expired-media cleanup queue.', queueDeleteResponse.status);
          return jsonResponse({ error: 'Could not clear the expired-media cleanup queue.' }, 502);
        }
        deleted += paths.length;
      }
      return jsonResponse({ deleted });
    } catch (error) {
      console.error('Expired-media cleanup request failed.', error);
      return jsonResponse({ error: 'Expired-media cleanup is temporarily unavailable.' }, 502);
    }
  };
}
