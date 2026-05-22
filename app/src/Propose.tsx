// "Propose new post" sidebar panel — Phase 3 of the article's
// workflow. Reads the user's pattern library (every past post that
// carries a CloneAnalysis) + the last 14 days of published posts and
// asks Claude to synthesise a fresh angle that uses a proven pattern
// without repeating recent ones.
//
// Two modes (mirrors CloneFromTikTok):
//   - API: one tap, BYOK Anthropic key
//   - Manual: build prompt → claude.ai → paste back

import { useEffect, useMemo, useState } from 'react';
import {
  applyProposeManualResponse,
  buildManualProposePrompt,
  proposePost,
  renderOrderKeys,
  type ClaudeProposeOutput,
  type PatternSnapshot,
  type ProposeInput,
  type ProposeStage,
  type RecentPostSnapshot,
} from './tiktokClone';
import { listPosts, type Post } from './posts';
import { CLAUDE_MODELS, type ClaudeModelId } from './anthropic';
import { PRESET_KEYS, PRESETS, type PresetKey } from './presets';

type Props = {
  anthropicKey: string;
  model: ClaudeModelId;
  onModelChange: (m: ClaudeModelId) => void;
  // Fires when a proposal is accepted by the user. Parent populates
  // jsonText, preset, caption, lastCloneAnalysis. The bgByKey is
  // empty (propose doesn't have source images) — user assigns
  // backgrounds afterward.
  onProposed: (input: {
    preset: PresetKey;
    jsonText: string;
    caption: string;
    cloneAnalysis: ClaudeProposeOutput['cloneAnalysis'];
    imageQueries: string[];
    rationale: string;
  }) => void;
};

type Mode = 'api' | 'manual';

type RunStatus =
  | { kind: 'idle' }
  | { kind: 'running'; stage: ProposeStage }
  | { kind: 'awaiting_paste'; input: ProposeInput }
  | { kind: 'preview'; proposal: ClaudeProposeOutput }
  | { kind: 'err'; msg: string };

// 14-day anti-repeat window, 30-day niche-rotation window — defaults
// pulled from the article.
const RECENT_DAYS = 14;

export default function Propose({ anthropicKey, model, onModelChange, onProposed }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<Mode>('api');
  const [guidance, setGuidance] = useState('');
  const [preferredPreset, setPreferredPreset] = useState<PresetKey | 'auto'>('auto');
  const [status, setStatus] = useState<RunStatus>({ kind: 'idle' });
  const [manualResponse, setManualResponse] = useState('');
  const [posts, setPosts] = useState<Post[]>([]);

  useEffect(() => {
    if (!expanded) return;
    void listPosts().then(setPosts);
  }, [expanded]);

  const proposeInput = useMemo<ProposeInput>(() => {
    const patterns: PatternSnapshot[] = posts
      .filter((p) => p.cloneAnalysis)
      .map((p) => ({
        id: p.id,
        postedAt: p.postedAt,
        preset: p.preset || 'unknown',
        niche: p.niche,
        cloneAnalysis: p.cloneAnalysis!,
        captionExcerpt: p.caption.slice(0, 200),
      }));
    const cutoff = Date.now() - RECENT_DAYS * 86400000;
    const recentPostings: RecentPostSnapshot[] = posts
      .filter((p) => p.postedAt >= cutoff)
      .map((p) => ({
        daysAgo: Math.max(0, Math.floor((Date.now() - p.postedAt) / 86400000)),
        niche: p.niche,
        preset: p.preset || 'unknown',
        hookStyle: p.cloneAnalysis?.hookStyle || '',
        captionExcerpt: p.caption.slice(0, 200),
      }));
    return { patterns, recentPostings };
  }, [posts]);

  const busy = status.kind === 'running';
  const keyMissing = !anthropicKey;
  const awaitingPaste = status.kind === 'awaiting_paste';
  const inPreview = status.kind === 'preview';

  async function handleApiPropose() {
    if (keyMissing) {
      setStatus({ kind: 'err', msg: 'Add an Anthropic API key in Settings, or switch to Manual mode.' });
      return;
    }
    setStatus({ kind: 'running', stage: { kind: 'reasoning' } });
    try {
      const proposal = await proposePost({
        apiKey: anthropicKey,
        model,
        input: proposeInput,
        guidance: guidance.trim() || undefined,
        preferredPreset: preferredPreset === 'auto' ? undefined : preferredPreset,
        onStage: (stage) => setStatus({ kind: 'running', stage }),
      });
      setStatus({ kind: 'preview', proposal });
    } catch (e) {
      setStatus({ kind: 'err', msg: (e as Error).message || 'Propose failed.' });
    }
  }

  async function handleManualBuild() {
    const prompt = buildManualProposePrompt(proposeInput, {
      guidance: guidance.trim() || undefined,
      preferredPreset: preferredPreset === 'auto' ? undefined : preferredPreset,
    });
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = prompt;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } finally { document.body.removeChild(ta); }
    }
    setStatus({ kind: 'awaiting_paste', input: proposeInput });
    window.open('https://claude.ai/new', '_blank', 'noopener,noreferrer');
  }

  function handleManualApply() {
    if (status.kind !== 'awaiting_paste') return;
    try {
      const proposal = applyProposeManualResponse(manualResponse);
      setManualResponse('');
      setStatus({ kind: 'preview', proposal });
    } catch (e) {
      setStatus({ kind: 'err', msg: (e as Error).message || 'Could not parse Claude.ai response.' });
    }
  }

  function handleAcceptProposal() {
    if (status.kind !== 'preview') return;
    const p = status.proposal;
    onProposed({
      preset: p.preset,
      jsonText: JSON.stringify(p.slides, null, 2),
      caption: p.caption,
      cloneAnalysis: p.cloneAnalysis,
      imageQueries: p.imageQueries,
      rationale: p.rationale,
    });
    setStatus({ kind: 'idle' });
  }

  function handleRejectProposal() {
    setStatus({ kind: 'idle' });
  }

  const modeBtn = (m: Mode, label: string, sub: string) => {
    const active = mode === m;
    return (
      <button
        type="button"
        onClick={() => {
          setMode(m);
          if (status.kind === 'awaiting_paste' || status.kind === 'err') setStatus({ kind: 'idle' });
        }}
        className={
          'flex-1 px-3 py-2 rounded-md text-left transition-colors ' +
          (active
            ? 'bg-[#FFC857]/15 text-[#FFC857]'
            : 'bg-white/[0.03] text-gray-400 hover:bg-white/[0.06] hover:text-gray-200')
        }
      >
        <div className="text-[11px] font-bold uppercase tracking-[0.14em]">{label}</div>
        <div className="text-[10px] normal-case tracking-normal mt-0.5 text-gray-500">{sub}</div>
      </button>
    );
  };

  const patternCount = proposeInput.patterns.length;
  const recentCount = proposeInput.recentPostings.length;

  return (
    <div className="rounded-2xl border border-[#FFC857]/25 bg-gradient-to-br from-[#2a2010] to-[#161208] p-4 md:p-5">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-[#FFC857]/15 text-[#FFC857] text-base">
            ✦
          </span>
          <div>
            <div className="text-[13px] font-bold uppercase tracking-[0.18em] text-[#FFC857]">
              Propose new post
            </div>
            <div className="text-[11px] text-gray-500 mt-0.5">
              No URL needed · synthesizes from your pattern library
            </div>
          </div>
        </div>
        <span className="text-gray-500 text-xs">{expanded ? '▾' : '▸'}</span>
      </button>

      {expanded && (
        <div className="mt-4 flex flex-col gap-3">
          <div className="flex gap-2 p-1 rounded-lg bg-black/30 border border-white/[0.05]">
            {modeBtn('api', 'API mode', 'One tap · ~$0.005–0.30')}
            {modeBtn('manual', 'Manual', 'Free · via claude.ai tab')}
          </div>

          <div className="text-[11px] text-gray-500 leading-relaxed">
            Library: <strong className="text-gray-300">{patternCount}</strong> pattern{patternCount === 1 ? '' : 's'} ·
            Last {RECENT_DAYS}d: <strong className="text-gray-300">{recentCount}</strong> post{recentCount === 1 ? '' : 's'}
            {patternCount === 0 && (
              <span className="block mt-1 text-amber-300/80">
                No patterns yet — clone a few posts first so propose has something to riff on.
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">
                {mode === 'manual' ? 'Model (FYI)' : 'Model'}
              </span>
              <select
                value={model}
                onChange={(e) => onModelChange(e.target.value as ClaudeModelId)}
                disabled={mode === 'manual'}
                className="bg-[#070b18] border border-white/[0.10] rounded-md px-2 py-2 text-xs text-gray-200 focus:border-[#FFC857]/40 focus:outline-none disabled:opacity-50"
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
                className="bg-[#070b18] border border-white/[0.10] rounded-md px-2 py-2 text-xs text-gray-200 focus:border-[#FFC857]/40 focus:outline-none"
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
              placeholder='e.g. "lean into the morning routine angle" or "use the bronze mascot"'
              className="bg-[#070b18] border border-white/[0.10] rounded-md px-3 py-2 text-xs text-gray-200 placeholder:text-gray-700 focus:border-[#FFC857]/40 focus:outline-none resize-y"
            />
          </label>

          {!awaitingPaste && !inPreview && (
            <button
              type="button"
              onClick={mode === 'api' ? handleApiPropose : handleManualBuild}
              disabled={busy}
              className="w-full py-3 rounded-xl font-bold text-sm tracking-wide
                         bg-gradient-to-r from-[#FFC857] to-[#E8A03C] text-[#1a120a]
                         shadow-[0_4px_20px_rgba(255,200,87,0.3)]
                         hover:shadow-[0_6px_28px_rgba(255,200,87,0.5)]
                         hover:-translate-y-0.5 active:translate-y-0
                         transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
            >
              {busy ? 'Proposing…' : mode === 'api' ? 'Propose a post' : 'Copy prompt + open Claude.ai'}
            </button>
          )}

          {mode === 'manual' && awaitingPaste && (
            <div className="flex flex-col gap-2 rounded-xl border border-[#FFC857]/40 bg-[#1a1408] p-3">
              <div className="text-[11px] text-[#FFC857] leading-relaxed">
                ✓ Prompt copied. Send it in the Claude.ai tab, then paste the JSON reply below.
              </div>
              <textarea
                value={manualResponse}
                onChange={(e) => setManualResponse(e.target.value)}
                rows={5}
                placeholder='Paste the entire JSON object Claude.ai returned here…'
                spellCheck={false}
                className="w-full bg-[#070b18] border border-white/[0.10] rounded-md px-3 py-2 text-xs font-mono text-gray-200 placeholder:text-gray-700 focus:border-[#FFC857]/40 focus:outline-none resize-y"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleManualApply}
                  disabled={!manualResponse.trim()}
                  className="flex-1 py-2.5 rounded-lg font-bold text-xs uppercase tracking-[0.14em]
                             bg-gradient-to-r from-[#FFC857] to-[#E8A03C] text-[#1a120a]
                             disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Apply response
                </button>
                <button
                  type="button"
                  onClick={() => { setManualResponse(''); setStatus({ kind: 'idle' }); }}
                  className="px-3 py-2.5 rounded-lg text-xs uppercase tracking-[0.14em] text-gray-400 hover:text-gray-200 border border-white/10"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {inPreview && status.kind === 'preview' && (
            <ProposalPreview
              proposal={status.proposal}
              onAccept={handleAcceptProposal}
              onReject={handleRejectProposal}
            />
          )}

          {mode === 'api' && keyMissing && !inPreview && (
            <div className="text-[11px] text-amber-300/90 leading-relaxed">
              Need an Anthropic key in <strong>Settings</strong> below — or flip to Manual mode.
            </div>
          )}

          {status.kind === 'err' && (
            <div className="text-[11px] text-red-400 leading-relaxed">{status.msg}</div>
          )}
        </div>
      )}
    </div>
  );
}

// Inline preview card so the user reviews Claude's proposal before
// it overwrites the editor. The article calls this "the human gate" —
// it's intentional friction so bad proposals don't pollute the library.
function ProposalPreview({
  proposal,
  onAccept,
  onReject,
}: {
  proposal: ClaudeProposeOutput;
  onAccept: () => void;
  onReject: () => void;
}) {
  const keys = useMemo(() => renderOrderKeys(proposal.slides), [proposal.slides]);
  return (
    <div className="rounded-xl border border-[#FFC857]/40 bg-[#1a1408] p-3 flex flex-col gap-2">
      <div className="text-[10px] uppercase tracking-[0.16em] text-[#FFC857] font-bold">
        Review proposal
      </div>
      <div className="text-[11px] text-gray-300 leading-relaxed">
        <strong className="text-white">Preset:</strong> {proposal.preset} ·{' '}
        <strong className="text-white">Niche:</strong> {proposal.cloneAnalysis.niche || '—'}
      </div>
      {proposal.rationale && (
        <div className="text-[11px] text-gray-400 italic leading-relaxed">"{proposal.rationale}"</div>
      )}
      <div className="text-[11px] text-gray-500 leading-relaxed">
        {keys.length} slide{keys.length === 1 ? '' : 's'} · {proposal.imageQueries.length} image
        prompt{proposal.imageQueries.length === 1 ? '' : 's'}
      </div>
      {proposal.imageQueries.length > 0 && (
        <details className="text-[10px] text-gray-500 leading-relaxed">
          <summary className="cursor-pointer text-gray-400 hover:text-[#FFC857]">
            Show image prompts (for Midjourney / Nano Banana / Pexels)
          </summary>
          <ol className="mt-2 list-decimal list-inside space-y-0.5 text-gray-400">
            {proposal.imageQueries.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ol>
        </details>
      )}
      <div className="flex gap-2 mt-1">
        <button
          type="button"
          onClick={onAccept}
          className="flex-1 py-2 rounded-lg font-bold text-xs uppercase tracking-[0.14em]
                     bg-gradient-to-r from-[#FFC857] to-[#E8A03C] text-[#1a120a]"
        >
          Use it — load into editor
        </button>
        <button
          type="button"
          onClick={onReject}
          className="px-3 py-2 rounded-lg text-xs uppercase tracking-[0.14em] text-gray-400 hover:text-gray-200 border border-white/10"
        >
          Discard
        </button>
      </div>
    </div>
  );
}
