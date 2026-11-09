// Shared helpers for the AI generation panel (Sume + OpenAI). Lives outside
// api/ so Vercel doesn't build it as its own function; api/generate.ts is the
// single handler (the Hobby plan caps a deployment at 12 functions).
//
// Env vars (Vercel → Settings → Environment Variables):
//   SUME_API_KEY          — Sume API key (sume.com/dashboard/api-keys). Server only.
//   OPENAI_API_KEY        — OpenAI Platform key. Server only.
//   GENERATE_ADMIN_TOKEN  — optional. Panel password for this route. When not
//                           set, the route accepts FASTLANE_ADMIN_TOKEN instead,
//                           so one password unlocks both panels.
//   GENERATE_MAX_USD      — optional per-request spend cap (default 1.50).
//
// Sume docs used: https://www.sume.com/docs (quick start, models/images,
// models/video-router, workflows/jobs-and-results, workflows/errors-and-credits).
// OpenAI docs used: developers.openai.com/api/docs (image generation guide,
// model pages for gpt-image-2 / gpt-image-2.5-flare, pricing).

import { createHash, timingSafeEqual } from 'node:crypto';

export const SUME_BASE = 'https://api.sume.com';
export const OPENAI_BASE = 'https://api.openai.com/v1';
export const TOKEN_HEADER = 'x-generate-panel-token';
export const MIN_TOKEN_LEN = 16;
export const DEFAULT_MAX_USD = 1.5;

export type GenEnv = {
  sumeKey: string;
  openaiKey: string;
  panelToken: string;
  panelTokenSource: 'GENERATE_ADMIN_TOKEN' | 'FASTLANE_ADMIN_TOKEN' | '';
  maxUsd: number;
};

export function readEnv(env: Record<string, string | undefined> = process.env): GenEnv {
  const own = (env.GENERATE_ADMIN_TOKEN || '').trim();
  const shared = (env.FASTLANE_ADMIN_TOKEN || '').trim();
  const cap = Number(env.GENERATE_MAX_USD);
  return {
    sumeKey: (env.SUME_API_KEY || '').trim(),
    openaiKey: (env.OPENAI_API_KEY || '').trim(),
    panelToken: own || shared,
    panelTokenSource: own ? 'GENERATE_ADMIN_TOKEN' : shared ? 'FASTLANE_ADMIN_TOKEN' : '',
    maxUsd: Number.isFinite(cap) && cap > 0 ? cap : DEFAULT_MAX_USD,
  };
}

export function safeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const da = createHash('sha256').update(a).digest();
  const db = createHash('sha256').update(b).digest();
  return timingSafeEqual(da, db);
}

export function isAuthorized(presented: string, env: GenEnv): boolean {
  const p = (presented || '').trim();
  return env.panelToken.length >= MIN_TOKEN_LEN && !!p && safeEqual(p, env.panelToken);
}

// ---------- validation ----------

export const ASPECTS = ['9:16', '1:1', '4:5', '3:4', '16:9'] as const;
export type Aspect = (typeof ASPECTS)[number];

// Catalog ids go into JSON, not a path, but keep them tidy anyway.
export function safeModel(v: unknown): string {
  const s = typeof v === 'string' ? v.trim() : '';
  return /^[A-Za-z0-9._/-]{1,80}$/.test(s) ? s : '';
}

export function safeJobId(v: unknown): string {
  const s = typeof v === 'string' ? v.trim() : '';
  return /^[A-Za-z0-9_-]{1,128}$/.test(s) ? s : '';
}

export function cleanPrompt(v: unknown, max = 4000): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

export function cleanAspect(v: unknown): Aspect {
  return (ASPECTS as readonly string[]).includes(String(v)) ? (v as Aspect) : '9:16';
}

// A reference image Sume can fetch: public https only, no credentials, no
// local/private hosts.
export function isPublicHttpsUrl(v: unknown): boolean {
  if (typeof v !== 'string' || v.length > 2048) return false;
  let u: URL;
  try { u = new URL(v); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password) return false;
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || !h.includes('.')) return false;
  if (/^(\d+\.){3}\d+$/.test(h) || h.includes(':')) return false; // bare IPs
  return true;
}

export const MAX_REF_BYTES = 3_000_000;
export type DataImage = { mime: string; bytes: Buffer };

export function parseDataUrl(v: unknown): DataImage | string {
  if (typeof v !== 'string') return 'Reference image is missing.';
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(v);
  if (!m) return 'Reference image must be a PNG, JPEG or WebP.';
  const bytes = Buffer.from(m[2], 'base64');
  if (bytes.length > MAX_REF_BYTES) return 'Reference image is over 3 MB. Use a smaller one.';
  return { mime: m[1], bytes };
}

// ---------- OpenAI image pricing ----------
// OpenAI bills image models per token. Before a run we can only show a rough
// figure, so these are labelled "about" in the UI. After a run, the response's
// `usage` gives the real token counts and costFromUsage() prices them.
//
// Rates per 1M tokens from developers.openai.com/api/docs/pricing (Nov 2026).
export const OPENAI_IMAGE_MODELS: Record<string, { textIn: number; imageIn: number; imageOut: number; label: string }> = {
  'gpt-image-2': { textIn: 2.5, imageIn: 4, imageOut: 15, label: 'GPT Image 2 (cheapest)' },
  'gpt-image-2.5-flare': { textIn: 5, imageIn: 8, imageOut: 30, label: 'GPT Image 2.5 Flare (sharper)' },
  'gpt-image-1': { textIn: 5, imageIn: 10, imageOut: 40, label: 'GPT Image 1 (fallback)' },
};
export const OPENAI_QUALITIES = ['low', 'medium', 'high'] as const;
export type OpenAIQuality = (typeof OPENAI_QUALITIES)[number];
// Output tokens for a 1024x1536 portrait image (gpt-image-1's published
// table). Newer models are close enough for a pre-run ballpark.
const PORTRAIT_OUT_TOKENS: Record<OpenAIQuality, number> = { low: 400, medium: 1568, high: 6240 };

export function openaiImageEstimate(model: string, quality: OpenAIQuality, refCount: number): number {
  const r = OPENAI_IMAGE_MODELS[model] || OPENAI_IMAGE_MODELS['gpt-image-2'];
  const out = PORTRAIT_OUT_TOKENS[quality] * r.imageOut;
  const textIn = 200 * r.textIn;
  const imgIn = refCount * 1500 * r.imageIn; // ~1.5K tokens per reference, rough
  return round4((out + textIn + imgIn) / 1_000_000);
}

export type ImageUsage = {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { text_tokens?: number; image_tokens?: number };
};

export function openaiImageCostFromUsage(model: string, u: ImageUsage | undefined): number | null {
  if (!u || typeof u.output_tokens !== 'number') return null;
  const r = OPENAI_IMAGE_MODELS[model] || OPENAI_IMAGE_MODELS['gpt-image-2'];
  const imgIn = u.input_tokens_details?.image_tokens ?? 0;
  const textIn = u.input_tokens_details?.text_tokens ?? Math.max(0, (u.input_tokens ?? 0) - imgIn);
  return round4((textIn * r.textIn + imgIn * r.imageIn + u.output_tokens * r.imageOut) / 1_000_000);
}

// ---------- OpenAI text (ChatGPT) ----------
export const OPENAI_TEXT_MODELS: Record<string, { in: number; out: number; label: string }> = {
  'gpt-6-luna': { in: 0.1, out: 0.5, label: 'GPT-6 Luna (cheapest)' },
  'gpt-6.1-terra': { in: 1, out: 5, label: 'GPT-6.1 Terra' },
  'gpt-6.1-sol': { in: 2, out: 10, label: 'GPT-6.1 Sol' },
};

export function textCostFromUsage(model: string, u: { input_tokens?: number; output_tokens?: number } | undefined): number | null {
  const r = OPENAI_TEXT_MODELS[model];
  if (!r || !u) return null;
  return round4(((u.input_tokens ?? 0) * r.in + (u.output_tokens ?? 0) * r.out) / 1_000_000);
}

// Responses API → plain text. Prefers the SDK-style `output_text`, else joins
// every output_text part.
export function responsesText(j: unknown): string {
  const o = (j || {}) as { output_text?: unknown; output?: unknown };
  if (typeof o.output_text === 'string' && o.output_text) return o.output_text;
  const parts: string[] = [];
  if (Array.isArray(o.output)) {
    for (const item of o.output as Array<{ content?: Array<{ type?: string; text?: string }> }>) {
      for (const c of item?.content || []) if (c && typeof c.text === 'string' && (c.type === 'output_text' || !c.type)) parts.push(c.text);
    }
  }
  return parts.join('\n').trim();
}

// ---------- Sume ----------
// Sume returns `{ data: … }` on success and `{ error: {code,message,…} }` on
// failure. Field names below follow the docs; parsers read a few spellings
// because the public pages don't show every response in full.

export type SumeResult = { status: number; json: unknown; retryAfter?: string | null };

export async function sumeFetch(
  apiKey: string,
  path: string,
  init: { method?: 'GET' | 'POST'; body?: unknown; idempotencyKey?: string } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<SumeResult> {
  const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (init.idempotencyKey) headers['Idempotency-Key'] = init.idempotencyKey;
  const r = await fetchImpl(SUME_BASE + path, {
    method: init.method || 'GET',
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await r.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { error: { code: 'bad_json', message: `Sume answered ${r.status} with a non-JSON body.` } }; }
  return { status: r.status, json, retryAfter: r.headers.get('retry-after') };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const unwrap = (j: unknown): Obj => (isObj(j) && isObj(j.data) ? (j.data as Obj) : isObj(j) ? j : {});

function firstNum(o: Obj, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = o[k];
    const n = typeof v === 'string' ? Number(v) : v;
    if (typeof n === 'number' && Number.isFinite(n)) return n;
  }
  return undefined;
}

// Estimate response → USD. Looks for *_usd fields first (the OpenAPI spec's
// estimated_usd), then a cents field.
export function parseEstimateUsd(j: unknown): number | null {
  const d = unwrap(j);
  const pools = [d, isObj(d.estimate) ? (d.estimate as Obj) : {}, isObj(d.pricing) ? (d.pricing as Obj) : {}];
  for (const p of pools) {
    const usd = firstNum(p, ['estimated_usd', 'usd', 'cost_usd', 'price_usd', 'total_usd', 'amount_usd']);
    if (usd !== undefined) return usd;
    const cents = firstNum(p, ['estimated_usd_cents', 'usd_cents', 'cost_usd_cents', 'reserved_usd_cents']);
    if (cents !== undefined) return cents / 100;
  }
  return null;
}

export type SumeJob = { id: string; status: string; terminal: boolean; nextPollSeconds: number; error: string };

const TERMINAL = new Set(['completed', 'failed', 'canceled', 'cancelled']);
const QUEUE_MAP: Record<string, string> = { IN_QUEUE: 'queued', IN_PROGRESS: 'processing', COMPLETED: 'completed', FAILED: 'failed', CANCELED: 'canceled' };

export function parseSumeJob(j: unknown): SumeJob {
  const d = unwrap(j);
  const job = isObj(d.job) ? (d.job as Obj) : d;
  const id = String(job.id ?? d.request_id ?? d.id ?? '');
  let status = String(d.sume_status ?? job.sume_status ?? job.status ?? d.status ?? '').trim();
  if (QUEUE_MAP[status]) status = QUEUE_MAP[status];
  status = status.toLowerCase() || 'queued';
  const terminal = d.terminal === true || job.terminal === true || TERMINAL.has(status);
  const wait = firstNum(d, ['next_poll_after_seconds']) ?? 3;
  const err = isObj(job.error) ? String((job.error as Obj).message || (job.error as Obj).code || '') : typeof job.error === 'string' ? job.error : '';
  return { id, status, terminal, nextPollSeconds: Math.min(Math.max(wait, 2), 15), error: err };
}

export type Artifact = { url: string; type: string; contentType: string };

// Result → media URLs. Handles the job result shape (result.artifacts[]) and
// the sync image shape (data[].url).
export function parseSumeArtifacts(j: unknown): Artifact[] {
  const out: Artifact[] = [];
  const push = (a: unknown) => {
    if (!isObj(a)) return;
    const url = String(a.url ?? a.download_url ?? '');
    if (!isPublicHttpsUrl(url)) return;
    const ct = String(a.content_type ?? a.media_type ?? a.mime_type ?? '');
    const type = String(a.type ?? (ct.startsWith('video/') ? 'video' : ct.startsWith('image/') ? 'image' : ''));
    out.push({ url, type, contentType: ct });
  };
  const top = isObj(j) ? j : {};
  const d = unwrap(j);
  const results = [top.result, d.result, isObj(d.job) ? (d.job as Obj).result : undefined];
  for (const r of results) {
    if (isObj(r) && Array.isArray(r.artifacts)) r.artifacts.forEach(push);
  }
  if (!out.length && Array.isArray(top.data)) (top.data as unknown[]).forEach(push);
  return out;
}

export function sumeErrorMessage(j: unknown, status: number, apiKey: string): { code: string; message: string } {
  const e = (isObj(j) && isObj(j.error) ? j.error : {}) as Obj;
  const code = String(e.code || `sume_${status}`);
  let message = String(e.message || `Sume answered ${status}.`);
  if (status === 401 || code === 'unauthorized') message = 'Sume refused the API key. Check SUME_API_KEY in Vercel.';
  if (code === 'insufficient_credits') {
    const det = isObj(e.details) ? (e.details as Obj) : {};
    message = `Not enough Sume credit for this run${det.required_credits !== undefined ? ` (needs ${det.required_credits}, have ${det.available_credits})` : ''}. Add funds in the Sume dashboard.`;
  }
  if (code === 'queue_full') message = 'Sume is already running as many jobs as your plan allows. Wait for one to finish.';
  return { code, message: scrubMessage(message, apiKey) };
}

export function scrubMessage(msg: string, ...secrets: string[]): string {
  let m = String(msg || '').slice(0, 500);
  for (const s of secrets) if (s) m = m.split(s).join('[redacted]');
  return m
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-[redacted]');
}

export function round4(n: number): number {
  return Math.ceil(n * 10000) / 10000;
}

// Sume video: keep requests short by default. Cost scales with seconds.
export const VIDEO_RESOLUTIONS = ['480p', '720p', '1080p'] as const;
export function cleanDuration(v: unknown, def = 5, max = 15): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(Math.max(n, 2), max);
}
