import {
  normalizeTenorQuery,
  normalizeTenorResults,
  TENOR_GIF_LIMIT,
} from '../_shared/tenor-gifs.mjs';

const MAX_REQUEST_BYTES = 2048;
const REQUEST_TIMEOUT_MS = 8000;
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

export function createTenorSearchHandler({ getEnv, fetchImpl = fetch }) {
  return async function handleTenorSearch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405);

    const authorization = request.headers.get('authorization');
    if (!/^Bearer\s+\S+$/i.test(authorization ?? '')) {
      return jsonResponse({ error: 'Sign in to search GIFs.' }, 401);
    }

    let requestText;
    try {
      requestText = await request.text();
    } catch (error) {
      console.error('Could not read the GIF search request.', error);
      return jsonResponse({ error: 'Could not read the search request.' }, 400);
    }
    if (new TextEncoder().encode(requestText).byteLength > MAX_REQUEST_BYTES) {
      return jsonResponse({ error: 'The search request is too large.' }, 413);
    }

    let body;
    try {
      body = JSON.parse(requestText);
    } catch {
      return jsonResponse({ error: 'Send a valid JSON search request.' }, 400);
    }

    let query;
    try {
      query = normalizeTenorQuery(body?.query);
    } catch (error) {
      return jsonResponse({ error: error.message }, 400);
    }

    const supabaseUrl = getEnv('SUPABASE_URL');
    const supabaseKey = getEnv('SUPABASE_ANON_KEY') ?? getEnv('SUPABASE_PUBLISHABLE_KEY');
    const tenorKey = getEnv('TENOR_API_KEY');
    if (!supabaseUrl || !supabaseKey) {
      console.error('GIF search is missing Supabase authentication configuration.');
      return jsonResponse({ error: 'GIF search is not configured.' }, 503);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const authUrl = new URL('/auth/v1/user', supabaseUrl);
      const authResponse = await fetchImpl(authUrl, {
        headers: {
          apikey: supabaseKey,
          authorization,
        },
        signal: controller.signal,
      });
      if (authResponse.status === 401 || authResponse.status === 403) {
        return jsonResponse({ error: 'Sign in to search GIFs.' }, 401);
      }
      if (!authResponse.ok) {
        console.error('Supabase could not validate the GIF search session.', authResponse.status);
        return jsonResponse({ error: 'Could not validate your session.' }, 502);
      }
      if (!tenorKey) {
        console.error('GIF search is missing the TENOR_API_KEY secret.');
        return jsonResponse({ error: 'GIF search is not configured.' }, 503);
      }

      const tenorUrl = new URL('https://tenor.googleapis.com/v2/search');
      tenorUrl.searchParams.set('key', tenorKey);
      tenorUrl.searchParams.set('client_key', 'guildkeep_chat');
      tenorUrl.searchParams.set('q', query);
      tenorUrl.searchParams.set('limit', String(TENOR_GIF_LIMIT));
      tenorUrl.searchParams.set('media_filter', 'tinygif,gif');
      tenorUrl.searchParams.set('contentfilter', 'medium');
      const tenorResponse = await fetchImpl(tenorUrl, { signal: controller.signal });
      if (!tenorResponse.ok) {
        console.error('Tenor GIF search returned an error.', tenorResponse.status);
        if ([400, 401, 403].includes(tenorResponse.status)) {
          return jsonResponse({ error: 'Tenor rejected the API key or access. Check TENOR_API_KEY and its API access.' }, 502);
        }
        if (tenorResponse.status === 429) {
          return jsonResponse({ error: 'Tenor GIF search is rate limited. Try again shortly.' }, 429);
        }
        return jsonResponse({ error: 'GIF search is temporarily unavailable.' }, 502);
      }
      const payload = await tenorResponse.json();
      return jsonResponse({ results: normalizeTenorResults(payload) });
    } catch (error) {
      console.error('Tenor GIF search request failed.', error);
      return jsonResponse({ error: 'GIF search is temporarily unavailable.' }, 502);
    } finally {
      clearTimeout(timeout);
    }
  };
}
