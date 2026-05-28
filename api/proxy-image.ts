// Generic image proxy. Browsers can't draw cross-origin images to a
// canvas without CORS headers from the upstream — so html2canvas-based
// slide export fails silently for any pasted URL that comes from a
// non-CORS host (Pinterest, most CDNs, scraped image sources). The
// React side calls this endpoint on URL paste, gets the bytes back
// with permissive CORS headers, stores the blob in the media bank,
// and uses it as a data URL during render. Same trick as the
// /api/proxy-tiktok-image function, just with an open URL space.
//
// Abuse mitigations (this is a personal tool, not a public proxy):
// - http/https only
// - blocks localhost / private-IP ranges to prevent SSRF
// - 10 MB / 30 s caps
// - rejects non-image upstream content types

import type { VercelRequest, VercelResponse } from '@vercel/node';

const MAX_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 30000;

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '0.0.0.0',
  '127.0.0.1',
  '::1',
  'metadata.google.internal',
]);

function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(h)) return true;
  // RFC 1918 + link-local + loopback + IPv6 link-local
  if (/^127\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  if (/^fe80:/i.test(h)) return true;
  return false;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Use GET ?url=<image url>' });
    return;
  }

  const target = (req.query.url || '').toString();
  if (!target) {
    res.status(400).json({ error: 'Missing ?url=' });
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    res.status(400).json({ error: 'Not a valid URL' });
    return;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    res.status(400).json({ error: 'Only http/https URLs are supported.' });
    return;
  }
  if (isBlockedHost(parsed.hostname)) {
    res.status(400).json({ error: 'Host is not allowed.' });
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const upstream = await fetch(target, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.8',
      },
      signal: controller.signal,
      redirect: 'follow',
    });

    if (!upstream.ok) {
      res.status(502).json({ error: `Upstream returned ${upstream.status}.` });
      return;
    }

    const contentType = upstream.headers.get('content-type') || 'image/jpeg';
    if (!contentType.toLowerCase().startsWith('image/')) {
      res.status(415).json({ error: `Upstream returned non-image content (${contentType}).` });
      return;
    }

    const advertisedLen = Number(upstream.headers.get('content-length') || '0');
    if (advertisedLen && advertisedLen > MAX_BYTES) {
      res.status(413).json({ error: `Image too large (${advertisedLen} bytes > ${MAX_BYTES}).` });
      return;
    }

    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.length > MAX_BYTES) {
      res.status(413).json({ error: `Image too large (${buf.length} bytes > ${MAX_BYTES}).` });
      return;
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400, immutable');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).send(buf);
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      res.status(504).json({ error: 'Upstream timed out.' });
    } else {
      res.status(500).json({ error: `Proxy failed: ${(e as Error).message}` });
    }
  } finally {
    clearTimeout(timeout);
  }
}
