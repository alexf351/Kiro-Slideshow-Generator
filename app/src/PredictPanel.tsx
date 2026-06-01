// "Score this draft" sidebar panel — the pre-publish half of the
// prediction loop. Reads the current editor draft + the user's scored
// history and asks Claude to forecast a 0-100 performance score plus
// concrete edits to lift it. Mirrors the Clone/Propose panels: one-tap
// API mode (BYOK) and a free manual claude.ai copy-paste path.
//
// When a prediction lands, the user can "attach" it — the parent stashes
// it so the next "Save to history" persists the prediction alongside the
// post. Later, once the real TikTok numbers are entered, Analytics shows
// predicted-vs-actual so the engine's calibration is visible.

import { useEffect, useMemo, useState } from 'react';
import {
  applyPredictManualResponse,
  buildManualPredictPrompt,
  predictDraft,
  type LabeledExample,
  type PredictionResult,
} from './predict';
import { hasStats, scorePost } from './scoring';
import { listPosts, type Post, type PostPrediction } from './posts';
import { CLAUDE_MODELS, type ClaudeModelId } from './anthropic';
import { type PresetKey } from './presets';

type Props = {
  anthropicKey: string;
  model: ClaudeModelId;
  onModelChange: (m: ClaudeModelId) => void;
  // Live draft from the editor.
  preset: PresetKey;
  jsonText: string;
  caption: string;
  // Fires when the user attaches a prediction to the next save. Parent
  // persists it in handleSaveToHistory. Pass null to detach.
  onPrediction: (prediction: PostPrediction | null) => void;
  // The currently-attached prediction's score (or null), so the panel can
  // reflect parent state after a save clears it.
  attachedScore: number | null;
};

type Mode = 'api' | 'manual';

type RunStatus =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'prompt_ready'; prompt: string }
  | { kind: 'awaiting_paste' }
  | { kind: 'result'; result: PredictionResult }
  | { kind: 'err'; msg: string };

const ACCENT = '#A78BFA'; // violet — distinct from clone (cyan) / propose (gold)

function confColor(c: PredictionResult['confidence']): string {
  return c === 'high' ? '#22C55E' : c === 'low' ? '#F59E0B' : ACCENT;
}

export default function PredictPanel({
  anthropicKey,
  model,
  onModelChange,
  preset,
  jsonText,
  caption,
  onPrediction,
  attachedScore,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<Mode>('api');
  const [guidance, setGuidance] = useState('');
  const [status, setStatus] = useState<RunStatus>({ kind: 'idle' });
  const [manualResponse, setManualResponse] = useState('');
  const [posts, setPosts] = useState<Post[]>([]);

  useEffect(() => {
    if (!expanded) return;
    void listPosts().then(setPosts);
  }, [expanded]);

  // Build labeled training examples from every scored post in history.
  const examples = useMemo<LabeledExample[]>(() => {
    const scored = posts.filter(hasStats);
    return scored.map((p) => {
      const b = scorePost(p, posts);
      return {
        score: b.score,
        label: b.label,
        preset: p.preset || 'unknown',
        niche: (p.niche || '').trim(),
        hookStyle: p.selfAnalysis?.hookStyle || p.cloneAnalysis?.hookStyle || '',
        voiceTone: p.selfAnalysis?.voiceTone || p.cloneAnalysis?.voiceTone || '',
        density: p.cloneAnalysis?.density || '',
        captionExcerpt: p.caption.slice(0, 160),
        views: p.stats.views || 0,
        saveRate: b.saveRate,
        shareRate: b.shareRate,
      };
    });
  }, [posts]);

  const busy = status.kind === 'running';
  const keyMissing = !anthropicKey;

  function toPrediction(result: PredictionResult, source: PostPrediction['source']): PostPrediction {
    return {
      score: result.predictedScore,
      confidence: result.confidence,
      rationale: result.rationale,
      strengths: result.strengths,
      risks: result.risks,
      suggestions: result.suggestions,
      predictedAt: Date.now(),
      source,
      model: source === 'api' ? model : undefined,
    };
  }

  const draft = useMemo(() => ({ preset, slidesJson: jsonText, caption }), [preset, jsonText, caption]);

  async function handleApiPredict() {
    if (keyMissing) {
      setStatus({ kind: 'err', msg: 'Add an Anthropic API key in Settings, or switch to Manual mode.' });
      return;
    }
    setStatus({ kind: 'running' });
    try {
      const result = await predictDraft({ apiKey: anthropicKey, model, draft, examples, guidance: guidance.trim() || undefined });
      setStatus({ kind: 'result', result });
    } catch (e) {
      setStatus({ kind: 'err', msg: (e as Error).message || 'Prediction failed.' });
    }
  }

  function handleManualBuild() {
    const prompt = buildManualPredictPrompt({ draft, examples, guidance: guidance.trim() || undefined });
    setStatus({ kind: 'prompt_ready', prompt });
  }

  function handleManualCopyAndOpen() {
    if (status.kind !== 'prompt_ready') return;
    const prompt = status.prompt;
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
    setStatus({ kind: 'awaiting_paste' });
  }

  function handleManualApply() {
    if (status.kind !== 'awaiting_paste') return;
    try {
      const result = applyPredictManualResponse(manualResponse);
      setManualResponse('');
      setStatus({ kind: 'result', result });
    } catch (e) {
      setStatus({ kind: 'err', msg: (e as Error).message || 'Could not parse the reply.' });
    }
  }

  function handleAttach() {
    if (status.kind !== 'result') return;
    onPrediction(toPrediction(status.result, mode === 'api' ? 'api' : 'manual'));
  }

  const modeBtn = (m: Mode, label: string, sub: string) => {
    const active = mode === m;
    return (
      <button
        type="button"
        onClick={() => {
          setMode(m);
          if (status.kind === 'awaiting_paste' || status.kind === 'prompt_ready' || status.kind === 'err') {
            setStatus({ kind: 'idle' });
          }
        }}
        className={
          'flex-1 px-3 py-2 rounded-md text-left transition-colors ' +
          (active ? 'bg-[#A78BFA]/15 text-[#A78BFA]' : 'bg-white/[0.03] text-gray-400 hover:bg-white/[0.06] hover:text-gray-200')
        }
      >
        <div className="text-[11px] font-bold uppercase tracking-[0.14em]">{label}</div>
        <div className="text-[10px] normal-case tracking-normal mt-0.5 text-gray-500">{sub}</div>
      </button>
    );
  };

  return (
    <div className="rounded-2xl border border-[#A78BFA]/25 bg-gradient-to-br from-[#1d1633] to-[#100b1f] p-4 md:p-5">
      <button type="button" onClick={() => setExpanded((v) => !v)} className="w-full flex items-center justify-between text-left">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-[#A78BFA]/15 text-[#A78BFA] text-base">
            ⌁
          </span>
          <div>
            <div className="text-[13px] font-bold uppercase tracking-[0.18em] text-[#A78BFA]">Score this draft</div>
            <div className="text-[11px] text-gray-500 mt-0.5">
              Predict performance before you post · learns from your history
            </div>
          </div>
        </div>
        <span className="text-gray-500 text-xs">{expanded ? '▾' : '▸'}</span>
      </button>

      {expanded && (
        <div className="mt-4 flex flex-col gap-3">
          <div className="flex gap-2 p-1 rounded-lg bg-black/30 border border-white/[0.05]">
            {modeBtn('api', 'API mode', 'One tap · ~$0.002–0.05')}
            {modeBtn('manual', 'Manual', 'Free · via claude.ai tab')}
          </div>

          <div className="text-[11px] text-gray-500 leading-relaxed">
            Trained on <strong className="text-gray-300">{examples.length}</strong> scored post
            {examples.length === 1 ? '' : 's'} from your history.
            {examples.length === 0 && (
              <span className="block mt-1 text-amber-300/80">
                No scored posts yet — predictions will be low-confidence until you import + score a few posts in Stats.
              </span>
            )}
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">Model</span>
            <select
              value={model}
              onChange={(e) => onModelChange(e.target.value as ClaudeModelId)}
              disabled={mode === 'manual'}
              className="bg-[#070b18] border border-white/[0.10] rounded-md px-2 py-2 text-xs text-gray-200 focus:border-[#A78BFA]/40 focus:outline-none disabled:opacity-50"
            >
              {CLAUDE_MODELS.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">Extra context (optional)</span>
            <textarea
              value={guidance}
              onChange={(e) => setGuidance(e.target.value)}
              rows={2}
              placeholder='e.g. "posting Friday 6pm" or "testing a harder hook"'
              className="bg-[#070b18] border border-white/[0.10] rounded-md px-3 py-2 text-xs text-gray-200 placeholder:text-gray-700 focus:border-[#A78BFA]/40 focus:outline-none resize-y"
            />
          </label>

          {status.kind !== 'prompt_ready' && status.kind !== 'awaiting_paste' && status.kind !== 'result' && (
            <button
              type="button"
              onClick={mode === 'api' ? handleApiPredict : handleManualBuild}
              disabled={busy}
              className="w-full py-3 rounded-xl font-bold text-sm tracking-wide
                         bg-gradient-to-r from-[#A78BFA] to-[#7C5CD6] text-[#150e26]
                         shadow-[0_4px_20px_rgba(167,139,250,0.3)] hover:shadow-[0_6px_28px_rgba(167,139,250,0.5)]
                         hover:-translate-y-0.5 active:translate-y-0 transition-all
                         disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
            >
              {busy ? 'Scoring…' : mode === 'api' ? 'Predict score' : 'Build prompt'}
            </button>
          )}

          {mode === 'manual' && status.kind === 'prompt_ready' && (
            <div className="flex flex-col gap-2 rounded-xl border border-[#A78BFA]/40 bg-[#150e26] p-3">
              <div className="text-[11px] text-[#A78BFA] leading-relaxed">✓ Prompt ready. Copy + open Claude.ai.</div>
              <textarea
                value={status.prompt}
                readOnly
                rows={4}
                spellCheck={false}
                onFocus={(e) => e.currentTarget.select()}
                className="w-full bg-[#070b18] border border-white/[0.10] rounded-md px-3 py-2 text-[10px] font-mono text-gray-300 focus:border-[#A78BFA]/40 focus:outline-none resize-y"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleManualCopyAndOpen}
                  className="flex-1 py-2.5 rounded-lg font-bold text-xs uppercase tracking-[0.14em] bg-gradient-to-r from-[#A78BFA] to-[#7C5CD6] text-[#150e26]"
                >
                  Copy + open Claude.ai
                </button>
                <button
                  type="button"
                  onClick={() => setStatus({ kind: 'idle' })}
                  className="px-3 py-2.5 rounded-lg text-xs uppercase tracking-[0.14em] text-gray-400 hover:text-gray-200 border border-white/10"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {mode === 'manual' && status.kind === 'awaiting_paste' && (
            <div className="flex flex-col gap-2 rounded-xl border border-[#A78BFA]/40 bg-[#150e26] p-3">
              <div className="text-[11px] text-[#A78BFA] leading-relaxed">
                ✓ Prompt copied. Send it in Claude.ai, then paste the JSON reply below.
              </div>
              <textarea
                value={manualResponse}
                onChange={(e) => setManualResponse(e.target.value)}
                rows={5}
                placeholder='Paste the JSON object Claude.ai returned here…'
                spellCheck={false}
                className="w-full bg-[#070b18] border border-white/[0.10] rounded-md px-3 py-2 text-xs font-mono text-gray-200 placeholder:text-gray-700 focus:border-[#A78BFA]/40 focus:outline-none resize-y"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleManualApply}
                  disabled={!manualResponse.trim()}
                  className="flex-1 py-2.5 rounded-lg font-bold text-xs uppercase tracking-[0.14em] bg-gradient-to-r from-[#A78BFA] to-[#7C5CD6] text-[#150e26] disabled:opacity-50 disabled:cursor-not-allowed"
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

          {status.kind === 'result' && (
            <ResultCard
              result={status.result}
              attached={attachedScore === status.result.predictedScore}
              onAttach={handleAttach}
              onAgain={() => setStatus({ kind: 'idle' })}
            />
          )}

          {mode === 'api' && keyMissing && status.kind !== 'result' && (
            <div className="text-[11px] text-amber-300/90 leading-relaxed">
              Need an Anthropic key in <strong>Settings</strong> below — or flip to Manual mode.
            </div>
          )}

          {status.kind === 'err' && <div className="text-[11px] text-red-400 leading-relaxed">{status.msg}</div>}
        </div>
      )}
    </div>
  );
}

function ResultCard({
  result,
  attached,
  onAttach,
  onAgain,
}: {
  result: PredictionResult;
  attached: boolean;
  onAttach: () => void;
  onAgain: () => void;
}) {
  const list = (title: string, items: string[], color: string) =>
    items.length > 0 && (
      <div>
        <div className="text-[10px] font-bold uppercase tracking-[0.14em] mb-1" style={{ color }}>{title}</div>
        <ul className="list-disc list-inside space-y-0.5 text-[11px] text-gray-300 leading-relaxed">
          {items.map((it, i) => <li key={i}>{it}</li>)}
        </ul>
      </div>
    );
  return (
    <div className="rounded-xl border border-[#A78BFA]/40 bg-[#150e26] p-4 flex flex-col gap-3">
      <div className="flex items-center gap-4">
        <div className="shrink-0 w-20 h-20 rounded-full flex flex-col items-center justify-center border-2"
          style={{ borderColor: ACCENT }}>
          <span className="text-3xl font-black tabular-nums leading-none text-white">{result.predictedScore}</span>
          <span className="text-[9px] uppercase tracking-[0.14em] text-gray-500">/ 100</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-[0.16em] font-bold" style={{ color: confColor(result.confidence) }}>
            {result.confidence} confidence
          </div>
          {result.rationale && (
            <p className="mt-1 text-[11px] text-gray-300 leading-relaxed">{result.rationale}</p>
          )}
        </div>
      </div>

      {list('Strengths', result.strengths, '#22C55E')}
      {list('Risks', result.risks, '#F59E0B')}
      {list('Suggestions', result.suggestions, ACCENT)}

      <div className="flex gap-2 mt-1">
        <button
          type="button"
          onClick={onAttach}
          disabled={attached}
          className={
            'flex-1 py-2 rounded-lg font-bold text-xs uppercase tracking-[0.14em] transition-colors ' +
            (attached
              ? 'bg-[#22C55E]/15 text-[#22C55E] cursor-default'
              : 'bg-gradient-to-r from-[#A78BFA] to-[#7C5CD6] text-[#150e26]')
          }
        >
          {attached ? '✓ Attached to next save' : 'Attach to next save'}
        </button>
        <button
          type="button"
          onClick={onAgain}
          className="px-3 py-2 rounded-lg text-xs uppercase tracking-[0.14em] text-gray-400 hover:text-gray-200 border border-white/10"
        >
          Again
        </button>
      </div>
      <p className="text-[10px] text-gray-600 leading-relaxed">
        Attaching saves this prediction with the post when you tap “Save to history”. Once you enter the real
        numbers in Stats, you’ll see predicted vs actual.
      </p>
    </div>
  );
}
