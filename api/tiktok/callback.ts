// GET /api/tiktok/callback?code=...&state=...
// TikTok redirects the user here after they authorize. We verify the CSRF
// state cookie, exchange the code for an access token server-side (using the
// client secret), then hand the token back to the opener window via
// postMessage and close the popup.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { exchangeCodeForToken, redirectUri } from '../../lib/tiktok.js';

function page(payloadJson: string): string {
  // The token is delivered to the opener (same origin) then the popup closes.
  return `<!doctype html><meta charset="utf-8"><title>TikTok</title>
<body style="font:15px system-ui;background:#0a0e1a;color:#e5e7eb;display:grid;place-items:center;height:100vh;margin:0">
<div>Connecting TikTok… you can close this window.</div>
<script>
  (function(){
    var payload = ${payloadJson};
    try { if (window.opener) window.opener.postMessage(payload, window.location.origin); } catch(e){}
    setTimeout(function(){ try { window.close(); } catch(e){} }, 300);
  })();
</script></body>`;
}

function readCookie(req: VercelRequest, name: string): string | null {
  const raw = req.headers.cookie || '';
  const m = raw.split(';').map((c) => c.trim()).find((c) => c.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const code = (req.query.code || '').toString();
  const state = (req.query.state || '').toString();
  const err = (req.query.error || '').toString();

  if (err) {
    res.status(200).send(page(JSON.stringify({ type: 'tiktok-auth', ok: false, error: err })));
    return;
  }
  const expected = readCookie(req, 'tt_state');
  if (!code || !state || !expected || state !== expected) {
    res.status(200).send(page(JSON.stringify({ type: 'tiktok-auth', ok: false, error: 'State mismatch — please retry the connection.' })));
    return;
  }
  try {
    const token = await exchangeCodeForToken(code, redirectUri(req));
    // Clear the state cookie.
    res.setHeader('Set-Cookie', 'tt_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
    res.status(200).send(page(JSON.stringify({
      type: 'tiktok-auth', ok: true,
      accessToken: token.access_token,
      openId: token.open_id,
      scope: token.scope,
      expiresIn: token.expires_in,
    })));
  } catch (e) {
    res.status(200).send(page(JSON.stringify({ type: 'tiktok-auth', ok: false, error: (e as Error).message })));
  }
}
