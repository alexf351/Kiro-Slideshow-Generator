// Client side of the Fastlane (usefastlane.ai) panel. Talks only to this
// app's own /api/fastlane route — the Fastlane API key stays on the server.
// The browser holds just the panel token (FASTLANE_ADMIN_TOKEN or the
// read-only FASTLANE_READ_TOKEN), like the other keys in Settings.
//
// Fastlane returns Mongo-style `_id`s and epoch-number timestamps; its post
// analytics only carry views, likes and comments (no saves or shares). The
// normalizers read those first and keep a few other spellings as fallbacks. The panel also has a
// "raw JSON" view for anything they miss.

export const PANEL_TOKEN_KEY = 'kiro_fastlane_panel_token';
export const TOKEN_HEADER = 'x-fastlane-panel-token';

export type FastlaneStatus = {
  apiKeySet: boolean;
  adminTokenSet: boolean;
  adminTokenTooShort?: boolean;
  readTokenSet: boolean;
  access: 'none' | 'read' | 'admin';
};

export type FlConnection = { id: string; platform: string; name: string; raw: unknown };
export type FlPost = {
  id: string;
  platform: string;
  status: string;
  caption: string;
  when: string; // ISO; scheduled or published time when known
  contentId: string;
  url: string;
  raw: unknown;
};
export type FlMetrics = { views?: number; likes?: number; saves?: number; shares?: number; comments?: number; notFound?: boolean; url?: string };
export type FlContent = { id: string; type: string; status: string; title: string; thumbnail: string; createdAt: string; raw: unknown };

export class FastlaneError extends Error {
  code: string;
  status: number;
  retryAfterMs?: number;
  constructor(message: string, code: string, status: number, retryAfterMs?: number) {
    super(message);
    this.code = code;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

function str(o: Obj, keys: string[]): string {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return '';
}

// Fastlane timestamps are epoch numbers; accept ms, seconds or ISO strings.
// Returns an ISO string, or '' when nothing parses.
function time(o: Obj, keys: string[]): string {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
      return new Date(v < 1e12 ? v * 1000 : v).toISOString();
    }
    if (typeof v === 'string' && v.trim()) {
      const t = /^\d+$/.test(v.trim()) ? Number(v) : Date.parse(v);
      if (Number.isFinite(t) && t > 0) return new Date(t < 1e12 ? t * 1000 : t).toISOString();
    }
  }
  return '';
}

function num(o: Obj, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = o[k];
    const n = typeof v === 'string' ? Number(v.replace(/,/g, '')) : v;
    if (typeof n === 'number' && Number.isFinite(n)) return n;
  }
  return undefined;
}

export function normalizeConnection(raw: unknown): FlConnection | null {
  if (!isObj(raw)) return null;
  const id = str(raw, ['_id', 'id', 'connectionId']);
  if (!id) return null;
  const account = isObj(raw.account) ? raw.account : {};
  return {
    id,
    platform: (str(raw, ['platform', 'provider', 'type', 'network']) || 'unknown').toLowerCase(),
    name: str(raw, ['platformUsername', 'username', 'handle', 'displayName', 'name', 'accountName']) || str(account, ['username', 'handle', 'name']) || id,
    raw,
  };
}

export function normalizePost(raw: unknown): FlPost | null {
  if (!isObj(raw)) return null;
  const id = str(raw, ['_id', 'id', 'postId']);
  if (!id) return null;
  return {
    id,
    platform: (str(raw, ['platform', 'provider', 'network']) || 'unknown').toLowerCase(),
    status: (str(raw, ['status', 'state']) || 'unknown').toUpperCase(),
    caption: str(raw, ['caption', 'title', 'description', 'text']),
    when: time(raw, ['postedAt', 'publishedAt', 'scheduledAt', 'scheduledFor', 'utc_datetime', 'utcDatetime', 'createdAt']),
    contentId: str(raw, ['contentId', 'content_id']),
    url: str(raw, ['url', 'postUrl', 'permalink', 'shareUrl']),
    raw,
  };
}

export function normalizeContent(raw: unknown): FlContent | null {
  if (!isObj(raw)) return null;
  const id = str(raw, ['_id', 'id', 'contentId']);
  if (!id) return null;
  const files = Array.isArray(raw.files) ? raw.files : [];
  const firstFile = files.find((f) => typeof f === 'string' || isObj(f));
  const fileUrl = typeof firstFile === 'string' ? firstFile : isObj(firstFile) ? str(firstFile, ['url', 'src']) : '';
  return {
    id,
    type: (str(raw, ['type', 'contentType', 'format']) || 'content').toLowerCase(),
    status: (str(raw, ['status', 'state']) || 'unknown').toUpperCase(),
    title: str(raw, ['title', 'hook', 'suggestion', 'caption', 'text', 'name']),
    thumbnail: str(raw, ['thumbnail', 'thumbnailUrl', 'coverUrl', 'previewUrl']) || fileUrl,
    createdAt: time(raw, ['createdAt', 'updatedAt']),
    raw,
  };
}

const METRIC_KEYS: Record<'views' | 'likes' | 'saves' | 'shares' | 'comments', string[]> = {
  views: ['views', 'viewCount', 'view_count', 'plays', 'playCount', 'impressions'],
  likes: ['likes', 'likeCount', 'like_count', 'hearts', 'diggCount'],
  saves: ['saves', 'saveCount', 'save_count', 'bookmarks', 'collectCount', 'favorites'],
  shares: ['shares', 'shareCount', 'share_count'],
  comments: ['comments', 'commentCount', 'comment_count'],
};

function metricsFrom(o: Obj): FlMetrics {
  const pools = [o, isObj(o.metrics) ? o.metrics : null, isObj(o.stats) ? o.stats : null, isObj(o.analytics) ? o.analytics : null]
    .filter(Boolean) as Obj[];
  const m: FlMetrics = {};
  for (const k of Object.keys(METRIC_KEYS) as (keyof typeof METRIC_KEYS)[]) {
    for (const p of pools) {
      const v = num(p, METRIC_KEYS[k]);
      if (v !== undefined) { m[k] = v; break; }
    }
  }
  if (o.notFound === true) m.notFound = true;
  const url = str(o, ['postUrl', 'url', 'permalink']);
  if (url) m.url = url;
  return m;
}

// Accepts the analytics payload in any of the shapes it plausibly comes in:
// an array of {postId, …metrics} rows, or an object keyed by post id.
export function normalizeAnalytics(raw: unknown): Record<string, FlMetrics> {
  const out: Record<string, FlMetrics> = {};
  const data = isObj(raw) && 'data' in raw ? raw.data : raw;
  if (Array.isArray(data)) {
    for (const row of data) {
      if (!isObj(row)) continue;
      const id = str(row, ['_id', 'postId', 'id', 'post_id']);
      if (id) out[id] = metricsFrom(row);
    }
  } else if (isObj(data)) {
    for (const [id, row] of Object.entries(data)) {
      if (isObj(row)) out[id] = metricsFrom(row);
    }
  }
  return out;
}

// <input type="datetime-local"> gives "2026-11-09T10:00" in the browser's
// own zone; Fastlane wants UTC ISO. Returns '' for an unparseable value.
export function localToUtcIso(local: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(local)) return '';
  const t = new Date(local).getTime();
  if (!Number.isFinite(t)) return '';
  return new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function compactNumber(n: number | undefined): string {
  if (n === undefined) return '–';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, '') + 'K';
  return String(n);
}

export async function fastlaneCall<T = unknown>(
  op: string,
  token: string,
  opts: { method?: 'GET' | 'POST'; query?: Record<string, string | number | undefined>; body?: unknown } = {},
): Promise<T> {
  const qs = new URLSearchParams({ op });
  for (const [k, v] of Object.entries(opts.query || {})) if (v !== undefined && v !== '') qs.set(k, String(v));
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers[TOKEN_HEADER] = token;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  let r: Response;
  try {
    r = await fetch(`/api/fastlane?${qs.toString()}`, {
      method: opts.method || 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new FastlaneError('Could not reach this app’s server. The Fastlane panel only works on the deployed site, not plain `npm run dev`.', 'network', 0);
  }
  let j: { data?: unknown; error?: { code?: string; message?: string; retryAfterMs?: number } } = {};
  try { j = await r.json(); } catch {
    throw new FastlaneError(`The server answered ${r.status} without JSON. The Fastlane panel needs the deployed site (or \`vercel dev\`).`, 'no_api', r.status);
  }
  if (!r.ok || j.error) {
    throw new FastlaneError(j.error?.message || `Request failed (${r.status}).`, j.error?.code || 'error', r.status, j.error?.retryAfterMs);
  }
  return j as T;
}
