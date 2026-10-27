import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSafeLinks, safeLinkDetails } from '../src/safe-links.mjs';

test('safe links only produce clickable previews for public HTTP(S) domains', () => {
  assert.equal(safeLinkDetails('javascript:alert(1)'), null);
  assert.equal(safeLinkDetails('https://user:secret@example.com/path'), null);
  assert.equal(safeLinkDetails('http://127.0.0.1/admin'), null);
  assert.equal(safeLinkDetails('http://192.168.1.10'), null);
  assert.equal(safeLinkDetails('http://localhost'), null);
  assert.equal(safeLinkDetails('http://[::1]/'), null);
  assert.equal(safeLinkDetails('http://intranet'), null);
  assert.equal(safeLinkDetails('https://example.com/path?query=1').hostname, 'example.com');
});

test('link cards escape message content, avoid remote metadata, and cap previews at three', () => {
  const html = renderSafeLinks(
    '<script>alert(1)</script> https://example.com/a, https://example.org/b https://example.net/c https://example.edu/d',
  );
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.equal((html.match(/class="message-link-preview"/g) ?? []).length, 3);
  assert.match(html, /rel="noopener noreferrer nofollow"/);
  assert.doesNotMatch(html, /<(?:script|img|iframe)\b/i);
  assert.doesNotMatch(html, /\b(?:fetch|XMLHttpRequest)\s*\(/i);
});
