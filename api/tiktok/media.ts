// GET /api/tiktok/media?src=<vercel-blob-url>
// Streams a previously-uploaded slide image from Vercel Blob through THIS
// deployment's own domain. TikTok's PULL_FROM_URL only accepts URLs whose
// domain you've verified in the developer portal — your blob storage domain
// isn't user-verifiable, but your app domain is, so we proxy through here.
//
// SSRF-safe: `src` must be a vercel-storage.com blob URL.

import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const src = (req.query.src || '').toString();
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    res.status(400).json({ error: 'Bad src' });
    return;
  }
  if (url.protocol !== 'https:' || !/\.blob\.vercel-storage\.com$/i.test(url.hostname)) {
    res.status(400).json({ error: 'src must be a Vercel Blob URL.' });
    return;
  }
  try {
    const upstream = await fetch(url.toString());
    if (!upstream.ok) {
      res.status(502).json({ error: `Blob fetch ${upstream.status}` });
      return;
    }
    const ct = upstream.headers.get('content-type') || 'image/jpeg';
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).send(buf);
  } catch (e) {
    res.status(500).json({ error: `Media proxy failed: ${(e as Error).message}` });
  }
}
