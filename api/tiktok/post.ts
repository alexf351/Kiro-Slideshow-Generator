// POST /api/tiktok/post
//   body: { accessToken, mediaUrls: string[], caption?: string }
// Sends the slides to the connected account's TikTok inbox as a photo draft
// (post_mode MEDIA_UPLOAD). The user finishes/publishes from the TikTok app.
//
// Uses the Content Posting API photo flow with PULL_FROM_URL — TikTok fetches
// each slide from the /api/tiktok/media URLs (your verified app domain).

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { TIKTOK_POST_INIT } from '../../lib/tiktok.js';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }
  const accessToken = (req.body && (req.body.accessToken as string)) || '';
  const mediaUrls = (req.body && (req.body.mediaUrls as string[])) || [];
  const caption = ((req.body && (req.body.caption as string)) || '').slice(0, 2200);

  if (!accessToken) {
    res.status(400).json({ error: 'Missing accessToken. Connect TikTok first.' });
    return;
  }
  if (!Array.isArray(mediaUrls) || mediaUrls.length === 0) {
    res.status(400).json({ error: 'No slide images to post.' });
    return;
  }
  if (mediaUrls.length > 35) {
    res.status(400).json({ error: 'TikTok photo posts support up to 35 images.' });
    return;
  }

  const payload = {
    post_info: {
      title: caption || '',
      description: caption || '',
      disable_comment: false,
      auto_add_music: true,
    },
    source_info: {
      source: 'PULL_FROM_URL',
      photo_cover_index: 0,
      photo_images: mediaUrls,
    },
    post_mode: 'MEDIA_UPLOAD', // → lands in the account's inbox as a draft
    media_type: 'PHOTO',
  };

  try {
    const r = await fetch(TIKTOK_POST_INIT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify(payload),
    });
    const data = (await r.json()) as { data?: { publish_id?: string }; error?: { code?: string; message?: string } };
    const errCode = data.error?.code;
    if (!r.ok || (errCode && errCode !== 'ok')) {
      res.status(502).json({ error: data.error?.message || `TikTok rejected the post (${errCode || r.status}).`, code: errCode });
      return;
    }
    res.status(200).json({ ok: true, publishId: data.data?.publish_id });
  } catch (e) {
    res.status(500).json({ error: `Post failed: ${(e as Error).message}` });
  }
}
