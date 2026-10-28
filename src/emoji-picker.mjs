export const RECENT_EMOJI_STORAGE_KEY = 'guildkeep.recent-emojis';
export const RECENT_EMOJI_LIMIT = 8;

export function normalizeRecentEmojis(values, availableEmojis) {
  if (!Array.isArray(values)) return [];
  const available = new Set(availableEmojis);
  const recent = [];
  for (const emoji of values) {
    if (typeof emoji !== 'string' || !available.has(emoji) || recent.includes(emoji)) continue;
    recent.push(emoji);
    if (recent.length === RECENT_EMOJI_LIMIT) break;
  }
  return recent;
}

export function addRecentEmoji(recent, emoji, availableEmojis) {
  const available = new Set(availableEmojis);
  if (!available.has(emoji)) return normalizeRecentEmojis(recent, available);
  return normalizeRecentEmojis([emoji, ...(Array.isArray(recent) ? recent : [])], available);
}

export function createStickerToken(id) {
  if (typeof id !== 'string' || !/^[a-z0-9-]+$/.test(id)) {
    throw new TypeError('Sticker ID must contain only lowercase letters, numbers, and hyphens.');
  }
  return `[[guildkeep-sticker:${id}]]`;
}

export function splitPickerContent(value) {
  const text = String(value ?? '');
  const tokenPattern = /\[\[guildkeep-(sticker|gif):([^\]]+)\]\]/g;
  const segments = [];
  let lastIndex = 0;
  for (const match of text.matchAll(tokenPattern)) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }
    segments.push({ type: match[1], value: match[2], token: match[0] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length || !segments.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) });
  }
  return segments;
}
