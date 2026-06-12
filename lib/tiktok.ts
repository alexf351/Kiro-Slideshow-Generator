// Shared helpers for the TikTok Content Posting integration. Lives outside
// api/ so Vercel doesn't try to build it as its own serverless function;
// the api/tiktok/* handlers import it.
//
// Setup (all in the Vercel project's Environment Variables):
//   TIKTOK_CLIENT_KEY     — from your TikTok for Developers app
//   TIKTOK_CLIENT_SECRET  — same app
//   BLOB_READ_WRITE_TOKEN — auto-added when you enable Vercel Blob storage
//   TIKTOK_REDIRECT_URI   — optional; defaults to <deploy-origin>/api/tiktok/callback
//
// You must also, in the TikTok developer portal:
//   • add the redirect URI above to the app's Login Kit settings
//   • request the scopes user.info.basic + video.upload (Content Posting API)
//   • verify your deploy domain's URL prefix
//        https://<your-domain>/api/tiktok/media/
//     under "URL Properties" so PULL_FROM_URL is allowed to fetch slides.

import type { VercelRequest } from '@vercel/node';

export const TIKTOK_AUTHORIZE = 'https://www.tiktok.com/v2/auth/authorize/';
export const TIKTOK_TOKEN = 'https://open.tiktokapis.com/v2/oauth/token/';
export const TIKTOK_POST_INIT = 'https://open.tiktokapis.com/v2/post/publish/content/init/';
export const TIKTOK_POST_STATUS = 'https://open.tiktokapis.com/v2/post/publish/status/fetch/';

// Scopes: basic identity + Content Posting upload-to-inbox.
export const TIKTOK_SCOPES = 'user.info.basic,video.upload';

export function clientKey(): string {
  return process.env.TIKTOK_CLIENT_KEY || '';
}
export function clientSecret(): string {
  return process.env.TIKTOK_CLIENT_SECRET || '';
}

// The Vercel Blob read-write token. A single connected store injects
// BLOB_READ_WRITE_TOKEN, but a store created with a custom env-var prefix is
// named <PREFIX>_READ_WRITE_TOKEN instead — so the bare name check can come up
// empty even though Blob is correctly connected. Resolve either: the exact
// name first, then any var ending in _READ_WRITE_TOKEN (which is specific to
// Blob). Returns '' when Blob truly isn't connected.
export function resolveBlobToken(): string {
  if (process.env.BLOB_READ_WRITE_TOKEN) return process.env.BLOB_READ_WRITE_TOKEN;
  for (const [k, v] of Object.entries(process.env)) {
    if (v && k.endsWith('_READ_WRITE_TOKEN')) return v;
  }
  return '';
}

// The publicly-reachable origin of this deployment, e.g.
// https://kiro-slideshow-generator.vercel.app — derived from the request so
// it works on previews and the production domain alike.
export function originFromRequest(req: VercelRequest): string {
  const proto = (req.headers['x-forwarded-proto'] as string) || 'https';
  const host = (req.headers['x-forwarded-host'] as string) || (req.headers.host as string) || '';
  return `${proto}://${host}`;
}

export function redirectUri(req: VercelRequest): string {
  return process.env.TIKTOK_REDIRECT_URI || `${originFromRequest(req)}/api/tiktok/callback`;
}

export function isConfigured(): boolean {
  return Boolean(clientKey() && clientSecret());
}

// Exchange an authorization code for an access token (confidential client —
// uses the client secret, so no PKCE needed).
export async function exchangeCodeForToken(code: string, redirect: string): Promise<{
  access_token: string; expires_in: number; refresh_token: string;
  refresh_expires_in: number; open_id: string; scope: string;
}> {
  const body = new URLSearchParams({
    client_key: clientKey(),
    client_secret: clientSecret(),
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirect,
  });
  const res = await fetch(TIKTOK_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok || data.error) {
    const msg = (data.error_description as string) || (data.error as string) || `token exchange failed (${res.status})`;
    throw new Error(msg);
  }
  return data as never;
}

// Random URL-safe token for CSRF state.
export function randomState(): string {
  const bytes = new Uint8Array(16);
  (globalThis.crypto || require('node:crypto').webcrypto).getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}
