// /api/fastlane?op=<op>
//
// Server-side proxy to the Fastlane API (usefastlane.ai). FASTLANE_API_KEY is
// read from the environment here and only ever sent to Fastlane — it never
// reaches the browser, and no response echoes it.
//
// Because the production URL is public, every op except `status` needs a
// panel token in the `x-fastlane-panel-token` header:
//   FASTLANE_ADMIN_TOKEN → all ops (reads + schedule + cancel)
//   FASTLANE_READ_TOKEN  → read-only ops (optional)
// With neither token set, the routes stay locked.
//
//   GET  ?op=status                       → what's configured + your access level
//   GET  ?op=connections                  → connected social accounts
//   GET  ?op=posts&limit=&cursor=         → recent posts
//   GET  ?op=post&id=                     → one post
//   GET  ?op=content&limit=&cursor=       → content library
//   GET  ?op=content-item&id=             → one content item
//   POST ?op=analytics  {postIds}         → metrics for those posts (read-only)
//   GET  ?op=stats&limit=                 → recent posts + their metrics in one call
//   POST ?op=schedule   {confirm:true, contentId, platform, utc_datetime, caption?, description?, connectionId?}
//   POST ?op=cancel     {confirm:true, postIds}
//
// Deliberately NOT exposed: POST /blitz (spends a generation), content
// delete, angle/preference edits.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  TOKEN_HEADER,
  accessFor,
  canRun,
  clampLimit,
  fastlaneFetch,
  isReadOp,
  isWriteOp,
  MIN_TOKEN_LEN,
  parseIdList,
  parseSchedule,
  readEnv,
  safeId,
  scrubMessage,
  type FastlaneResult,
} from '../lib/fastlane.js';

export const config = { api: { bodyParser: { sizeLimit: '100kb' } } };

type Fetch = typeof fetch;

function send(res: VercelResponse, status: number, body: unknown): void {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(body);
}

function fail(res: VercelResponse, status: number, code: string, message: string): void {
  send(res, status, { error: { code, message } });
}

function cursorQS(v: unknown): string {
  const c = typeof v === 'string' ? v.slice(0, 512) : '';
  return c ? `&cursor=${encodeURIComponent(c)}` : '';
}

function relay(res: VercelResponse, r: FastlaneResult, apiKey: string): void {
  if (r.status >= 200 && r.status < 300) { send(res, 200, r.json ?? { data: null }); return; }
  const err = ((r.json as { error?: { code?: string; message?: string; details?: Record<string, unknown> } }) || {}).error || {};
  const code = String(err.code || `fastlane_${r.status}`);
  let message = scrubMessage(err.message || `Fastlane answered ${r.status}.`, apiKey);
  if (r.status === 401 || r.status === 403) {
    message = 'Fastlane refused the API key. Check FASTLANE_API_KEY in Vercel (and that it belongs to the right workspace).';
  }
  const out: Record<string, unknown> = { code, message, upstreamStatus: r.status };
  const retryMs = Number(err.details?.retryAfterMs);
  if (r.status === 429) out.retryAfterMs = Number.isFinite(retryMs) ? retryMs : (Number(r.retryAfter) || 60) * 1000;
  // Panel auth problems use 401 from this route; Fastlane auth problems come
  // back as 502 so the UI can tell them apart.
  const status = r.status === 401 || r.status === 403 ? 502 : r.status === 429 ? 429 : r.status >= 500 ? 502 : r.status;
  send(res, status, { error: out });
}

export async function handle(req: VercelRequest, res: VercelResponse, fetchImpl: Fetch = fetch): Promise<void> {
  const op = String((req.query && req.query.op) || 'status');
  const env = readEnv();
  const presented = String(req.headers[TOKEN_HEADER] || '');
  const access = accessFor(presented, env);

  if (op === 'status') {
    if (req.method !== 'GET') { fail(res, 405, 'method', 'GET only.'); return; }
    send(res, 200, {
      data: {
        apiKeySet: !!env.apiKey,
        adminTokenSet: !!env.adminToken,
        adminTokenTooShort: !!env.adminToken && env.adminToken.length < MIN_TOKEN_LEN,
        readTokenSet: !!env.readToken,
        access,
      },
    });
    return;
  }

  if (!isReadOp(op) && !isWriteOp(op)) { fail(res, 404, 'unknown_op', `Unknown op "${op}".`); return; }

  if (!env.adminToken && !env.readToken) {
    fail(res, 503, 'missing_panel_token', 'Add FASTLANE_ADMIN_TOKEN in Vercel (a long password you make up), then redeploy. The Fastlane routes stay locked until then.');
    return;
  }
  if (!canRun(op, access)) {
    if (access === 'read') fail(res, 403, 'read_only', 'This token can only read stats. Scheduling and cancelling need the admin token.');
    else fail(res, 401, 'bad_panel_token', 'Missing or wrong panel token. Paste FASTLANE_ADMIN_TOKEN into the Fastlane panel.');
    return;
  }
  if (!env.apiKey) {
    fail(res, 503, 'missing_api_key', 'Add FASTLANE_API_KEY in Vercel (Settings → Environment Variables), then redeploy.');
    return;
  }

  const wantGet = op === 'connections' || op === 'posts' || op === 'post' || op === 'content' || op === 'content-item' || op === 'stats';
  if (wantGet && req.method !== 'GET') { fail(res, 405, 'method', 'GET only.'); return; }
  if (!wantGet && req.method !== 'POST') { fail(res, 405, 'method', 'POST only.'); return; }

  const q = req.query || {};
  const key = env.apiKey;
  try {
    switch (op) {
      case 'connections':
        relay(res, await fastlaneFetch(key, '/connections', {}, fetchImpl), key);
        return;
      case 'posts':
        relay(res, await fastlaneFetch(key, `/posts?limit=${clampLimit(q.limit)}${cursorQS(q.cursor)}`, {}, fetchImpl), key);
        return;
      case 'content':
        relay(res, await fastlaneFetch(key, `/content?limit=${clampLimit(q.limit)}${cursorQS(q.cursor)}`, {}, fetchImpl), key);
        return;
      case 'post':
      case 'content-item': {
        const id = safeId(q.id);
        if (!id) { fail(res, 400, 'bad_id', 'Missing or invalid id.'); return; }
        const path = op === 'post' ? `/posts/${id}` : `/content/${id}`;
        relay(res, await fastlaneFetch(key, path, {}, fetchImpl), key);
        return;
      }
      case 'analytics': {
        const ids = parseIdList((req.body || {}).postIds);
        if (typeof ids === 'string') { fail(res, 400, 'bad_ids', ids); return; }
        relay(res, await fastlaneFetch(key, '/analytics/posts', { method: 'POST', body: { postIds: ids } }, fetchImpl), key);
        return;
      }
      case 'stats': {
        const posts = await fastlaneFetch(key, `/posts?limit=${clampLimit(q.limit)}${cursorQS(q.cursor)}`, {}, fetchImpl);
        if (posts.status < 200 || posts.status >= 300) { relay(res, posts, key); return; }
        const pj = (posts.json || {}) as { data?: unknown; pagination?: unknown };
        const list = Array.isArray(pj.data) ? (pj.data as Record<string, unknown>[]) : [];
        const ids = list.map((p) => safeId(p.id ?? p.postId)).filter(Boolean);
        let analytics: unknown = [];
        let analyticsError: unknown = null;
        if (ids.length) {
          const a = await fastlaneFetch(key, '/analytics/posts', { method: 'POST', body: { postIds: ids.slice(0, 50) } }, fetchImpl);
          if (a.status >= 200 && a.status < 300) analytics = ((a.json || {}) as { data?: unknown }).data ?? [];
          else analyticsError = { upstreamStatus: a.status, message: scrubMessage(((a.json as { error?: { message?: string } }) || {}).error?.message || 'Analytics unavailable.', key) };
        }
        send(res, 200, { data: { posts: list, analytics, analyticsError }, pagination: pj.pagination ?? null });
        return;
      }
      case 'schedule': {
        const parsed = parseSchedule(req.body);
        if (typeof parsed === 'string') { fail(res, 400, 'bad_schedule', parsed); return; }
        relay(res, await fastlaneFetch(key, `/content/${parsed.contentId}/schedule`, { method: 'POST', body: parsed.body }, fetchImpl), key);
        return;
      }
      case 'cancel': {
        const b = (req.body || {}) as { confirm?: unknown; postIds?: unknown };
        if (b.confirm !== true) { fail(res, 400, 'needs_confirm', 'Cancelling needs an explicit confirm.'); return; }
        const ids = parseIdList(b.postIds, 20);
        if (typeof ids === 'string') { fail(res, 400, 'bad_ids', ids); return; }
        relay(res, await fastlaneFetch(key, '/posts/cancel', { method: 'POST', body: { postIds: ids } }, fetchImpl), key);
        return;
      }
    }
  } catch (e) {
    fail(res, 502, 'fastlane_unreachable', scrubMessage(`Could not reach Fastlane: ${(e as Error).message}`, key));
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  await handle(req, res);
}
