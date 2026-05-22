// "Clone from TikTok" sidebar panel. Two modes:
//
//   - API: scrape → Claude API (BYOK) → populate JSON + bg map. One tap.
//   - Manual: scrape → copy a self-contained prompt to clipboard →
//             user pastes into claude.ai in another tab → user pastes
//             the reply back into a textarea here → we parse +
//             populate. No Anthropic API key required, uses the user's
//             existing Claude.ai subscription.
//
// Both modes use the same /api/scrape-tiktok endpoint to pull source
// metadata and the same /api/proxy-tiktok-image endpoint to download
// images into the media bank. Only the LLM call differs.

import { useState } from 'react';
import {
  applyManualResponse,
  cloneFromTikTok,
  prepareManualClone,
  renderOrderKeys,
  type CloneResult,
  type CloneStage,
  type ScrapeResult,
} from './tiktokClone';
import { CLAUDE_MODELS, type ClaudeModelId } from './anthropic';
import { PRESET_KEYS, PRESETS, type PresetKey } from './presets';

type Props = {
  anthropicKey: string;
  model: ClaudeModelId;
  onModelChange: (m: ClaudeModelId) => void;
  onCloned: (input: {
    preset: PresetKey;
    jsonText: string;
    caption: string;
    bgByKey: Record<string, string>;
    source: CloneResult['source'];
    cloneAnalysis: CloneResult['clone']['cloneAnalysis'];
  }) => void;
};

type Mode = 'api' | 'manual';

type RunStatus =
  | { kind: 'idle' }
  | { kind: 'running'; stage: CloneStage }
  // Manual mode parked between "copy prompt" and "paste response".
  // We hold the scrape result here so the apply step knows which
  // images to download.
  | { kind: 'awaiting_paste'; source: ScrapeResult }
  | { kind: 'err'; msg: string }
  | { kind: 'ok'; at: number };

function stageLabel(stage: CloneStage): string {
  switch (stage.kind) {
    case 'scraping':
      return 'Pulling TikTok page…';
    case 'scraped':
      return `Got source post (${stage.source.slides.length} slide${stage.source.slides.length === 1 ? '' : 's'}). Reading structure…`;
    case 'reasoning':
      return 'Claude is cloning the post for Iro…';
    case 'analyzed':
      return `Clone written (${stage.clone.preset}). Downloading source images…`;
    case 'fetching_images':
      return `Downloading source images (${stage.done}/${stage.total})…`;
    case 'done':
      return 'Done.';
  }
}

// Pulls slide-key → media-id assignments out of a CloneResult so the
// parent can merge them into its slideBgs state. Shared by both modes.
function buildBgByKey(result: CloneResult): Record<string, string> {
  const keys = renderOrderKeys(result.clone.slides);
  const bgByKey: Record<string, string> = {};
  result.clone.bgAssignments.forEach((srcIndex, i) => {
    if (typeof srcIndex !== 'number') return;
    const slideKey = keys[i]?.key;
    if (!slideKey) return;
    const mediaItem = result.mediaItems[srcIndex];
    if (mediaItem) bgByKey[slideKey] = mediaItem.id;
  });
  return bgByKey;
}

export default function CloneFromTikTok({ anthropicKey, model, onModelChange, onCloned }: Props) {
  const [mode, setMode] = useState<Mode>('api');
  const [url, setUrl] = useState('');
  const [guidance, setGuidance] = useState('');
  const [preferredPreset, setPreferredPreset] = useState<PresetKey | 'auto'>('auto');
  const [status, setStatus] = useState<RunStatus>({ kind: 'idle' });
  const [expanded, setExpanded] = useState(false);
  // Manual mode: paste-back of Claude.ai's reply.
  const [manualResponse, setManualResponse] = useState('');

  const busy = status.kind === 'running';
  const keyMissing = !anthropicKey;
  const awaitingPaste = status.kind === 'awaiting_paste';

  function finishWithResult(result: CloneResult) {
    onCloned({
      preset: result.clone.preset,
      jsonText: JSON.stringify(result.clone.slides, null, 2),
      caption: result.clone.caption,
      bgByKey: buildBgByKey(result),
      source: result.source,
      cloneAnalysis: result.clone.cloneAnalysis,
    });
    setStatus({ kind: 'ok', at: Date.now() });
    setTimeout(() => setStatus((s) => (s.kind === 'ok' ? { kind: 'idle' } : s)), 6000);
  }

  async function handleApiClone() {
    if (!url.trim()) return;
    if (keyMissing) {
      setStatus({ kind: 'err', msg: 'Add an Anthropic API key in Settings, or switch to Manual mode.' });
      return;
    }
    setStatus({ kind: 'running', stage: { kind: 'scraping' } });
    try {
      const result = await cloneFromTikTok({
        apiKey: anthropicKey,
        model,
        url: url.trim(),
        guidance: guidance.trim() || undefined,
        preferredPreset: preferredPreset === 'auto' ? undefined : preferredPreset,
        onStage: (stage) => setStatus({ kind: 'running', stage }),
      });
      finishWithResult(result);
    } catch (e) {
      setStatus({ kind: 'err', msg: (e as Error).message || 'Clone failed.' });
    }
  }

  // Manual mode step 1: scrape, build the prompt, copy to clipboard,
  // open claude.ai in a new tab. Parks status at awaiting_paste so
  // step 2 ("Apply response") can light up.
  async function handleManualBuildPrompt() {
    if (!url.trim()) return;
    setStatus({ kind: 'running', stage: { kind: 'scraping' } });
    try {
      const { source, prompt } = await prepareManualClone({
        url: url.trim(),
        guidance: guidance.trim() || undefined,
        preferredPreset: preferredPreset === 'auto' ? undefined : preferredPreset,
      });

      // navigator.clipboard.writeText needs a user gesture, which we
      // have (the button click). It still occasionally fails on
      // iOS Safari; if so we fall back to a hidden textarea + execCommand.
      try {
        await navigator.clipboard.writeText(prompt);
      } catch {
        const ta = document.createElement('textarea');
        ta.value = prompt;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand('copy');
        } finally {
          document.body.removeChild(ta);
        }
      }

      // Stash the source so step 2 knows what images to download.
      setStatus({ kind: 'awaiting_paste', source });
      // Open claude.ai in a new tab so the user can paste right away.
      window.open('https://claude.ai/new', '_blank', 'noopener,noreferrer');
    } catch (e) {
      setStatus({ kind: 'err', msg: (e as Error).message || 'Could not prepare manual prompt.' });
    }
  }

  // Manual mode step 2: parse the paste-back, fetch source images,
  // populate the JSON / caption / bgs via onCloned.
  async function handleManualApply() {
    if (status.kind !== 'awaiting_paste') return;
    if (!manualResponse.trim()) return;
    const source = status.source;
    setStatus({ kind: 'running', stage: { kind: 'fetching_images', done: 0, total: source.slides.length } });
    try {
      const result = await applyManualResponse(manualResponse, source, (stage) =>
        setStatus({ kind: 'running', stage }),
      );
      setManualResponse('');
      finishWithResult(result);
    } catch (e) {
      // Keep awaiting_paste so the user can fix the paste and retry
      // without re-running the scrape.
      setStatus({ kind: 'err', msg: (e as Error).message || 'Could not apply response.' });
    }
  }

  function handleResetManual() {
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
          // Clear in-flight state when switching modes so the user
          // doesn't end up in an awaiting_paste state for the wrong mode.
          if (status.kind === 'awaiting_paste' || status.kind === 'err') setStatus({ kind: 'idle' });
        }}
        className={
          'flex-1 px-3 py-2 rounded-md text-left transition-colors ' +
          (active
            ? 'bg-[#00E5FF]/15 text-[#00E5FF]'
            : 'bg-white/[0.03] text-gray-400 hover:bg-white/[0.06] hover:text-gray-200')
        }
      >
        <div className="text-[11px] font-bold uppercase tracking-[0.14em]">{label}</div>
        <div className="text-[10px] normal-case tracking-normal mt-0.5 text-gray-500">{sub}</div>
      </button>
    );
  };

  return (
    <div className="rounded-2xl border border-[#00E5FF]/25 bg-gradient-to-br from-[#0e2030] to-[#0a1424] p-4 md:p-5">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-[#00E5FF]/15 text-[#00E5FF] text-base">
            ↻
          </span>
          <div>
            <div className="text-[13px] font-bold uppercase tracking-[0.18em] text-[#00E5FF]">
              Clone from TikTok
            </div>
            <div className="text-[11px] text-gray-500 mt-0.5">
              Paste a URL · Iro-tailored copy · source photos as backgrounds
            </div>
          </div>
        </div>
        <span className="text-gray-500 text-xs">{expanded ? '▾' : '▸'}</span>
      </button>

      {expanded && (
        <div className="mt-4 flex flex-col gap-3">
          <div className="flex gap-2 p-1 rounded-lg bg-black/30 border border-white/[0.05]">
            {modeBtn('api', 'API mode', 'One tap · ~$0.005–0.30 / clone')}
            {modeBtn('manual', 'Manual', 'Free · via your claude.ai tab')}
          </div>

          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !busy) {
                if (mode === 'api') void handleApiClone();
                else if (!awaitingPaste) void handleManualBuildPrompt();
              }
            }}
            placeholder="https://www.tiktok.com/@user/photo/1234… or vm.tiktok.com/abc"
            spellCheck={false}
            className="w-full bg-[#070b18] border border-white/[0.10] rounded-lg px-3 py-2.5 text-sm text-gray-200 placeholder:text-gray-700 focus:border-[#00E5FF]/50 focus:outline-none"
          />

          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">
                {mode === 'manual' ? 'Model (FYI only)' : 'Model'}
              </span>
              <select
                value={model}
                onChange={(e) => onModelChange(e.target.value as ClaudeModelId)}
                disabled={mode === 'manual'}
                title={mode === 'manual' ? 'Manual mode uses whatever model your claude.ai tab is on.' : undefined}
                className="bg-[#070b18] border border-white/[0.10] rounded-md px-2 py-2 text-xs text-gray-200 focus:border-[#00E5FF]/40 focus:outline-none disabled:opacity-50"
              >
                {CLAUDE_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">Preset</span>
              <select
                value={preferredPreset}
                onChange={(e) => setPreferredPreset(e.target.value as PresetKey | 'auto')}
                className="bg-[#070b18] border border-white/[0.10] rounded-md px-2 py-2 text-xs text-gray-200 focus:border-[#00E5FF]/40 focus:outline-none"
              >
                <option value="auto">Auto (Claude picks)</option>
                {PRESET_KEYS.map((k) => (
                  <option key={k} value={k}>{PRESETS[k].label}</option>
                ))}
              </select>
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">
              Extra guidance (optional)
            </span>
            <textarea
              value={guidance}
              onChange={(e) => setGuidance(e.target.value)}
              rows={2}
              placeholder='e.g. "use the gold mascot" or "make it about productivity for designers"'
              className="bg-[#070b18] border border-white/[0.10] rounded-md px-3 py-2 text-xs text-gray-200 placeholder:text-gray-700 focus:border-[#00E5FF]/40 focus:outline-none resize-y"
            />
          </label>

          {mode === 'api' && (
            <button
              type="button"
              onClick={handleApiClone}
              disabled={busy || !url.trim()}
              className="w-full py-3 rounded-xl font-bold text-sm tracking-wide
                         bg-gradient-to-r from-[#00E5FF] to-[#00A5D9] text-[#0a0e1a]
                         shadow-[0_4px_20px_rgba(0,229,255,0.35)]
                         hover:shadow-[0_6px_28px_rgba(0,229,255,0.55)]
                         hover:-translate-y-0.5 active:translate-y-0
                         transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
            >
              {busy ? 'Cloning…' : 'Clone for Iro'}
            </button>
          )}

          {mode === 'manual' && !awaitingPaste && (
            <button
              type="button"
              onClick={handleManualBuildPrompt}
              disabled={busy || !url.trim()}
              className="w-full py-3 rounded-xl font-bold text-sm tracking-wide
                         bg-gradient-to-r from-[#00E5FF] to-[#00A5D9] text-[#0a0e1a]
                         shadow-[0_4px_20px_rgba(0,229,255,0.35)]
                         hover:shadow-[0_6px_28px_rgba(0,229,255,0.55)]
                         hover:-translate-y-0.5 active:translate-y-0
                         transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
            >
              {busy ? 'Scraping…' : 'Copy prompt + open Claude.ai'}
            </button>
          )}

          {mode === 'manual' && awaitingPaste && (
            <div className="flex flex-col gap-2 rounded-xl border border-[#00E5FF]/40 bg-[#0a1828] p-3">
              <div className="text-[11px] text-[#00E5FF] leading-relaxed">
                ✓ Prompt copied. Paste into the Claude.ai tab, send it, then paste Claude's
                JSON reply below.
              </div>
              <textarea
                value={manualResponse}
                onChange={(e) => setManualResponse(e.target.value)}
                rows={5}
                placeholder='Paste the entire JSON object Claude.ai returned here…'
                spellCheck={false}
                className="w-full bg-[#070b18] border border-white/[0.10] rounded-md px-3 py-2 text-xs font-mono text-gray-200 placeholder:text-gray-700 focus:border-[#00E5FF]/40 focus:outline-none resize-y"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleManualApply}
                  disabled={busy || !manualResponse.trim()}
                  className="flex-1 py-2.5 rounded-lg font-bold text-xs uppercase tracking-[0.14em]
                             bg-gradient-to-r from-[#00E5FF] to-[#00A5D9] text-[#0a0e1a]
                             disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {busy ? 'Applying…' : 'Apply response'}
                </button>
                <button
                  type="button"
                  onClick={handleResetManual}
                  disabled={busy}
                  className="px-3 py-2.5 rounded-lg text-xs uppercase tracking-[0.14em] text-gray-400 hover:text-gray-200 border border-white/10"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {mode === 'api' && keyMissing && (
            <div className="text-[11px] text-amber-300/90 leading-relaxed">
              You need an Anthropic API key (under <strong>Settings</strong> below) to run this in API mode.
              No key? Flip to <strong>Manual</strong> at the top and use your claude.ai tab instead.
            </div>
          )}

          <div className="min-h-[16px] text-[11px] leading-relaxed">
            {status.kind === 'running' && (
              <div className="flex items-center gap-2 text-[#00E5FF]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#00E5FF] animate-pulse shadow-[0_0_8px_rgba(0,229,255,0.8)]" />
                {stageLabel(status.stage)}
              </div>
            )}
            {status.kind === 'ok' && (
              <div className="text-[#22C55E]">✓ Cloned. JSON, caption, and backgrounds populated.</div>
            )}
            {status.kind === 'err' && (
              <div className="text-red-400">{status.msg}</div>
            )}
            {status.kind === 'idle' && (
              <div className="text-gray-600">
                {mode === 'api'
                  ? 'Works on photo slideshows + video posts. Source images become slide backgrounds; the Iro mascot + text overlays on top.'
                  : 'Free path — uses your existing claude.ai subscription. ~30s slower per clone vs API mode (copy-paste round-trip).'}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
