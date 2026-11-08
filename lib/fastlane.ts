// Shared helpers for the Fastlane (usefastlane.ai) integration. Lives outside
// api/ so Vercel doesn't build it as its own serverless function; the single
// api/fastlane.ts handler imports it. (One function on purpose: the Hobby
// plan caps a deployment at 12 functions.)
//
// Setup (all in the Vercel project's Environment Variables):
//   FASTLANE_API_KEY      — your Fastlane API key. Never leaves the server.
//   FASTLANE_ADMIN_TOKEN  — a long random password you make up. The panel
//                           sends it with every request; it unlocks stats AND
//                           scheduling / cancelling. Without it set, every
//                           Fastlane route stays locked (fail closed), because
//                           the production URL is public.
//   FASTLANE_READ_TOKEN   — optional second password that only unlocks the
//                           read-only routes (stats, posts, connections,
//                           content). Safe to hand to an automation that should
//                           read numbers but must never post.

import { createHash, timingSafeEqual } from 'node:crypto';

export const FASTLANE_BASE = 'https://api.usefastlane.ai/api/v1';
// Fastlane sits behind Cloudflare, which 403s requests with no/odd UA.
export const FASTLANE_UA = 'iro-slideshow-generator/1.0 (+fastlane-panel)';
export const TOKEN_HEADER = 'x-fastlane-panel-token';

export type Access = 'none' | 'read' | 'admin';

// Ops the panel can call. Reads never change anything in Fastlane or on any
// social account. Writes schedule or cancel real posts, so they need the
// admin token AND an explicit `confirm: true` in the body.
export const READ_OPS = ['connections', 'posts', 'post', 'content', 'content-item', 'analytics', 'stats'] as const;
export const WRITE_OPS = ['schedule', 'cancel'] as const;
export type ReadOp = (typeof READ_OPS)[number];
export type WriteOp = (typeof WRITE_OPS)[number];
export type Op = ReadOp | WriteOp | 'status';

export function isReadOp(op: string): op is ReadOp {
  return (READ_OPS as readonly string[]).includes(op);
}
export function isWriteOp(op: string): op is WriteOp {
  return (WRITE_OPS as readonly string[]).includes(op);
}

export type FastlaneEnv = {
  apiKey: string;
  adminToken: string;
  readToken: string;
};

export function readEnv(env: Record<string, string | undefined> = process.env): FastlaneEnv {
  return {
    apiKey: (env.FASTLANE_API_KEY || '').trim(),
    adminToken: (env.FASTLANE_ADMIN_TOKEN || '').trim(),
    readToken: (env.FASTLANE_READ_TOKEN || '').trim(),
  };
}

// Constant-time compare via fixed-length digests, so neither the token's
// contents nor its length leak through timing.
export function safeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const da = createHash('sha256').update(a).digest();
  const db = createHash('sha256').update(b).digest();
  return timingSafeEqual(da, db);
}

// Tokens shorter than this are refused even if set, so a lazy "1234" can't
// guard an account that posts to TikTok.
export const MIN_TOKEN_LEN = 16;

export function accessFor(presented: string, env: FastlaneEnv): Access {
  const p = (presented || '').trim();
  if (!p) return 'none';
  if (env.adminToken.length >= MIN_TOKEN_LEN && safeEqual(p, env.adminToken)) return 'admin';
  if (env.readToken.length >= MIN_TOKEN_LEN && safeEqual(p, env.readToken)) return 'read';
  return 'none';
}

export function canRun(op: string, access: Access): boolean {
  if (isWriteOp(op)) return access === 'admin';
  if (isReadOp(op)) return access === 'admin' || access === 'read';
  return false;
}

// Ids go into a URL path, so keep them to a safe charset.
export function safeId(v: unknown): string {
  const s = typeof v === 'string' ? v.trim() : '';
  return /^[A-Za-z0-9_-]{1,128}$/.test(s) ? s : '';
}

export function clampLimit(v: unknown, def = 20, max = 50): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(n, max);
}

export const PLATFORMS = ['tiktok', 'instagram', 'youtube'] as const;
export type Platform = (typeof PLATFORMS)[number];

export type ScheduleInput = {
  contentId: string;
  body: { platform: Platform; utc_datetime: string; caption?: string; description?: string; connectionId?: string };
};

// Validates the panel's schedule request before anything reaches Fastlane.
// Returns an error string, or the cleaned request.
export function parseSchedule(raw: unknown, now = Date.now()): ScheduleInput | string {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (b.confirm !== true) return 'Scheduling needs an explicit confirm.';
  const contentId = safeId(b.contentId);
  if (!contentId) return 'Missing or invalid contentId.';
  const platform = String(b.platform || '').toLowerCase();
  if (!(PLATFORMS as readonly string[]).includes(platform)) return 'Platform must be tiktok, instagram or youtube.';
  const when = String(b.utc_datetime || '');
  const t = Date.parse(when);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z$/.test(when) || !Number.isFinite(t)) {
    return 'utc_datetime must be an ISO time in UTC, like 2026-11-09T18:00:00Z.';
  }
  if (t < now + 60_000) return 'Pick a time at least a minute in the future.';
  const caption = typeof b.caption === 'string' ? b.caption.slice(0, 2200) : undefined;
  const description = typeof b.description === 'string' ? b.description.slice(0, 5000) : undefined;
  const connectionId = b.connectionId == null || b.connectionId === '' ? undefined : safeId(b.connectionId);
  if (b.connectionId && !connectionId) return 'Invalid connectionId.';
  const body: ScheduleInput['body'] = { platform: platform as Platform, utc_datetime: new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z') };
  if (caption) body.caption = caption;
  if (description) body.description = description;
  if (connectionId) body.connectionId = connectionId;
  return { contentId, body };
}

export function parseIdList(raw: unknown, max = 50): string[] | string {
  if (!Array.isArray(raw) || raw.length === 0) return 'Send a non-empty postIds list.';
  if (raw.length > max) return `At most ${max} ids per request.`;
  const ids = raw.map(safeId);
  if (ids.some((x) => !x)) return 'One of the ids is invalid.';
  return Array.from(new Set(ids));
}

export type FastlaneResult = { status: number; json: unknown; retryAfter?: string | null };

// One call to Fastlane. The key is only ever placed in the Authorization
// header here; it is never logged or echoed back.
export async function fastlaneFetch(
  apiKey: string,
  path: string,
  init: { method?: 'GET' | 'POST'; body?: unknown } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<FastlaneResult> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
    'User-Agent': FASTLANE_UA,
  };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json; charset=utf-8';
  const r = await fetchImpl(FASTLANE_BASE + path, {
    method: init.method || 'GET',
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await r.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { error: { code: 'bad_json', message: `Fastlane answered ${r.status} with a non-JSON body.` } }; }
  return { status: r.status, json, retryAfter: r.headers.get('retry-after') };
}

// Strip anything that looks like a bearer token or the key itself out of an
// error message before it goes back to the browser.
export function scrubMessage(msg: string, apiKey: string): string {
  let m = String(msg || '').slice(0, 500);
  if (apiKey) m = m.split(apiKey).join('[redacted]');
  return m.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]');
}
