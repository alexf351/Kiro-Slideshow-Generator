// AI generation panel: cover images (OpenAI or Sume), short videos (Sume) and
// a ChatGPT box, all through this app's /api/generate route so the Sume and
// OpenAI keys never reach the browser.
//
// Nothing here spends money on its own. "Check price" is free. "Generate…"
// opens a confirm dialog that names the model and the estimated cost, and only
// a press of its confirm button sends the paid request (the server also
// requires `confirm: true`). Sume runs above the server's cap are refused.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useUI } from './ui';
import {
  OPENAI_IMAGE_MODELS,
  OPENAI_TEXT_MODELS,
  PANEL_TOKEN_KEY,
  PENGUIN_REF_PATH,
  SUME_IMAGE_DEFAULTS,
  SUME_VIDEO_DEFAULTS,
  blobToRefDataUrl,
  catalogModels,
  coverPromptFromHook,
  dataUrlToBlob,
  fmtUsd,
  genCall,
  newIdempotencyKey,
  type Artifact,
  type GenStatus,
  type Provider,
  type Ref,
  type SumeJob,
} from './generate';

type Tab = 'image' | 'video' | 'text';
type Quote = { estimateUsd: number | null; approximate: boolean; maxUsd: number };
type ImageResult = { src: string; blob?: Blob; publicUrl?: string; costUsd?: number | null; model: string };

const btn = 'py-2 px-3 rounded-lg text-[11px] font-bold uppercase tracking-[0.12em] border transition-all disabled:opacity-50 disabled:cursor-not-allowed';
const btnGhost = btn + ' border-white/10 bg-white/[0.04] text-gray-300 hover:bg-white/[0.08]';
const btnAccent = btn + ' border-[#A78BFA]/30 bg-[#A78BFA]/15 text-[#C4B5FD] hover:bg-[#A78BFA]/25';
const field = 'w-full bg-[#070b18] border border-white/[0.10] rounded-md px-3 py-2 text-sm text-gray-200 focus:border-[#A78BFA]/40 focus:outline-none';
const cap = 'text-[10px] font-bold uppercase tracking-[0.16em] text-gray-500';

function errText(e: unknown): string {
  return (e as Error)?.message || 'Something went wrong.';
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function GeneratePanel({
  hook,
  onUseImage,
}: {
  hook: string;
  onUseImage: (blob: Blob, target: 'cover' | 'all', name: string) => Promise<void>;
}) {
  const ui = useUI();
  const [token, setToken] = useState<string>(() => {
    try { return localStorage.getItem(PANEL_TOKEN_KEY) || ''; } catch { return ''; }
  });
  const [tokenDraft, setTokenDraft] = useState('');
  const [status, setStatus] = useState<GenStatus | null>(null);
  const [statusErr, setStatusErr] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<Tab>('image');

  // image
  const [provider, setProvider] = useState<Provider>('openai');
  const [oaModel, setOaModel] = useState(OPENAI_IMAGE_MODELS[0].id);
  const [sumeImgModel, setSumeImgModel] = useState(SUME_IMAGE_DEFAULTS[0]);
  const [quality, setQuality] = useState('medium');
  const [aspect, setAspect] = useState('9:16');
  const [imgPrompt, setImgPrompt] = useState('');
  const [usePenguin, setUsePenguin] = useState(true);
  const [uploads, setUploads] = useState<{ name: string; dataUrl: string }[]>([]);
  const [imgQuote, setImgQuote] = useState<Quote | null>(null);
  const [imgResult, setImgResult] = useState<ImageResult | null>(null);

  // video
  const [vidModel, setVidModel] = useState(SUME_VIDEO_DEFAULTS[0]);
  const [vidPrompt, setVidPrompt] = useState('');
  const [duration, setDuration] = useState(5);
  const [resolution, setResolution] = useState('720p');
  const [vidFromImage, setVidFromImage] = useState(false);
  const [vidQuote, setVidQuote] = useState<Quote | null>(null);
  const [vidResult, setVidResult] = useState<Artifact | null>(null);

  // sume job tracking (image or video)
  const [job, setJob] = useState<SumeJob | null>(null);
  const cancelPoll = useRef(false);

  // chatgpt
  const [txtModel, setTxtModel] = useState(OPENAI_TEXT_MODELS[0].id);
  const [txtPrompt, setTxtPrompt] = useState('');
  const [txtOut, setTxtOut] = useState<{ text: string; costUsd: number | null } | null>(null);

  const [catalog, setCatalog] = useState<{ image: { id: string; note: string }[]; video: { id: string; note: string }[] } | null>(null);

  const ok = !!status?.authorized;
  const penguinUrl = typeof location !== 'undefined' ? `${location.origin}${PENGUIN_REF_PATH}` : PENGUIN_REF_PATH;

  const loadStatus = useCallback(async (tok: string) => {
    setStatusErr('');
    try {
      const r = await genCall<{ data: GenStatus }>('status', tok);
      setStatus(r.data);
    } catch (e) {
      setStatus(null);
      setStatusErr(errText(e));
    }
  }, []);
  useEffect(() => { void loadStatus(token); }, [token, loadStatus]);
  useEffect(() => () => { cancelPoll.current = true; }, []);
  useEffect(() => { setImgQuote(null); }, [provider, oaModel, sumeImgModel, quality, aspect, usePenguin, uploads.length]);
  useEffect(() => { setVidQuote(null); }, [vidModel, duration, resolution, aspect, vidFromImage]);

  function saveToken() {
    const t = tokenDraft.trim();
    if (!t) return;
    try { localStorage.setItem(PANEL_TOKEN_KEY, t); } catch { /* private mode */ }
    setToken(t); setTokenDraft('');
  }

  async function run<T>(what: string, fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(what); setErr('');
    try { return await fn(); }
    catch (e) { setErr(errText(e)); return undefined; }
    finally { setBusy(''); }
  }

  // ---- references ----
  async function refsFor(p: Provider): Promise<Ref[]> {
    const refs: Ref[] = [];
    if (usePenguin) {
      if (p === 'sume') refs.push({ url: penguinUrl });
      else {
        const b = await (await fetch(PENGUIN_REF_PATH)).blob();
        refs.push({ dataUrl: await blobToRefDataUrl(b) });
      }
    }
    uploads.forEach((u) => refs.push({ dataUrl: u.dataUrl }));
    return refs;
  }

  async function onPickFiles(files: FileList | null) {
    if (!files) return;
    const next = [...uploads];
    for (const f of Array.from(files).slice(0, 4 - next.length)) {
      if (!f.type.startsWith('image/')) continue;
      try { next.push({ name: f.name, dataUrl: await blobToRefDataUrl(f) }); }
      catch { ui.notify(`Couldn't read ${f.name}.`, { type: 'error' }); }
    }
    setUploads(next);
  }

  const imgModel = provider === 'openai' ? oaModel : sumeImgModel;

  function imageBody(refs: Ref[]) {
    return {
      provider, model: imgModel, prompt: imgPrompt.trim(), aspect,
      quality: provider === 'openai' || quality !== 'medium' ? quality : undefined,
      refs,
    };
  }

  async function quoteImage(): Promise<Quote | undefined> {
    return run('Checking price…', async () => {
      const refs = provider === 'sume' ? await refsFor('sume') : Array.from({ length: (usePenguin ? 1 : 0) + uploads.length }, () => ({ url: '' }));
      const r = await genCall<{ data: Quote }>('quote', token, { body: { ...imageBody(refs as Ref[]), kind: 'image' } });
      setImgQuote(r.data);
      return r.data;
    });
  }

  async function quoteVideo(): Promise<Quote | undefined> {
    return run('Checking price…', async () => {
      const r = await genCall<{ data: Quote }>('quote', token, { body: videoBody() });
      setVidQuote(r.data);
      return r.data;
    });
  }

  function confirmText(model: string, q: Quote | undefined, extra: string): string {
    const price = q ? (q.estimateUsd == null ? 'Sume did not return a price for this one.' : `${q.approximate ? 'About ' : ''}${fmtUsd(q.estimateUsd)}${q.approximate ? ' (OpenAI bills by tokens, so the final figure can differ a little)' : ' (Sume’s estimate)'}.`) : 'Price unknown.';
    return `${extra}\n\nModel: ${model}\nCost: ${price}\nSpend cap per run: ${fmtUsd(status?.maxUsd)}.`;
  }

  // ---- polling a Sume job ----
  async function pollJob(first: SumeJob): Promise<Artifact[]> {
    cancelPoll.current = false;
    let j = first;
    setJob(j);
    const started = Date.now();
    while (!j.terminal) {
      if (cancelPoll.current) throw new Error('Stopped watching. The job may still finish in your Sume dashboard.');
      if (Date.now() - started > 10 * 60_000) throw new Error('Still running after 10 minutes. Check the Sume dashboard.');
      await sleep(j.nextPollSeconds * 1000);
      const r = await genCall<{ data: { job: SumeJob; artifacts: Artifact[] } }>('job', token, { query: { id: j.id } });
      j = r.data.job;
      setJob(j);
      if (j.terminal) {
        if (j.status !== 'completed') throw new Error(`Sume job ${j.status}${j.error ? `: ${j.error}` : ''}. Failed and canceled jobs are refunded.`);
        return r.data.artifacts;
      }
    }
    return [];
  }

  async function cancelJob() {
    if (!job) return;
    cancelPoll.current = true;
    try {
      await genCall('cancel', token, { body: { id: job.id } });
      ui.notify('Cancel sent. Sume refunds canceled jobs.', { type: 'info' });
    } catch (e) {
      ui.notify(errText(e), { type: 'error' });
    }
  }

  // ---- image ----
  async function generateImage() {
    if (!imgPrompt.trim()) { ui.notify('Write a prompt first.', { type: 'info' }); return; }
    const q = imgQuote || (await quoteImage());
    if (!q) return;
    if (q.estimateUsd != null && q.estimateUsd > q.maxUsd) { setErr(`Estimated ${fmtUsd(q.estimateUsd)} is above the ${fmtUsd(q.maxUsd)} cap.`); return; }
    const refsNote = (usePenguin ? 1 : 0) + uploads.length;
    const yes = await ui.confirm({
      title: 'Generate this image?',
      message: confirmText(imgModel, q, `${provider === 'openai' ? 'OpenAI' : 'Sume'} will make one ${aspect} image${refsNote ? ` from ${refsNote} reference image${refsNote > 1 ? 's' : ''}` : ''}.`),
      confirmLabel: `Generate (${fmtUsd(q.estimateUsd)})`,
    });
    if (!yes) return;
    await run('Generating image…', async () => {
      const refs = await refsFor(provider);
      const body = { ...imageBody(refs), confirm: true, acceptUnknownCost: q.estimateUsd == null, idempotencyKey: newIdempotencyKey() };
      if (provider === 'openai') {
        const r = await genCall<{ data: { images: { dataUrl: string }[]; costUsd: number | null; model: string } }>('image', token, { body });
        const src = r.data.images[0].dataUrl;
        setImgResult({ src, blob: await dataUrlToBlob(src), costUsd: r.data.costUsd, model: r.data.model });
        return;
      }
      const r = await genCall<{ data: { job: SumeJob; artifacts: Artifact[]; estimateUsd: number | null } }>('image', token, { body });
      const arts = r.data.artifacts.length ? r.data.artifacts : await pollJob(r.data.job);
      const img = arts.find((a) => a.type === 'image' || a.contentType.startsWith('image/')) || arts[0];
      if (!img) throw new Error('Sume finished but returned no image.');
      setImgResult({ src: img.url, publicUrl: img.url, costUsd: r.data.estimateUsd, model: sumeImgModel });
    });
    setJob(null);
  }

  async function imageBlob(res: ImageResult): Promise<Blob> {
    if (res.blob) return res.blob;
    const r = await fetch(`/api/proxy-image?url=${encodeURIComponent(res.src)}`);
    if (!r.ok) throw new Error(`Couldn't download the image (${r.status}).`);
    const b = await r.blob();
    setImgResult({ ...res, blob: b });
    return b;
  }

  async function useImage(target: 'cover' | 'all') {
    if (!imgResult) return;
    await run(target === 'cover' ? 'Setting cover…' : 'Setting backgrounds…', async () => {
      const b = await imageBlob(imgResult);
      await onUseImage(b, target, `ai-${imgPrompt.trim().slice(0, 28) || 'cover'}`);
      ui.notify(target === 'cover' ? 'Set as the cover background.' : 'Set on every slide.', { type: 'success' });
    });
  }

  async function downloadImage() {
    if (!imgResult) return;
    await run('Preparing download…', async () => {
      const b = await imageBlob(imgResult);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = `iro-gen-${Date.now()}.${b.type.includes('png') ? 'png' : 'jpg'}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    });
  }

  // ---- video ----
  function videoBody() {
    const imageUrl = vidFromImage ? (imgResult?.publicUrl || penguinUrl) : undefined;
    return { kind: 'video', model: vidModel, prompt: vidPrompt.trim(), aspect, duration, resolution, imageUrl };
  }

  async function generateVideo() {
    if (!vidPrompt.trim()) { ui.notify('Write a prompt first.', { type: 'info' }); return; }
    const q = vidQuote || (await quoteVideo());
    if (!q) return;
    if (q.estimateUsd != null && q.estimateUsd > q.maxUsd) { setErr(`Estimated ${fmtUsd(q.estimateUsd)} is above the ${fmtUsd(q.maxUsd)} cap.`); return; }
    const yes = await ui.confirm({
      title: 'Generate this video?',
      message: confirmText(vidModel, q, `Sume will make one ${duration}s ${resolution} ${aspect} clip${vidFromImage ? ', starting from an image' : ''}.`),
      confirmLabel: `Generate (${fmtUsd(q.estimateUsd)})`,
    });
    if (!yes) return;
    await run('Generating video… this can take a few minutes', async () => {
      const r = await genCall<{ data: { job: SumeJob; artifacts: Artifact[] } }>('video', token, {
        body: { ...videoBody(), confirm: true, acceptUnknownCost: q.estimateUsd == null, idempotencyKey: newIdempotencyKey() },
      });
      const arts = r.data.artifacts.length ? r.data.artifacts : await pollJob(r.data.job);
      const v = arts.find((a) => a.type === 'video' || a.contentType.startsWith('video/')) || arts[0];
      if (!v) throw new Error('Sume finished but returned no video.');
      setVidResult(v);
    });
    setJob(null);
  }

  // ---- chatgpt ----
  async function ask(purpose: 'chat' | 'image-prompt' | 'video-prompt', prompt: string) {
    if (!prompt.trim()) { ui.notify('Write something first.', { type: 'info' }); return; }
    return run('Asking ChatGPT…', async () => {
      const r = await genCall<{ data: { text: string; costUsd: number | null } }>('text', token, {
        body: { model: txtModel, prompt, purpose, confirm: true },
      });
      return r.data;
    });
  }

  async function draftPrompt(kind: 'image' | 'video') {
    const base = kind === 'image'
      ? coverPromptFromHook(hook)
      : `Write a short video prompt for a TikTok about: ${hook.trim() || 'Iro, a black and orange clay robot penguin who teaches AI skills'}.`;
    const out = await ask(kind === 'image' ? 'image-prompt' : 'video-prompt', base);
    if (!out) return;
    if (kind === 'image') setImgPrompt(out.text); else setVidPrompt(out.text);
    ui.notify(`Prompt drafted (${fmtUsd(out.costUsd)}).`, { type: 'success' });
  }

  async function loadCatalog() {
    await run('Loading Sume models…', async () => {
      const r = await genCall<{ data: unknown }>('catalog', token);
      const next = { image: catalogModels(r.data, 'image'), video: catalogModels(r.data, 'video') };
      setCatalog(next);
      if (!next.image.length && !next.video.length) setErr('Sume answered, but I could not read model ids from it. Type a model id by hand.');
    });
  }

  // ---------- render ----------
  const keysLine = status && (
    <div className="text-[11px] text-gray-500 leading-relaxed">
      OpenAI key {status.openaiKeySet ? '✓' : '✗'} · Sume key {status.sumeKeySet ? '✓' : '✗'} · cap {fmtUsd(status.maxUsd)} per run
    </div>
  );

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500 leading-relaxed">
        Make cover images and short clips with your OpenAI and Sume keys from Vercel. Nothing is charged until you confirm a run.
      </p>

      {statusErr && <div className="text-[11px] text-red-400">{statusErr}</div>}
      {status && !status.lockSet && (
        <div className="text-[11px] text-amber-400 leading-relaxed">Locked: add FASTLANE_ADMIN_TOKEN (or GENERATE_ADMIN_TOKEN) in Vercel and redeploy.</div>
      )}
      {status && status.lockSet && !ok && (
        <div className="space-y-2">
          <div className={cap}>Panel password</div>
          <div className="text-[11px] text-gray-500">Same password as the Fastlane panel ({status.lockSource || 'admin token'}).</div>
          <div className="flex gap-2">
            <input type="password" className={field} value={tokenDraft} onChange={(e) => setTokenDraft(e.target.value)} placeholder="Paste it here" onKeyDown={(e) => e.key === 'Enter' && saveToken()} />
            <button className={btnAccent} onClick={saveToken}>Unlock</button>
          </div>
          {token && <div className="text-[11px] text-red-400">That password didn’t match.</div>}
        </div>
      )}
      {keysLine}

      {ok && (
        <>
          <div className="flex gap-1">
            {(['image', 'video', 'text'] as Tab[]).map((t) => (
              <button key={t} className={(tab === t ? btnAccent : btnGhost) + ' flex-1'} onClick={() => setTab(t)}>
                {t === 'image' ? 'Image' : t === 'video' ? 'Video' : 'ChatGPT'}
              </button>
            ))}
          </div>

          {tab === 'image' && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1"><div className={cap}>Provider</div>
                  <select className={field} value={provider} onChange={(e) => setProvider(e.target.value as Provider)}>
                    <option value="openai" disabled={!status?.openaiKeySet}>OpenAI</option>
                    <option value="sume" disabled={!status?.sumeKeySet}>Sume</option>
                  </select>
                </label>
                <label className="space-y-1"><div className={cap}>Shape</div>
                  <select className={field} value={aspect} onChange={(e) => setAspect(e.target.value)}>
                    {['9:16', '4:5', '1:1', '16:9'].map((a) => <option key={a}>{a}</option>)}
                  </select>
                </label>
              </div>
              <label className="space-y-1 block"><div className={cap}>Model</div>
                {provider === 'openai' ? (
                  <select className={field} value={oaModel} onChange={(e) => setOaModel(e.target.value)}>
                    {OPENAI_IMAGE_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                ) : (
                  <>
                    <input className={field} list="sume-image-models" value={sumeImgModel} onChange={(e) => setSumeImgModel(e.target.value.trim())} />
                    <datalist id="sume-image-models">
                      {(catalog?.image.length ? catalog.image : SUME_IMAGE_DEFAULTS.map((id) => ({ id, note: '' }))).map((m) => <option key={m.id} value={m.id}>{m.note}</option>)}
                    </datalist>
                  </>
                )}
              </label>
              <label className="space-y-1 block"><div className={cap}>Quality</div>
                <select className={field} value={quality} onChange={(e) => setQuality(e.target.value)}>
                  <option value="low">Low (cheapest)</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </label>
              <label className="space-y-1 block"><div className={cap}>Prompt</div>
                <textarea className={field + ' min-h-[96px]'} value={imgPrompt} onChange={(e) => setImgPrompt(e.target.value)} placeholder="e.g. clay-style scene, Iro the penguin on a cliff edge, big empty sky upper half for text" />
              </label>
              <button className={btnGhost + ' w-full'} disabled={!!busy || !status?.openaiKeySet} onClick={() => void draftPrompt('image')}>
                ✍️ Draft prompt from the hook with ChatGPT
              </button>
              <div className="space-y-1">
                <div className={cap}>Reference images</div>
                <label className="flex items-center gap-2 text-[12px] text-gray-300">
                  <input type="checkbox" checked={usePenguin} onChange={(e) => setUsePenguin(e.target.checked)} />
                  Iro clay penguin
                  <img src={PENGUIN_REF_PATH} alt="" className="w-6 h-9 object-cover rounded border border-white/10" />
                </label>
                <input type="file" accept="image/png,image/jpeg,image/webp" multiple className="text-[11px] text-gray-400" onChange={(e) => { void onPickFiles(e.target.files); e.target.value = ''; }} />
                {uploads.map((u, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px] text-gray-400">
                    <img src={u.dataUrl} alt="" className="w-6 h-6 object-cover rounded" /> {u.name}
                    <button className="text-red-400" onClick={() => setUploads(uploads.filter((_, j) => j !== i))}>remove</button>
                  </div>
                ))}
                {provider === 'sume' && uploads.length > 0 && <div className="text-[10px] text-gray-600">Uploads go to your Vercel Blob first so Sume can fetch them.</div>}
              </div>
              <div className="flex gap-2">
                <button className={btnGhost + ' flex-1'} disabled={!!busy} onClick={() => void quoteImage()}>Check price</button>
                <button className={btnAccent + ' flex-1'} disabled={!!busy || !imgPrompt.trim()} onClick={() => void generateImage()}>Generate…</button>
              </div>
              {imgQuote && (
                <div className="text-[11px] text-gray-400">
                  {imgModel}: {imgQuote.estimateUsd == null ? 'no price returned' : `${imgQuote.approximate ? 'about ' : ''}${fmtUsd(imgQuote.estimateUsd)}`} per image
                </div>
              )}
              {imgResult && (
                <div className="space-y-2 p-2 rounded-lg border border-white/[0.08] bg-white/[0.02]">
                  <img src={imgResult.src} alt="Generated" className="w-full rounded-md" />
                  <div className="text-[11px] text-gray-500">{imgResult.model}{imgResult.costUsd != null ? ` · ${fmtUsd(imgResult.costUsd)}` : ''}</div>
                  <div className="grid grid-cols-3 gap-1">
                    <button className={btnAccent} disabled={!!busy} onClick={() => void useImage('cover')}>Cover bg</button>
                    <button className={btnGhost} disabled={!!busy} onClick={() => void useImage('all')}>All slides</button>
                    <button className={btnGhost} disabled={!!busy} onClick={() => void downloadImage()}>Save</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === 'video' && (
            <div className="space-y-2">
              {!status?.sumeKeySet && <div className="text-[11px] text-amber-400">Video uses Sume. Add SUME_API_KEY in Vercel.</div>}
              <label className="space-y-1 block"><div className={cap}>Sume model</div>
                <input className={field} list="sume-video-models" value={vidModel} onChange={(e) => setVidModel(e.target.value.trim())} />
                <datalist id="sume-video-models">
                  {(catalog?.video.length ? catalog.video : SUME_VIDEO_DEFAULTS.map((id) => ({ id, note: '' }))).map((m) => <option key={m.id} value={m.id}>{m.note}</option>)}
                </datalist>
              </label>
              <div className="grid grid-cols-3 gap-2">
                <label className="space-y-1"><div className={cap}>Seconds</div>
                  <input type="number" min={2} max={15} className={field} value={duration} onChange={(e) => setDuration(Math.min(15, Math.max(2, Number(e.target.value) || 5)))} />
                </label>
                <label className="space-y-1"><div className={cap}>Res</div>
                  <select className={field} value={resolution} onChange={(e) => setResolution(e.target.value)}>
                    {['480p', '720p', '1080p'].map((r) => <option key={r}>{r}</option>)}
                  </select>
                </label>
                <label className="space-y-1"><div className={cap}>Shape</div>
                  <select className={field} value={aspect} onChange={(e) => setAspect(e.target.value)}>
                    {['9:16', '1:1', '16:9'].map((a) => <option key={a}>{a}</option>)}
                  </select>
                </label>
              </div>
              <label className="space-y-1 block"><div className={cap}>Prompt</div>
                <textarea className={field + ' min-h-[80px]'} value={vidPrompt} onChange={(e) => setVidPrompt(e.target.value)} placeholder="e.g. clay penguin waves at camera, slow push-in, soft studio light" />
              </label>
              <button className={btnGhost + ' w-full'} disabled={!!busy || !status?.openaiKeySet} onClick={() => void draftPrompt('video')}>✍️ Draft prompt with ChatGPT</button>
              <label className="flex items-center gap-2 text-[12px] text-gray-300">
                <input type="checkbox" checked={vidFromImage} onChange={(e) => setVidFromImage(e.target.checked)} />
                Start from {imgResult?.publicUrl ? 'the last Sume image' : 'the Iro penguin'} (image-to-video models only)
              </label>
              <div className="flex gap-2">
                <button className={btnGhost + ' flex-1'} disabled={!!busy || !status?.sumeKeySet} onClick={() => void quoteVideo()}>Check price</button>
                <button className={btnAccent + ' flex-1'} disabled={!!busy || !vidPrompt.trim() || !status?.sumeKeySet} onClick={() => void generateVideo()}>Generate…</button>
              </div>
              {vidQuote && (
                <div className="text-[11px] text-gray-400">{vidModel}, {duration}s {resolution}: {vidQuote.estimateUsd == null ? 'no price returned' : fmtUsd(vidQuote.estimateUsd)}</div>
              )}
              {vidResult && (
                <div className="space-y-2 p-2 rounded-lg border border-white/[0.08] bg-white/[0.02]">
                  <video src={vidResult.url} controls playsInline className="w-full rounded-md" />
                  <a className={btnGhost + ' block text-center'} href={vidResult.url} target="_blank" rel="noreferrer" download>Open / save video</a>
                </div>
              )}
            </div>
          )}

          {tab === 'text' && (
            <div className="space-y-2">
              <label className="space-y-1 block"><div className={cap}>Model</div>
                <select className={field} value={txtModel} onChange={(e) => setTxtModel(e.target.value)}>
                  {OPENAI_TEXT_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </label>
              <textarea className={field + ' min-h-[96px]'} value={txtPrompt} onChange={(e) => setTxtPrompt(e.target.value)} placeholder="Ask ChatGPT anything about the post…" />
              <button className={btnAccent + ' w-full'} disabled={!!busy || !txtPrompt.trim() || !status?.openaiKeySet} onClick={async () => { const o = await ask('chat', txtPrompt); if (o) setTxtOut(o); }}>Ask</button>
              {txtOut && (
                <div className="space-y-2 p-2 rounded-lg border border-white/[0.08] bg-white/[0.02]">
                  <div className="text-[12px] text-gray-200 whitespace-pre-wrap">{txtOut.text}</div>
                  <div className="text-[10px] text-gray-500">{txtModel} · {fmtUsd(txtOut.costUsd)}</div>
                  <div className="grid grid-cols-2 gap-1">
                    <button className={btnGhost} onClick={() => void navigator.clipboard?.writeText(txtOut.text)}>Copy</button>
                    <button className={btnGhost} onClick={() => { setImgPrompt(txtOut.text); setTab('image'); }}>Use as image prompt</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {provider === 'sume' || tab === 'video' ? (
            <button className={btnGhost + ' w-full'} disabled={!!busy || !status?.sumeKeySet} onClick={() => void loadCatalog()}>Load Sume models & prices</button>
          ) : null}

          {busy && (
            <div className="text-[11px] text-gray-400 flex items-center gap-2">
              <span>{busy}{job ? ` (Sume: ${job.status})` : ''}</span>
              {job && !job.terminal && <button className="text-red-400 underline" onClick={() => void cancelJob()}>cancel</button>}
            </div>
          )}
          {err && <div className="text-[11px] text-red-400 leading-relaxed">{err}</div>}
        </>
      )}
    </div>
  );
}

