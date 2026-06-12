// Vercel serverless function: streams a TikTok CDN image through with
// CORS headers so the browser can fetch it and stuff it into the media
// bank IndexedDB store. TikTok's image CDNs don't return permissive
// CORS, so a direct browser fetch fails for taint reasons.
//
// Allowlisted to TikTok CDN hostnames only — otherwise this would be
// an open proxy.

import type { VercelRequest, VercelResponse } from '@vercel/node';

const TIKTOK_CDN_PATTERNS: RegExp[] = [
  /\.tiktokcdn\.com$/i,
  /\.tiktokcdn-us\.com$/i,
  /\.tiktokcdn-eu\.com$/i,
  /\.tiktokv\.com$/i,
  /\.bytedanceapi\.com$/i,
  /\.ibyteimg\.com$/i,
  /\.byteimg\.com$/i,
  /\.muscdn\.com$/i,
];

function isAllowedHost(url: string): boolean {
  try {
    const u = new URL(url);
    return TIKTOK_CDN_PATTERNS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

// Fetch the CDN image, retrying transient failures (network blips, 5xx).
async function fetchWithRetry(target: string, init: RequestInit): Promise<Response> {
  const maxAttempts = 3;
  let lastErr: Error | null = null;
  for (let a = 0; a < maxAttempts; a++) {
    let res: Response;
    try {
      res = await fetch(target, init);
    } catch (e) {
      lastErr = e as Error;
      if (a < maxAttempts - 1) { await new Promise((r) => setTimeout(r, 600 * (a + 1))); continue; }
      throw e;
    }
    if (res.ok || res.status < 500 || a === maxAttempts - 1) return res;
    await new Promise((r) => setTimeout(r, 600 * (a + 1)));
  }
  throw lastErr || new Error('Upstream fetch failed.');
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Use GET ?url=<tiktok cdn url>' });
    return;
  }

  const target = (req.query.url || '').toString();
  if (!target) {
    res.status(400).json({ error: 'Missing ?url=' });
    return;
  }
  if (!isAllowedHost(target)) {
    res.status(400).json({ error: 'URL not on TikTok CDN allowlist.' });
    return;
  }

  try {
    const upstream = await fetchWithRetry(target, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 ' +
          '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
        'Referer': 'https://www.tiktok.com/',
        'Accept': 'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.8',
      },
      redirect: 'follow',
    });
    if (!upstream.ok || !upstream.body) {
      res.status(502).json({ error: `Upstream image fetch failed (${upstream.status})` });
      return;
    }

    const buf = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400, immutable');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).send(buf);
  } catch (e) {
    res.status(500).json({ error: `Proxy failed: ${(e as Error).message}` });
  }
}
