// GET /api/tiktok/auth-url
// Returns the TikTok OAuth authorize URL for the client to open in a popup.
// Sets a short-lived state cookie for CSRF protection (verified in callback).

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { TIKTOK_AUTHORIZE, TIKTOK_SCOPES, clientKey, isConfigured, randomState, redirectUri } from '../../lib/tiktok.js';

export default function handler(req: VercelRequest, res: VercelResponse): void {
  if (!isConfigured()) {
    res.status(501).json({ error: 'TikTok is not configured. Set TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET in the Vercel project.' });
    return;
  }
  const state = randomState();
  const params = new URLSearchParams({
    client_key: clientKey(),
    scope: TIKTOK_SCOPES,
    response_type: 'code',
    redirect_uri: redirectUri(req),
    state,
  });
  // httpOnly state cookie, 10 min, lax so it survives the TikTok redirect back.
  res.setHeader('Set-Cookie', `tt_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
  res.status(200).json({ url: `${TIKTOK_AUTHORIZE}?${params.toString()}` });
}
