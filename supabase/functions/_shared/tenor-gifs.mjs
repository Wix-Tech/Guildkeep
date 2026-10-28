export const TENOR_GIF_HOST = 'media.tenor.com';
export const TENOR_GIF_LIMIT = 20;
export const TENOR_QUERY_MAX_LENGTH = 80;

export function normalizeTenorQuery(value) {
  if (typeof value !== 'string') throw new TypeError('Enter a search term.');
  const query = value.trim();
  if (query.length < 2) throw new RangeError('Enter at least 2 characters to search GIFs.');
  if (query.length > TENOR_QUERY_MAX_LENGTH) {
    throw new RangeError(`GIF searches must be ${TENOR_QUERY_MAX_LENGTH} characters or fewer.`);
  }
  return query;
}

export function safeTenorGifUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:'
      || url.hostname.toLowerCase() !== TENOR_GIF_HOST
      || url.username
      || url.password
      || !url.pathname.toLowerCase().endsWith('.gif')
    ) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function createTenorGifToken(value) {
  const url = safeTenorGifUrl(value);
  if (!url) throw new TypeError('Choose a GIF hosted on Tenor.');
  return `[[guildkeep-gif:${url}]]`;
}

export function normalizeTenorResults(payload) {
  if (!Array.isArray(payload?.results)) return [];
  return payload.results.slice(0, TENOR_GIF_LIMIT).flatMap((result) => {
    const formats = result?.media_formats;
    const gifUrl = safeTenorGifUrl(result?.gifUrl)
      ?? safeTenorGifUrl(formats?.gif?.url)
      ?? safeTenorGifUrl(formats?.mediumgif?.url)
      ?? safeTenorGifUrl(formats?.tinygif?.url);
    if (!gifUrl) return [];
    const previewUrl = safeTenorGifUrl(result?.previewUrl)
      ?? safeTenorGifUrl(formats?.tinygif?.url)
      ?? safeTenorGifUrl(formats?.nanogif?.url)
      ?? gifUrl;
    const id = typeof result.id === 'string' ? result.id.slice(0, 80) : '';
    if (!id) return [];
    const title = String(result.content_description ?? result.title ?? 'GIF').trim().slice(0, 120) || 'GIF';
    return [{ id, title, previewUrl, gifUrl }];
  });
}
