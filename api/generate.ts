// /api/generate?op=<op>
//
// Server-side image / video / text generation through Sume (sume.com) and
// OpenAI. SUME_API_KEY and OPENAI_API_KEY are read from the environment here
// and only ever sent to those two APIs. They never reach the browser and no
// response or log line contains them.
//
// The production URL is public, so every op except `status` needs the panel
// password in the `x-generate-panel-token` header: GENERATE_ADMIN_TOKEN if set,
// otherwise the existing FASTLANE_ADMIN_TOKEN. With neither set the route stays
// locked.
//
// Free ops (no generation is billed):
//   GET  ?op=status                  → what's configured + whether your token works
//   GET  ?op=catalog&kind=image|video → Sume's model list (ids + prices)
//   POST ?op=quote  {provider, kind, model, …}  → estimated cost
//   GET  ?op=job&id=                 → Sume job status (+ media URLs when done)
//   POST ?op=cancel {id}             → cancel a Sume job that hasn't started
// Paid ops (each needs `confirm: true`, sent only when you press Generate):
//   POST ?op=image {provider:'openai'|'sume', model, prompt, aspect, quality?, refs?}
//   POST ?op=video {model, prompt, aspect, duration, resolution?, imageUrl?}
//   POST ?op=text  {model, prompt, purpose?}           (OpenAI / ChatGPT)
//
// Sume runs are refused before submit when Sume's own estimate is above
// GENERATE_MAX_USD (default $1.50).

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { put } from '@vercel/blob';
import { randomBytes } from 'node:crypto';
import { resolveBlobToken } from '../lib/tiktok.js';
import {
  MIN_TOKEN_LEN,
  OPENAI_BASE,
  OPENAI_IMAGE_MODELS,
  OPENAI_QUALITIES,
  OPENAI_TEXT_MODELS,
  TOKEN_HEADER,
  VIDEO_RESOLUTIONS,
  cleanAspect,
  cleanDuration,
  cleanPrompt,
  isAuthorized,
  isPublicHttpsUrl,
  openaiImageCostFromUsage,
  openaiImageEstimate,
  parseDataUrl,
  parseEstimateUsd,
  parseSumeArtifacts,
  parseSumeJob,
  readEnv,
  responsesText,
  safeJobId,
  safeModel,
  scrubMessage,
  sumeErrorMessage,
  sumeFetch,
  textCostFromUsage,
  type Aspect,
  type DataImage,
  type GenEnv,
  type OpenAIQuality,
} from '../lib/generate.js';

export const config = { api: { bodyParser: { sizeLimit: '4.5mb' } } };

type Fetch = typeof fetch;
type Body = Record<string, unknown>;
export type Deps = {
  fetchImpl?: Fetch;
  env?: GenEnv;
  // Swappable for tests. Uploads a reference image so Sume can fetch it.
  uploadRef?: (img: DataImage) => Promise<string>;
};

function send(res: VercelResponse, status: number, body: unknown): void {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(body);
}
function fail(res: VercelResponse, status: number, code: string, message: string, extra: Record<string, unknown> = {}): void {
  send(res, status, { error: { code, message, ...extra } });
}

const FREE_OPS = ['catalog', 'quote', 'job', 'cancel'];
const PAID_OPS = ['image', 'video', 'text'];

function openaiSize(a: Aspect): string {
  if (a === '1:1') return '1024x1024';
  if (a === '16:9') return '1536x1024';
  return '1024x1536'; // 9:16, 4:5, 3:4 → portrait
}

function idemKey(v: unknown): string {
  const s = typeof v === 'string' ? v.trim() : '';
  return /^[A-Za-z0-9_-]{8,80}$/.test(s) ? s : `iro-${randomBytes(12).toString('hex')}`;
}

async function defaultUploadRef(img: DataImage): Promise<string> {
  const token = resolveBlobToken();
  if (!token) throw new Error('Uploading a reference image for Sume needs Vercel Blob (BLOB_READ_WRITE_TOKEN). Use the Iro penguin preset or a public https image link instead.');
  const ext = img.mime === 'image/png' ? 'png' : img.mime === 'image/webp' ? 'webp' : 'jpg';
  const out = await put(`gen-refs/${randomBytes(12).toString('hex')}.${ext}`, img.bytes, { access: 'public', contentType: img.mime, token, addRandomSuffix: false });
  return out.url;
}

// ---------- Sume helpers ----------

function sumeImageInput(b: Body, refUrls: string[]): Body {
  const input: Body = { prompt: cleanPrompt(b.prompt), aspect_ratio: cleanAspect(b.aspect), n: 1 };
  const q = typeof b.quality === 'string' && /^[a-z]{2,8}$/.test(b.quality) ? b.quality : '';
  if (q) input.quality = q;
  if (refUrls.length) input.input_references = refUrls.map((url) => ({ type: 'image_url', image_url: { url } }));
  return input;
}

function sumeVideoInput(b: Body): Body | string {
  const input: Body = {
    prompt: cleanPrompt(b.prompt),
    aspect_ratio: cleanAspect(b.aspect),
    duration: cleanDuration(b.duration),
  };
  const r = String(b.resolution || '');
  if ((VIDEO_RESOLUTIONS as readonly string[]).includes(r)) input.resolution = r;
  if (b.imageUrl) {
    if (!isPublicHttpsUrl(b.imageUrl)) return 'imageUrl must be a public https link.';
    input.image_url = b.imageUrl;
  }
  return input;
}

async function sumeQuote(key: string, model: string, input: Body, f: Fetch): Promise<{ usd: number | null; error?: { code: string; message: string; status: number } }> {
  const r = await sumeFetch(key, '/v1/open/estimate', { method: 'POST', body: { model, input } }, f);
  if (r.status < 200 || r.status >= 300) {
    const e = sumeErrorMessage(r.json, r.status, key);
    return { usd: null, error: { ...e, status: r.status } };
  }
  return { usd: parseEstimateUsd(r.json) };
}

// Resolves refs for Sume: public https links pass through; data URLs are
// uploaded to Blob first (Sume only fetches public https URLs).
async function sumeRefUrls(raw: unknown, deps: Deps): Promise<string[] | string> {
  if (raw == null) return [];
  if (!Array.isArray(raw)) return 'refs must be a list.';
  if (raw.length > 4) return 'At most 4 reference images.';
  const out: string[] = [];
  for (const r of raw as Body[]) {
    if (r && typeof r.url === 'string') {
      if (!isPublicHttpsUrl(r.url)) return 'Reference links must be public https URLs.';
      out.push(r.url);
    } else if (r && typeof r.dataUrl === 'string') {
      const img = parseDataUrl(r.dataUrl);
      if (typeof img === 'string') return img;
      out.push(await (deps.uploadRef || defaultUploadRef)(img));
    } else return 'Each reference needs a url or a dataUrl.';
  }
  return out;
}

// OpenAI wants the reference bytes themselves. Data URLs are decoded; public
// https links are not fetched server-side (the panel converts them first), so
// this route never makes a request to an arbitrary host.
function openaiRefs(raw: unknown): DataImage[] | string {
  if (raw == null) return [];
  if (!Array.isArray(raw)) return 'refs must be a list.';
  if (raw.length > 4) return 'At most 4 reference images.';
  const out: DataImage[] = [];
  for (const r of raw as Body[]) {
    if (!r || typeof r.dataUrl !== 'string') return 'OpenAI references must be sent as image data.';
    const img = parseDataUrl(r.dataUrl);
    if (typeof img === 'string') return img;
    out.push(img);
  }
  return out;
}

// Gate shared by every Sume submit: price it, refuse over the cap, and refuse
// an unknown price unless the panel showed that and Alex confirmed anyway.
async function sumeGate(res: VercelResponse, env: GenEnv, model: string, input: Body, b: Body, f: Fetch): Promise<number | null | false> {
  const q = await sumeQuote(env.sumeKey, model, input, f);
  if (q.error && (q.error.status === 401 || q.error.status === 402 || q.error.status === 400 || q.error.status === 404)) {
    fail(res, q.error.status === 401 ? 502 : q.error.status, q.error.code, q.error.message);
    return false;
  }
  if (q.usd != null && q.usd > env.maxUsd) {
    fail(res, 400, 'over_cap', `Sume estimates $${q.usd.toFixed(4)}, above the $${env.maxUsd.toFixed(2)} cap. Pick a cheaper model, shorter clip or lower resolution, or raise GENERATE_MAX_USD.`, { estimateUsd: q.usd });
    return false;
  }
  if (q.usd == null && b.acceptUnknownCost !== true) {
    fail(res, 409, 'unknown_cost', 'Sume did not return a price for this request. Confirm again to run it without one.');
    return false;
  }
  return q.usd;
}

function relaySumeJob(res: VercelResponse, r: { status: number; json: unknown }, key: string, extra: Record<string, unknown>): void {
  if (r.status < 200 || r.status >= 300) {
    const e = sumeErrorMessage(r.json, r.status, key);
    fail(res, r.status === 401 ? 502 : r.status === 429 ? 429 : r.status >= 500 ? 502 : r.status, e.code, e.message);
    return;
  }
  const job = parseSumeJob(r.json);
  const artifacts = parseSumeArtifacts(r.json); // sync responses already carry media
  send(res, 200, { data: { job, artifacts, ...extra } });
}

// ---------- OpenAI helpers ----------

async function openaiErr(r: Response, key: string): Promise<{ status: number; code: string; message: string }> {
  let message = `OpenAI answered ${r.status}.`;
  let code = `openai_${r.status}`;
  try {
    const j = (await r.json()) as { error?: { message?: string; code?: string } };
    if (j?.error?.message) message = j.error.message;
    if (j?.error?.code) code = String(j.error.code);
  } catch { /* non-JSON */ }
  if (r.status === 401) message = 'OpenAI refused the API key. Check OPENAI_API_KEY in Vercel.';
  const status = r.status === 401 || r.status >= 500 ? 502 : r.status;
  return { status, code, message: scrubMessage(message, key) };
}

async function openaiImage(res: VercelResponse, env: GenEnv, b: Body, f: Fetch): Promise<void> {
  const model = safeModel(b.model) || 'gpt-image-2';
  if (!OPENAI_IMAGE_MODELS[model]) { fail(res, 400, 'bad_model', `Unknown OpenAI image model "${model}".`); return; }
  const quality = ((OPENAI_QUALITIES as readonly string[]).includes(String(b.quality)) ? b.quality : 'medium') as OpenAIQuality;
  const prompt = cleanPrompt(b.prompt);
  const refs = openaiRefs(b.refs);
  if (typeof refs === 'string') { fail(res, 400, 'bad_refs', refs); return; }
  const est = openaiImageEstimate(model, quality, refs.length);
  if (est > env.maxUsd) { fail(res, 400, 'over_cap', `That run is estimated at about $${est.toFixed(3)}, above the $${env.maxUsd.toFixed(2)} cap.`, { estimateUsd: est }); return; }
  const size = openaiSize(cleanAspect(b.aspect));
  const headers = { Authorization: `Bearer ${env.openaiKey}` };

  let r: Response;
  if (refs.length) {
    const form = new FormData();
    form.append('model', model);
    form.append('prompt', prompt);
    form.append('size', size);
    form.append('quality', quality);
    form.append('output_format', 'jpeg');
    form.append('n', '1');
    refs.forEach((img, i) => form.append('image[]', new Blob([new Uint8Array(img.bytes)], { type: img.mime }), `ref-${i}.${img.mime.split('/')[1]}`));
    r = await f(`${OPENAI_BASE}/images/edits`, { method: 'POST', headers, body: form });
  } else {
    r = await f(`${OPENAI_BASE}/images/generations`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, size, quality, output_format: 'jpeg', n: 1 }),
    });
  }
  if (!r.ok) { const e = await openaiErr(r, env.openaiKey); fail(res, e.status, e.code, e.message); return; }
  const j = (await r.json()) as { data?: Array<{ b64_json?: string }>; usage?: Parameters<typeof openaiImageCostFromUsage>[1] };
  const b64 = j.data?.[0]?.b64_json;
  if (!b64) { fail(res, 502, 'no_image', 'OpenAI returned no image.'); return; }
  send(res, 200, {
    data: {
      provider: 'openai',
      model,
      images: [{ dataUrl: `data:image/jpeg;base64,${b64}` }],
      costUsd: openaiImageCostFromUsage(model, j.usage),
      estimateUsd: est,
    },
  });
}

const TEXT_PURPOSES: Record<string, string> = {
  chat: 'You help Alex make TikTok slideshow content for Iro, a gamified AI-learning app. Be concise and concrete.',
  'image-prompt': [
    'You write prompts for an image model that makes TikTok slideshow cover backgrounds (vertical 9:16).',
    'Return only the prompt, one paragraph, no preamble.',
    'Leave clear empty space for big bold text overlaid later. Never render words, letters, logos or watermarks.',
    'Keep any main subject at least 80px in from the left and right edges (TikTok crops the sides).',
  ].join(' '),
  'video-prompt': [
    'You write prompts for a short text-to-video model (5 to 10 seconds, vertical 9:16) for TikTok.',
    'Return only the prompt: subject, action, camera move, lighting, style. No on-screen text.',
  ].join(' '),
};

async function openaiText(res: VercelResponse, env: GenEnv, b: Body, f: Fetch): Promise<void> {
  const model = safeModel(b.model) || 'gpt-6-luna';
  if (!OPENAI_TEXT_MODELS[model]) { fail(res, 400, 'bad_model', `Unknown OpenAI text model "${model}".`); return; }
  const prompt = cleanPrompt(b.prompt, 8000);
  const purpose = TEXT_PURPOSES[String(b.purpose)] ? String(b.purpose) : 'chat';
  const r = await f(`${OPENAI_BASE}/responses`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.openaiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, instructions: TEXT_PURPOSES[purpose], input: prompt, max_output_tokens: 1200 }),
  });
  if (!r.ok) { const e = await openaiErr(r, env.openaiKey); fail(res, e.status, e.code, e.message); return; }
  const j = (await r.json()) as { usage?: { input_tokens?: number; output_tokens?: number } };
  send(res, 200, { data: { provider: 'openai', model, text: responsesText(j), costUsd: textCostFromUsage(model, j.usage) } });
}

// ---------- handler ----------

export async function handle(req: VercelRequest, res: VercelResponse, deps: Deps = {}): Promise<void> {
  const f = deps.fetchImpl || fetch;
  const env = deps.env || readEnv();
  const op = String((req.query && req.query.op) || 'status');
  const authorized = isAuthorized(String(req.headers[TOKEN_HEADER] || ''), env);

  if (op === 'status') {
    if (req.method !== 'GET') { fail(res, 405, 'method', 'GET only.'); return; }
    send(res, 200, {
      data: {
        sumeKeySet: !!env.sumeKey,
        openaiKeySet: !!env.openaiKey,
        lockSet: !!env.panelToken,
        lockSource: env.panelTokenSource,
        lockTooShort: !!env.panelToken && env.panelToken.length < MIN_TOKEN_LEN,
        authorized,
        maxUsd: env.maxUsd,
      },
    });
    return;
  }

  if (!FREE_OPS.includes(op) && !PAID_OPS.includes(op)) { fail(res, 404, 'unknown_op', `Unknown op "${op}".`); return; }
  if (!env.panelToken) {
    fail(res, 503, 'missing_panel_token', 'Add FASTLANE_ADMIN_TOKEN (or GENERATE_ADMIN_TOKEN) in Vercel, then redeploy. Generation stays locked until then.');
    return;
  }
  if (!authorized) { fail(res, 401, 'bad_panel_token', 'Missing or wrong panel password. Paste your FASTLANE_ADMIN_TOKEN into the panel.'); return; }

  const wantGet = op === 'catalog' || op === 'job';
  if (wantGet && req.method !== 'GET') { fail(res, 405, 'method', 'GET only.'); return; }
  if (!wantGet && req.method !== 'POST') { fail(res, 405, 'method', 'POST only.'); return; }

  const b = (req.body && typeof req.body === 'object' ? req.body : {}) as Body;
  const q = req.query || {};
  const provider = op === 'video' || op === 'catalog' || op === 'job' || op === 'cancel' ? 'sume' : op === 'text' ? 'openai' : String(b.provider || 'openai');
  if (provider !== 'sume' && provider !== 'openai') { fail(res, 400, 'bad_provider', 'provider must be openai or sume.'); return; }
  if (provider === 'sume' && !env.sumeKey) { fail(res, 503, 'missing_sume_key', 'Add SUME_API_KEY in Vercel (Production), then redeploy.'); return; }
  if (provider === 'openai' && !env.openaiKey) { fail(res, 503, 'missing_openai_key', 'Add OPENAI_API_KEY in Vercel (Production), then redeploy.'); return; }

  if (PAID_OPS.includes(op)) {
    if (b.confirm !== true) { fail(res, 400, 'needs_confirm', 'Generation needs an explicit confirm.'); return; }
    if (!cleanPrompt(b.prompt)) { fail(res, 400, 'no_prompt', 'Write a prompt first.'); return; }
  }

  const key = provider === 'sume' ? env.sumeKey : env.openaiKey;
  try {
    switch (op) {
      case 'catalog': {
        const r = await sumeFetch(key, '/v1/open/catalog', {}, f);
        if (r.status < 200 || r.status >= 300) { const e = sumeErrorMessage(r.json, r.status, key); fail(res, r.status === 401 ? 502 : r.status, e.code, e.message); return; }
        send(res, 200, { data: r.json && typeof r.json === 'object' && 'data' in (r.json as Body) ? (r.json as Body).data : r.json });
        return;
      }
      case 'quote': {
        if (provider === 'openai') {
          const model = safeModel(b.model) || 'gpt-image-2';
          const quality = ((OPENAI_QUALITIES as readonly string[]).includes(String(b.quality)) ? b.quality : 'medium') as OpenAIQuality;
          const refs = Array.isArray(b.refs) ? b.refs.length : 0;
          send(res, 200, { data: { provider, model, estimateUsd: openaiImageEstimate(model, quality, refs), approximate: true, maxUsd: env.maxUsd } });
          return;
        }
        const model = safeModel(b.model);
        if (!model) { fail(res, 400, 'bad_model', 'Pick a Sume model.'); return; }
        let input: Body;
        if (b.kind === 'video') {
          const v = sumeVideoInput(b);
          if (typeof v === 'string') { fail(res, 400, 'bad_input', v); return; }
          input = v;
        } else {
          // Placeholder refs so the price reflects image-to-image without
          // uploading anything just to quote.
          const n = Array.isArray(b.refs) ? Math.min(b.refs.length, 4) : 0;
          input = sumeImageInput(b, Array.from({ length: n }, () => 'https://media.sume.com/placeholder.png'));
        }
        if (!input.prompt) input.prompt = 'price check';
        const out = await sumeQuote(key, model, input, f);
        if (out.error) { fail(res, out.error.status === 401 ? 502 : out.error.status, out.error.code, out.error.message); return; }
        send(res, 200, { data: { provider, model, estimateUsd: out.usd, approximate: false, maxUsd: env.maxUsd } });
        return;
      }
      case 'image': {
        if (provider === 'openai') { await openaiImage(res, env, b, f); return; }
        const model = safeModel(b.model);
        if (!model) { fail(res, 400, 'bad_model', 'Pick a Sume model.'); return; }
        const refUrls = await sumeRefUrls(b.refs, deps);
        if (typeof refUrls === 'string') { fail(res, 400, 'bad_refs', refUrls); return; }
        const input = sumeImageInput(b, refUrls);
        const est = await sumeGate(res, env, model, input, b, f);
        if (est === false) return;
        const r = await sumeFetch(key, '/v1/image-router/generate', { method: 'POST', body: { model, ...input, mode: 'async' }, idempotencyKey: idemKey(b.idempotencyKey) }, f);
        relaySumeJob(res, r, key, { provider: 'sume', model, estimateUsd: est });
        return;
      }
      case 'video': {
        const model = safeModel(b.model);
        if (!model) { fail(res, 400, 'bad_model', 'Pick a Sume video model.'); return; }
        const input = sumeVideoInput(b);
        if (typeof input === 'string') { fail(res, 400, 'bad_input', input); return; }
        const est = await sumeGate(res, env, model, input, b, f);
        if (est === false) return;
        const r = await sumeFetch(key, '/v1/video-router/generate', { method: 'POST', body: { model, ...input, mode: 'async' }, idempotencyKey: idemKey(b.idempotencyKey) }, f);
        relaySumeJob(res, r, key, { provider: 'sume', model, estimateUsd: est });
        return;
      }
      case 'job': {
        const id = safeJobId(q.id);
        if (!id) { fail(res, 400, 'bad_id', 'Missing or invalid job id.'); return; }
        const s = await sumeFetch(key, `/v1/jobs/${id}/status`, {}, f);
        if (s.status < 200 || s.status >= 300) { relaySumeJob(res, s, key, {}); return; }
        const job = parseSumeJob(s.json);
        if (!job.id) job.id = id;
        let artifacts: ReturnType<typeof parseSumeArtifacts> = [];
        if (job.status === 'completed') {
          const r = await sumeFetch(key, `/v1/jobs/${id}/result`, {}, f);
          if (r.status >= 200 && r.status < 300) artifacts = parseSumeArtifacts(r.json);
        }
        send(res, 200, { data: { job, artifacts } });
        return;
      }
      case 'cancel': {
        const id = safeJobId(b.id);
        if (!id) { fail(res, 400, 'bad_id', 'Missing or invalid job id.'); return; }
        relaySumeJob(res, await sumeFetch(key, `/v1/jobs/${id}/cancel`, { method: 'POST' }, f), key, {});
        return;
      }
      case 'text':
        await openaiText(res, env, b, f);
        return;
    }
  } catch (e) {
    fail(res, 502, 'upstream_unreachable', scrubMessage(`Generation failed: ${(e as Error).message}`, env.sumeKey, env.openaiKey));
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  await handle(req, res);
}
