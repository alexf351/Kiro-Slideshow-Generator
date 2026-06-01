// "Analyze my TikTok post" importer — the ingestion half of the
// prediction loop. Paste one of YOUR OWN post URLs; we scrape its slides
// + caption (reusing the clone pipeline) and Claude reads the on-screen
// text off each photo. The result is saved as a `self` post with an empty
// stats block the user then fills in from TikTok's analytics screen.
//
// Once scored, these posts become the labeled history the predictor
// learns from. API mode uses vision (reads the actual slide images);
// manual mode can't send images through claude.ai, so it works from the
// caption plus any on-screen text the user types in.

import { useState } from 'react';
import {
  analyzeOwnPost,
  applySelfAnalysisManualResponse,
  buildManualSelfAnalysisPrompt,
  type SelfAnalysisResult,
} from './predict';
import { scrapeTikTok, fetchProxiedImage, type ScrapeResult } from './tiktokClone';
import { addPost, type SelfAnalysis } from './posts';
import { CLAUDE_MODELS, type ClaudeModelId } from './anthropic';

type Props = {
  anthropicKey: string;
  model: ClaudeModelId;
  onModelChange: (m: ClaudeModelId) => void;
  onImported: () => void; // refresh the Analytics list
};

type Mode = 'api' | 'manual';

type Status =
  | { kind: 'idle' }
  | { kind: 'scraping' }
  | { kind: 'reading'; done: number; total: number }
  | { kind: 'prompt_ready'; source: ScrapeResult; prompt: string }
  | { kind: 'awaiting_paste'; source: ScrapeResult }
  | { kind: 'saving' }
  | { kind: 'ok'; author: string }
  | { kind: 'err'; msg: string };

// Best-effort cover thumbnail so the imported post isn't a blank tile.
async function fetchThumb(source: ScrapeResult): Promise<Blob | null> {
  const url = source.coverImage || source.slides[0]?.imageUrl;
  if (!url) return null;
  try {
    return await fetchProxiedImage(url);
  } catch {
    return null;
  }
}

export default function AnalyzeMyPost({ anthropicKey, model, onModelChange, onImported }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<Mode>('api');
  const [url, setUrl] = useState('');
  const [typedSlides, setTypedSlides] = useState('');
  const [manualResponse, setManualResponse] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const busy = status.kind === 'scraping' || status.kind === 'reading' || status.kind === 'saving';
  const keyMissing = !anthropicKey;

  async function saveSelfPost(source: ScrapeResult, result: SelfAnalysisResult) {
    setStatus({ kind: 'saving' });
    const thumb = await fetchThumb(source);
    const selfAnalysis: SelfAnalysis = {
      slideTexts: result.slideTexts,
      hookText: result.hookText,
      hookStyle: result.hookStyle,
      niche: result.niche,
      voiceTone: result.voiceTone,
      contentSummary: result.contentSummary,
      analyzedAt: Date.now(),
      source: mode === 'api' ? 'api' : 'manual',
    };
    await addPost({
      caption: source.caption,
      tiktokUrl: source.url,
      jsonSnapshot: '',
      mascot: '',
      platform: 'tiktok',
      thumbnailBlob: thumb,
      origin: 'self',
      niche: result.niche || undefined,
      selfAnalysis,
    });
    setStatus({ kind: 'ok', author: source.author.uniqueId });
    setUrl('');
    setTypedSlides('');
    onImported();
    setTimeout(() => setStatus((s) => (s.kind === 'ok' ? { kind: 'idle' } : s)), 5000);
  }

  async function handleApi() {
    if (!url.trim()) return;
    if (keyMissing) {
      setStatus({ kind: 'err', msg: 'Add an Anthropic API key in Settings, or switch to Manual mode.' });
      return;
    }
    setStatus({ kind: 'scraping' });
    try {
      const source = await scrapeTikTok(url.trim());
      if (source.slides.length === 0) {
        setStatus({
          kind: 'err',
          msg: 'No slide images found — vision analysis needs a photo carousel. For video posts, use Manual mode and type the on-screen text.',
        });
        return;
      }
      setStatus({ kind: 'reading', done: 0, total: source.slides.length });
      const result = await analyzeOwnPost({
        apiKey: anthropicKey,
        model,
        source,
        onProgress: (done, total) => setStatus({ kind: 'reading', done, total }),
      });
      await saveSelfPost(source, result);
    } catch (e) {
      setStatus({ kind: 'err', msg: (e as Error).message || 'Analysis failed.' });
    }
  }

  async function handleManualBuild() {
    if (!url.trim()) return;
    setStatus({ kind: 'scraping' });
    try {
      const source = await scrapeTikTok(url.trim());
      const typed = typedSlides.split('\n').map((l) => l.trim()).filter(Boolean);
      const prompt = buildManualSelfAnalysisPrompt(source, typed);
      setStatus({ kind: 'prompt_ready', source, prompt });
    } catch (e) {
      setStatus({ kind: 'err', msg: (e as Error).message || 'Could not scrape that URL.' });
    }
  }

  function handleManualCopyAndOpen() {
    if (status.kind !== 'prompt_ready') return;
    const { source, prompt } = status;
    navigator.clipboard?.writeText(prompt).catch(() => {
      try {
        const ta = document.createElement('textarea');
        ta.value = prompt;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      } catch {}
    });
    window.open('https://claude.ai/new', '_blank', 'noopener,noreferrer');
    setStatus({ kind: 'awaiting_paste', source });
  }

  async function handleManualApply() {
    if (status.kind !== 'awaiting_paste') return;
    if (!manualResponse.trim()) return;
    const source = status.source;
    try {
      const result = applySelfAnalysisManualResponse(manualResponse);
      setManualResponse('');
      await saveSelfPost(source, result);
    } catch (e) {
      setStatus({ kind: 'err', msg: (e as Error).message || 'Could not parse the reply.' });
    }
  }

  function reset() {
    setManualResponse('');
    setStatus({ kind: 'idle' });
  }

  const modeBtn = (m: Mode, label: string, sub: string) => {
    const active = mode === m;
    return (
      <button
        type="button"
        onClick={() => {
          setMode(m);
          if (status.kind !== 'idle' && status.kind !== 'ok') reset();
        }}
        className={
          'flex-1 px-3 py-2 rounded-md text-left transition-colors ' +
          (active ? 'bg-[#22C55E]/15 text-[#22C55E]' : 'bg-white/[0.03] text-gray-400 hover:bg-white/[0.06] hover:text-gray-200')
        }
      >
        <div className="text-[11px] font-bold uppercase tracking-[0.14em]">{label}</div>
        <div className="text-[10px] normal-case tracking-normal mt-0.5 text-gray-500">{sub}</div>
      </button>
    );
  };

  return (
    <div className="rounded-2xl border border-[#22C55E]/25 bg-gradient-to-br from-[#10241a] to-[#0a1611] p-4">
      <button type="button" onClick={() => setExpanded((v) => !v)} className="w-full flex items-center justify-between text-left">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-[#22C55E]/15 text-[#22C55E] text-base">＋</span>
          <div>
            <div className="text-[13px] font-bold uppercase tracking-[0.18em] text-[#22C55E]">Analyze my TikTok post</div>
            <div className="text-[11px] text-gray-500 mt-0.5">Paste your post URL · reads each slide · adds it to score</div>
          </div>
        </div>
        <span className="text-gray-500 text-xs">{expanded ? '▾' : '▸'}</span>
      </button>

      {expanded && (
        <div className="mt-4 flex flex-col gap-3">
          <div className="flex gap-2 p-1 rounded-lg bg-black/30 border border-white/[0.05]">
            {modeBtn('api', 'API mode', 'Reads slide photos · BYOK')}
            {modeBtn('manual', 'Manual', 'Free · type slide text')}
          </div>

          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.tiktok.com/@you/photo/1234…"
            spellCheck={false}
            className="w-full bg-[#070b18] border border-white/[0.10] rounded-lg px-3 py-2.5 text-sm text-gray-200 placeholder:text-gray-700 focus:border-[#22C55E]/50 focus:outline-none"
          />

          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">
              {mode === 'manual' ? 'Model (FYI)' : 'Model'}
            </span>
            <select
              value={model}
              onChange={(e) => onModelChange(e.target.value as ClaudeModelId)}
              disabled={mode === 'manual'}
              className="bg-[#070b18] border border-white/[0.10] rounded-md px-2 py-2 text-xs text-gray-200 focus:border-[#22C55E]/40 focus:outline-none disabled:opacity-50"
            >
              {CLAUDE_MODELS.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </label>

          {mode === 'manual' && status.kind !== 'awaiting_paste' && status.kind !== 'prompt_ready' && (
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">
                On-screen text per slide (optional, one per line)
              </span>
              <textarea
                value={typedSlides}
                onChange={(e) => setTypedSlides(e.target.value)}
                rows={3}
                placeholder={'3 prompts every writer should steal\n1. outline from mess\n…'}
                className="bg-[#070b18] border border-white/[0.10] rounded-md px-3 py-2 text-xs text-gray-200 placeholder:text-gray-700 focus:border-[#22C55E]/40 focus:outline-none resize-y"
              />
            </label>
          )}

          {status.kind !== 'prompt_ready' && status.kind !== 'awaiting_paste' && (
            <button
              type="button"
              onClick={mode === 'api' ? handleApi : handleManualBuild}
              disabled={busy || !url.trim()}
              className="w-full py-3 rounded-xl font-bold text-sm tracking-wide
                         bg-gradient-to-r from-[#22C55E] to-[#15924A] text-[#08160e]
                         shadow-[0_4px_20px_rgba(34,197,94,0.3)] hover:shadow-[0_6px_28px_rgba(34,197,94,0.5)]
                         hover:-translate-y-0.5 active:translate-y-0 transition-all
                         disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
            >
              {status.kind === 'scraping'
                ? 'Scraping…'
                : status.kind === 'reading'
                  ? `Reading slides (${status.done}/${status.total})…`
                  : status.kind === 'saving'
                    ? 'Saving…'
                    : mode === 'api'
                      ? 'Analyze + add'
                      : 'Build prompt'}
            </button>
          )}

          {mode === 'manual' && status.kind === 'prompt_ready' && (
            <div className="flex flex-col gap-2 rounded-xl border border-[#22C55E]/40 bg-[#0c1d14] p-3">
              <div className="text-[11px] text-[#22C55E] leading-relaxed">✓ Prompt ready. Copy + open Claude.ai.</div>
              <textarea
                value={status.prompt}
                readOnly
                rows={4}
                spellCheck={false}
                onFocus={(e) => e.currentTarget.select()}
                className="w-full bg-[#070b18] border border-white/[0.10] rounded-md px-3 py-2 text-[10px] font-mono text-gray-300 focus:border-[#22C55E]/40 focus:outline-none resize-y"
              />
              <div className="flex gap-2">
                <button type="button" onClick={handleManualCopyAndOpen} className="flex-1 py-2.5 rounded-lg font-bold text-xs uppercase tracking-[0.14em] bg-gradient-to-r from-[#22C55E] to-[#15924A] text-[#08160e]">
                  Copy + open Claude.ai
                </button>
                <button type="button" onClick={reset} className="px-3 py-2.5 rounded-lg text-xs uppercase tracking-[0.14em] text-gray-400 hover:text-gray-200 border border-white/10">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {mode === 'manual' && status.kind === 'awaiting_paste' && (
            <div className="flex flex-col gap-2 rounded-xl border border-[#22C55E]/40 bg-[#0c1d14] p-3">
              <div className="text-[11px] text-[#22C55E] leading-relaxed">
                ✓ Prompt copied. Send it in Claude.ai, then paste the JSON reply below.
              </div>
              <textarea
                value={manualResponse}
                onChange={(e) => setManualResponse(e.target.value)}
                rows={5}
                placeholder='Paste the JSON object Claude.ai returned here…'
                spellCheck={false}
                className="w-full bg-[#070b18] border border-white/[0.10] rounded-md px-3 py-2 text-xs font-mono text-gray-200 placeholder:text-gray-700 focus:border-[#22C55E]/40 focus:outline-none resize-y"
              />
              <div className="flex gap-2">
                <button type="button" onClick={handleManualApply} disabled={busy || !manualResponse.trim()} className="flex-1 py-2.5 rounded-lg font-bold text-xs uppercase tracking-[0.14em] bg-gradient-to-r from-[#22C55E] to-[#15924A] text-[#08160e] disabled:opacity-50 disabled:cursor-not-allowed">
                  {busy ? 'Saving…' : 'Apply + add'}
                </button>
                <button type="button" onClick={reset} disabled={busy} className="px-3 py-2.5 rounded-lg text-xs uppercase tracking-[0.14em] text-gray-400 hover:text-gray-200 border border-white/10">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {mode === 'api' && keyMissing && status.kind !== 'ok' && (
            <div className="text-[11px] text-amber-300/90 leading-relaxed">
              API mode reads the slide photos with vision — needs an Anthropic key in <strong>Settings</strong>. No key? Use Manual.
            </div>
          )}

          <div className="min-h-[16px] text-[11px] leading-relaxed">
            {status.kind === 'ok' && (
              <div className="text-[#22C55E]">✓ Added @{status.author}'s post. Enter its numbers below to score it.</div>
            )}
            {status.kind === 'err' && <div className="text-red-400 whitespace-pre-wrap">{status.msg}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
