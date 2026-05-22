// "Clone from TikTok" sidebar panel. The user pastes a TikTok URL and
// (optionally) tweaks the model / preset / extra guidance, then hits
// Clone. We run the full pipeline (scrape → Claude → image download)
// and call onCloned with the result so App.tsx can populate the JSON
// textarea, preset selector, slideBgs map, and caption in one shot.

import { useState } from 'react';
import {
  cloneFromTikTok,
  renderOrderKeys,
  type CloneResult,
  type CloneStage,
} from './tiktokClone';
import { CLAUDE_MODELS, type ClaudeModelId } from './anthropic';
import { PRESET_KEYS, PRESETS, type PresetKey } from './presets';

type Props = {
  anthropicKey: string;
  model: ClaudeModelId;
  onModelChange: (m: ClaudeModelId) => void;
  // Called when the clone finishes. The parent uses this to overwrite
  // the JSON textarea, switch preset, fill caption, and assign per-
  // slide bg media items.
  onCloned: (input: {
    preset: PresetKey;
    jsonText: string;
    caption: string;
    // Map of slide-key → media-bank item id, ready to merge into the
    // existing slideBgs state.
    bgByKey: Record<string, string>;
    source: CloneResult['source'];
    cloneAnalysis: CloneResult['clone']['cloneAnalysis'];
  }) => void;
};

type RunStatus =
  | { kind: 'idle' }
  | { kind: 'running'; stage: CloneStage }
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

export default function CloneFromTikTok({ anthropicKey, model, onModelChange, onCloned }: Props) {
  const [url, setUrl] = useState('');
  const [guidance, setGuidance] = useState('');
  // 'auto' means let Claude pick the preset based on the source post's shape.
  const [preferredPreset, setPreferredPreset] = useState<PresetKey | 'auto'>('auto');
  const [status, setStatus] = useState<RunStatus>({ kind: 'idle' });
  const [expanded, setExpanded] = useState(false);

  const busy = status.kind === 'running';
  const keyMissing = !anthropicKey;

  async function handleClone() {
    if (!url.trim()) return;
    if (keyMissing) {
      setStatus({ kind: 'err', msg: 'Add an Anthropic API key in Settings first.' });
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

      // Walk the rendered slides in render order and map each one to
      // a source image (if Claude returned a bgAssignment for it).
      const keys = renderOrderKeys(result.clone.slides);
      const bgByKey: Record<string, string> = {};
      result.clone.bgAssignments.forEach((srcIndex, i) => {
        if (typeof srcIndex !== 'number') return;
        const slideKey = keys[i]?.key;
        if (!slideKey) return;
        const mediaItem = result.mediaItems[srcIndex];
        if (mediaItem) bgByKey[slideKey] = mediaItem.id;
      });

      onCloned({
        preset: result.clone.preset,
        jsonText: JSON.stringify(result.clone.slides, null, 2),
        caption: result.clone.caption,
        bgByKey,
        source: result.source,
        cloneAnalysis: result.clone.cloneAnalysis,
      });

      setStatus({ kind: 'ok', at: Date.now() });
      setTimeout(() => setStatus((s) => (s.kind === 'ok' ? { kind: 'idle' } : s)), 6000);
    } catch (e) {
      setStatus({ kind: 'err', msg: (e as Error).message || 'Clone failed.' });
    }
  }

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
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !busy) handleClone();
            }}
            placeholder="https://www.tiktok.com/@user/photo/1234… or vm.tiktok.com/abc"
            spellCheck={false}
            className="w-full bg-[#070b18] border border-white/[0.10] rounded-lg px-3 py-2.5 text-sm text-gray-200 placeholder:text-gray-700 focus:border-[#00E5FF]/50 focus:outline-none"
          />

          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">Model</span>
              <select
                value={model}
                onChange={(e) => onModelChange(e.target.value as ClaudeModelId)}
                className="bg-[#070b18] border border-white/[0.10] rounded-md px-2 py-2 text-xs text-gray-200 focus:border-[#00E5FF]/40 focus:outline-none"
              >
                {CLAUDE_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
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
                  <option key={k} value={k}>
                    {PRESETS[k].label}
                  </option>
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

          <button
            type="button"
            onClick={handleClone}
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

          {keyMissing && (
            <div className="text-[11px] text-amber-300/90 leading-relaxed">
              You need an Anthropic API key (under <strong>Settings</strong> below) to run this.
              BYOK · pay-per-token.
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
                Works on photo slideshows + video posts. Source images become slide backgrounds; the Iro mascot + text overlays on top.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
