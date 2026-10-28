export const GIPHY_GIF_LIMIT = 20;
export const GIPHY_QUERY_MAX_LENGTH = 50;

const GIPHY_MEDIA_HOST = /^(?:media\d*|i)\.giphy\.com$/i;

export function normalizeGiphyQuery(value) {
  if (typeof value !== 'string') throw new TypeError('Enter a search term.');
  const query = value.trim();
  if (query.length < 2) throw new RangeError('Enter at least 2 characters to search GIFs.');
  if (query.length > GIPHY_QUERY_MAX_LENGTH) {
    throw new RangeError(`GIF searches must be ${GIPHY_QUERY_MAX_LENGTH} characters or fewer.`);
  }
  return query;
}

export function safeGiphyGifUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (
      url.protocol !== 'https:'
      || !(hostname === 'media.tenor.com' || GIPHY_MEDIA_HOST.test(hostname))
      || url.username
      || url.password
      || !url.pathname.toLowerCase().endsWith('.gif')
    ) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function createGiphyGifToken(value) {
  const url = safeGiphyGifUrl(value);
  if (!url) throw new TypeError('Choose a GIF hosted on GIPHY or Tenor.');
  return `[[guildkeep-gif:${url}]]`;
}

export function giphyAttributionUrl(value) {
  const safeUrl = safeGiphyGifUrl(value);
  if (!safeUrl) return null;
  return new URL(safeUrl).hostname.toLowerCase() === 'media.tenor.com'
    ? 'https://tenor.com'
    : 'https://giphy.com';
}

export function normalizeGiphyResults(payload) {
  if (!Array.isArray(payload?.data)) return [];
  return payload.data.slice(0, GIPHY_GIF_LIMIT).flatMap((gif) => {
    const formats = gif?.images;
    const gifUrl = safeGiphyGifUrl(formats?.original?.url);
    if (!gifUrl) return [];
    const previewUrl = safeGiphyGifUrl(formats?.fixed_width_small?.url)
      ?? safeGiphyGifUrl(formats?.fixed_width?.url)
      ?? safeGiphyGifUrl(formats?.downsized_small?.url)
      ?? gifUrl;
    const id = typeof gif.id === 'string' ? gif.id.slice(0, 80) : '';
    if (!id) return [];
    const title = String(gif.title ?? 'GIF').trim().slice(0, 120) || 'GIF';
    return [{ id, title, previewUrl, gifUrl }];
  });
}

export async function searchGiphyGifs(query, apiKey, fetchImpl = fetch) {
  const normalizedQuery = normalizeGiphyQuery(query);
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    throw new Error('GIF search is not configured. Add VITE_GIPHY_API_KEY to the Vercel production environment.');
  }

  const url = new URL('https://api.giphy.com/v1/gifs/search');
  url.searchParams.set('api_key', apiKey.trim());
  url.searchParams.set('q', normalizedQuery);
  url.searchParams.set('limit', String(GIPHY_GIF_LIMIT));
  url.searchParams.set('rating', 'pg');
  url.searchParams.set('lang', 'en');
  url.searchParams.set('bundle', 'messaging_non_clips');

  let response;
  try {
    response = await fetchImpl(url);
  } catch {
    throw new Error('Could not connect to GIPHY. Check your connection and try again.');
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error('GIPHY rejected the API key or app access. Check the key and app status.');
    }
    if (response.status === 429) throw new Error('GIPHY search is rate limited. Try again shortly.');
    throw new Error('GIPHY search is temporarily unavailable.');
  }

  const payload = await response.json();
  return normalizeGiphyResults(payload);
}
