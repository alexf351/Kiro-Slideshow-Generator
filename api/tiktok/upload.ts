// POST /api/tiktok/upload   body: { dataUrl: "data:image/jpeg;base64,..." }
// Stores one slide image in Vercel Blob and returns a media URL served from
// THIS deployment's own domain (via /api/tiktok/media), so the URL's domain
// can be verified in the TikTok developer portal for PULL_FROM_URL.
//
// Requires Vercel Blob enabled on the project (provides BLOB_READ_WRITE_TOKEN).

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { put } from '@vercel/blob';
import { originFromRequest, resolveBlobToken } from '../../lib/tiktok.js';

const MAX_BYTES = 8 * 1024 * 1024;

export const config = { api: { bodyParser: { sizeLimit: '12mb' } } };

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }
  const blobToken = resolveBlobToken();
  if (!blobToken) {
    res.status(501).json({ error: 'Vercel Blob is not enabled on this project (no BLOB_READ_WRITE_TOKEN).' });
    return;
  }
  const dataUrl = (req.body && (req.body.dataUrl as string)) || '';
  const m = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(dataUrl);
  if (!m) {
    res.status(400).json({ error: 'Expected { dataUrl } as a base64 image data URL.' });
    return;
  }
  const contentType = m[1].toLowerCase();
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > MAX_BYTES) {
    res.status(413).json({ error: `Image too large (${buf.length} bytes).` });
    return;
  }
  try {
    const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
    const id = `tiktok/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
    // addRandomSuffix:false keeps the pathname predictable; access public so
    // the media proxy can stream it back.
    const blob = await put(id, buf, { access: 'public', contentType, addRandomSuffix: false, token: blobToken });
    const mediaUrl = `${originFromRequest(req)}/api/tiktok/media?src=${encodeURIComponent(blob.url)}`;
    res.status(200).json({ mediaUrl, blobUrl: blob.url });
  } catch (e) {
    res.status(500).json({ error: `Blob upload failed: ${(e as Error).message}` });
  }
}
