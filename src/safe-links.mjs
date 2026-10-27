const WEB_URL_PATTERN = /https?:\/\/[^\s<>"']+/giu;

export function safeLinkDetails(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;

  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (
    !hostname
    || hostname.startsWith('[')
    || /^[\d.]+$/.test(hostname)
    || /^[\d.]+$/.test(hostname)
    || !hostname.includes('.')
    || ['localhost', 'local', 'internal', 'lan', 'home', 'test', 'invalid'].some(
      (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`),
    )
  ) return null;

  return {
    href: url.href,
    hostname,
    detail: `${url.pathname}${url.search}` === '/' ? '' : `${url.pathname}${url.search}`,
  };
}

export function renderSafeLinks(text) {
  const value = String(text ?? '');
  let output = '';
  let lastIndex = 0;
  let previewCount = 0;

  for (const match of value.matchAll(WEB_URL_PATTERN)) {
    const raw = match[0];
    const url = raw.replace(/[.,!?;:]+$/u, '');
    const trailing = raw.slice(url.length);
    const details = safeLinkDetails(url);
    output += escapeHtml(value.slice(lastIndex, match.index));
    if (!details) {
      output += escapeHtml(raw);
      lastIndex = match.index + raw.length;
      continue;
    }

    output += `<a class="message-link" href="${escapeHtml(details.href)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHtml(url)}</a>`;
    if (previewCount < 3) {
      previewCount += 1;
      output += `<a class="message-link-preview" href="${escapeHtml(details.href)}" target="_blank" rel="noopener noreferrer nofollow" aria-label="Open ${escapeHtml(details.hostname)} in a new tab">
        <strong>${escapeHtml(details.hostname)}</strong>
        ${details.detail ? `<span>${escapeHtml(details.detail)}</span>` : ''}
      </a>`;
    }
    output += escapeHtml(trailing);
    lastIndex = match.index + raw.length;
  }
  return output + escapeHtml(value.slice(lastIndex));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
  );
}
