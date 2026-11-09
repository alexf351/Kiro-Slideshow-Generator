// Client side of the AI generation panel. Talks only to this app's own
// /api/generate route; the Sume and OpenAI keys stay on the server. The
// browser holds just the panel password (the same FASTLANE_ADMIN_TOKEN the
// Fastlane panel uses, saved under the same localStorage key).

import { PANEL_TOKEN_KEY as FASTLANE_PANEL_TOKEN_KEY } from './fastlane';

export const PANEL_TOKEN_KEY = FASTLANE_PANEL_TOKEN_KEY;
export const TOKEN_HEADER = 'x-generate-panel-token';

// Public on the deployed site, so Sume can fetch it as a reference image.
export const PENGUIN_REF_PATH = '/iro/penguin-clay-reference.jpg';

export type GenStatus = {
  sumeKeySet: boolean;
  openaiKeySet: boolean;
  lockSet: boolean;
  lockSource: string;
  lockTooShort: boolean;
  authorized: boolean;
  maxUsd: number;
};

export type Provider = 'openai' | 'sume';
export type Ref = { url: string } | { dataUrl: string };
export type SumeJob = { id: string; status: string; terminal: boolean; nextPollSeconds: number; error: string };
export type Artifact = { url: string; type: string; contentType: string };

export const OPENAI_IMAGE_MODELS = [
  { id: 'gpt-image-2', label: 'GPT Image 2 (cheapest)' },
  { id: 'gpt-image-2.5-flare', label: 'GPT Image 2.5 Flare (sharper)' },
  { id: 'gpt-image-1', label: 'GPT Image 1 (fallback)' },
];
export const OPENAI_TEXT_MODELS = [
  { id: 'gpt-6-luna', label: 'GPT-6 Luna (cheapest)' },
  { id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra' },
  { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' },
];
// Starting points from Sume's docs. "Load Sume models" pulls the live list.
export const SUME_IMAGE_DEFAULTS = ['bytedance-seed/seedream-4.5', 'gpt-image-2', 'sume/auto'];
export const SUME_VIDEO_DEFAULTS = ['wan-3.0', 'seedance-2.5', 'kling-4', 'minimax-h3'];

export class GenError extends Error {
  code: string;
  status: number;
  estimateUsd?: number;
  constructor(message: string, code: string, status: number, estimateUsd?: number) {
    super(message);
    this.code = code;
    this.status = status;
    this.estimateUsd = estimateUsd;
  }
}

export async function genCall<T = unknown>(
  op: string,
  token: string,
  opts: { method?: 'GET' | 'POST'; query?: Record<string, string>; body?: unknown } = {},
): Promise<T> {
  const qs = new URLSearchParams({ op, ...(opts.query || {}) });
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers[TOKEN_HEADER] = token;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  let r: Response;
  try {
    r = await fetch(`/api/generate?${qs.toString()}`, {
      method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new GenError('Could not reach this app’s server. Generation only works on the deployed site, not plain `npm run dev`.', 'network', 0);
  }
  let j: { data?: unknown; error?: { code?: string; message?: string; estimateUsd?: number } } = {};
  try { j = await r.json(); } catch {
    throw new GenError(`The server answered ${r.status} without JSON. Generation needs the deployed site (or \`vercel dev\`).`, 'no_api', r.status);
  }
  if (!r.ok || j.error) throw new GenError(j.error?.message || `Request failed (${r.status}).`, j.error?.code || 'error', r.status, j.error?.estimateUsd);
  return j as T;
}

export function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return 'unknown';
  if (n === 0) return '$0';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

export function newIdempotencyKey(): string {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return 'iro-' + Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

// Downscale an image to fit `maxSide` and re-encode as JPEG so a reference
// stays well under the route's 4.5 MB body limit.
export async function blobToRefDataUrl(blob: Blob, maxSide = 1536, quality = 0.88): Promise<string> {
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return canvas.toDataURL('image/jpeg', quality);
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const r = await fetch(dataUrl);
  return await r.blob();
}

// Pulls model ids (and a price label when present) out of Sume's catalog,
// whatever exact shape it comes in.
export function catalogModels(raw: unknown, kind: 'image' | 'video'): { id: string; note: string }[] {
  const out: { id: string; note: string }[] = [];
  const seen = new Set<string>();
  const visit = (v: unknown, depth: number) => {
    if (depth > 4 || !v) return;
    if (Array.isArray(v)) { v.forEach((x) => visit(x, depth + 1)); return; }
    if (typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    const id = typeof o.model_id === 'string' ? o.model_id : typeof o.id === 'string' && !String(o.id).startsWith('job_') ? (o.id as string) : '';
    if (id && /^[A-Za-z0-9._/-]{1,80}$/.test(id)) {
      const blob = JSON.stringify(o).toLowerCase();
      const fits = kind === 'video' ? /video/.test(blob) : /image/.test(blob) && !/video-router|"video"/.test(blob);
      if (fits && !seen.has(id)) {
        seen.add(id);
        const p = Array.isArray(o.model_pricing) ? (o.model_pricing[0] as Record<string, unknown>) : (o.pricing as Record<string, unknown>) || {};
        const usd = p && typeof p === 'object' ? (p.estimated_usd ?? p.minimum_usd ?? p.price) : undefined;
        const unit = p && typeof p === 'object' && typeof p.unit === 'string' ? ` / ${p.unit}` : '';
        out.push({ id, note: usd !== undefined ? `${typeof usd === 'number' ? fmtUsd(usd) : String(usd)}${unit}` : '' });
      }
    }
    for (const k of ['data', 'models', 'items', 'capabilities', 'results']) if (k in o) visit(o[k], depth + 1);
  };
  visit(raw, 0);
  return out.slice(0, 200);
}

export function coverPromptFromHook(hook: string): string {
  const h = hook.trim();
  return h
    ? `Write an image prompt for the cover background of a TikTok slideshow titled "${h}". Iro's clay robot penguin mascot (black and orange) can appear if it fits.`
    : 'Write an image prompt for a TikTok slideshow cover background featuring Iro, a black and orange clay robot penguin.';
}
