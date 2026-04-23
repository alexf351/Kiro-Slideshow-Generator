import { useEffect, useMemo, useRef, useState } from 'react';
import engineHtml from '../../kiro_slideshow_engine_v3.html?raw';

type Mascot = 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond' | 'iridescent';
type Platform = 'claude' | 'chatgpt';
type Status = { kind: 'idle' } | { kind: 'rendering' } | { kind: 'ok'; at: number } | { kind: 'err'; msg: string };

const MASCOT_ORDER: Mascot[] = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'iridescent'];

// Variants baked into MASCOTS for each tier. Keep in sync with app/public/ and scripts/bake_mascots.py.
const VARIANTS_BY_TIER: Record<Mascot, string[]> = {
  bronze: ['base', 'celebrating', 'happy', 'learning', 'sad', 'splash', 'typing', 'waving'],
  silver: ['base', 'celebrating', 'waving'],
  gold: ['base', 'celebrating', 'waving'],
  platinum: ['base', 'celebrating', 'waving'],
  diamond: ['base', 'celebrating', 'waving'],
  iridescent: ['base', 'celebrating', 'waving'],
};

// Filename resolver for the sharp source assets served by Vite at the site root.
function variantAssetPath(tier: Mascot, variant: string): string {
  if (variant === 'base') return `/${tier}-kiro.webp`;
  // bronze-splash is the only non-webp variant on disk.
  if (tier === 'bronze' && variant === 'splash') return '/bronze-kiro-splash.png';
  return `/${tier}-kiro-${variant}.webp`;
}

// Composes the MASCOTS key used by the engine: base → tier only (backward-compat),
// other variants → "{tier}-{variant}".
function mascotKey(tier: Mascot, variant: string): string {
  return variant === 'base' ? tier : `${tier}-${variant}`;
}

const DEFAULT_JSON = `{
  "platform": "claude",
  "mascot": "platinum",
  "hook": {
    "headline": "<strong>3</strong> Claude Prompts<br/>Every <strong>Writer</strong><br/>Should Steal",
    "sub": "(Faster drafts, sharper edits.)"
  },
  "prompts": [
    {
      "title": "1. <strong>OUTLINE</strong> FROM MESS",
      "prompt": "Here are my notes: [paste notes]. Turn them into a 5-section outline. For each section: one-sentence argument + key evidence."
    },
    {
      "title": "2. <strong>REWRITE</strong> FOR PUNCH",
      "prompt": "Here's my paragraph: [paste]. Rewrite three ways: (a) 30% shorter, (b) one bold claim up front, (c) plain language only. Label each."
    },
    {
      "title": "3. <strong>DEVIL'S</strong> ADVOCATE",
      "prompt": "Read my draft: [paste]. Give me the strongest counter-argument, the weakest claim to cut, and one thing a smart reader would ask."
    }
  ],
  "cta": {
    "headline": "Want to actually <strong>learn AI</strong><br/>instead of just<br/>collecting prompts?",
    "instructionAbove": "search:",
    "searchTerm": "Kiro AI",
    "instructionBelow": "on the App Store.",
    "slogan": "stop asking AI questions.<br/><strong>start building with it.</strong>"
  },
  "attribution": "@KIRO.APP"
}`;

const STORAGE_KEY = 'kiro_slideshow_generator_state_v2';

type Persisted = { mascot: Mascot; variant: string; platform: Platform; jsonText: string };

function loadPersisted(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Persisted>;
      const mascot = MASCOT_ORDER.includes(p.mascot as Mascot) ? (p.mascot as Mascot) : 'platinum';
      const available = VARIANTS_BY_TIER[mascot];
      const variant = typeof p.variant === 'string' && available.includes(p.variant) ? p.variant : 'base';
      return {
        mascot,
        variant,
        platform: p.platform === 'chatgpt' ? 'chatgpt' : 'claude',
        jsonText: typeof p.jsonText === 'string' ? p.jsonText : DEFAULT_JSON,
      };
    }
  } catch {}
  return { mascot: 'platinum', variant: 'base', platform: 'claude', jsonText: DEFAULT_JSON };
}

export default function App() {
  const initial = useMemo(loadPersisted, []);
  const [mascot, setMascot] = useState<Mascot>(initial.mascot);
  const [variant, setVariant] = useState<string>(initial.variant);
  const [platform, setPlatform] = useState<Platform>(initial.platform);
  const [jsonText, setJsonText] = useState<string>(initial.jsonText);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // When tier changes, keep the current variant if the new tier has it; otherwise reset to base.
  function handleTierChange(newTier: Mascot) {
    setMascot(newTier);
    if (!VARIANTS_BY_TIER[newTier].includes(variant)) setVariant('base');
  }

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ mascot, variant, platform, jsonText }));
    } catch {}
  }, [mascot, variant, platform, jsonText]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const msg = e.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'rendered') setStatus({ kind: 'ok', at: Date.now() });
      if (msg.type === 'error') setStatus({ kind: 'err', msg: String(msg.message || 'render failed') });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  function parseJson(): Record<string, unknown> | null {
    const t = jsonText.trim();
    if (!t) {
      setStatus({ kind: 'err', msg: 'JSON is empty.' });
      return null;
    }
    let stripped = t
      .replace(/^\s*(const|let|var)\s+SLIDES\s*=\s*/, '')
      .replace(/;\s*$/, '')
      .replace(/^```(?:json|javascript|js)?\s*/i, '')
      .replace(/```\s*$/, '')
      .trim();
    try {
      return JSON.parse(stripped);
    } catch (e) {
      try {
        return new Function('return (' + stripped + ')')() as Record<string, unknown>;
      } catch {
        setStatus({ kind: 'err', msg: 'Invalid JSON — check quotes/commas. ' + (e as Error).message });
        return null;
      }
    }
  }

  function handleRender() {
    const parsed = parseJson();
    if (!parsed) return;
    const slides = { ...parsed, mascot: mascotKey(mascot, variant), platform };
    const iframe = iframeRef.current;
    if (!iframe || !iframe.contentWindow) {
      setStatus({ kind: 'err', msg: 'Engine iframe not ready.' });
      return;
    }
    setStatus({ kind: 'rendering' });
    iframe.contentWindow.postMessage({ type: 'render', slides }, '*');
  }

  function handleIframeLoad() {
    // Push current sidebar state into the engine on initial load so the
    // preview matches the controls instead of showing the engine's default.
    handleRender();
  }

  return (
    <div className="flex h-screen bg-[#0a0e1a] text-gray-100">
      <aside className="w-96 border-r border-[#2a334a] flex flex-col shrink-0 overflow-hidden">
        <header className="px-5 py-4 border-b border-[#2a334a]">
          <h1 className="text-sm font-semibold tracking-wider text-[#00E5FF]">
            KIRO SLIDESHOW GENERATOR
          </h1>
          <p className="text-xs text-gray-400 mt-1">Pick mascot + platform, paste JSON, render.</p>
        </header>

        <div className="flex-1 overflow-y-auto">
          <section className="px-5 py-4 border-b border-[#2a334a]">
            <label className="block text-[11px] uppercase tracking-wider text-gray-400 mb-3">Mascot</label>
            <div className="grid grid-cols-3 gap-2">
              {MASCOT_ORDER.map((m) => {
                const selected = m === mascot;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => handleTierChange(m)}
                    className={
                      'group flex flex-col items-center gap-1 p-2 rounded-md border transition-colors ' +
                      (selected
                        ? 'border-[#00E5FF] bg-[rgba(0,229,255,0.08)]'
                        : 'border-[#2a334a] bg-[#121826] hover:border-[#3a4560]')
                    }
                  >
                    <img
                      src={`/${m}-kiro.webp`}
                      alt={`${m} kiro`}
                      className="w-16 h-16 object-contain"
                      loading="lazy"
                    />
                    <span className={'text-[10px] uppercase tracking-wider ' + (selected ? 'text-[#00E5FF]' : 'text-gray-400')}>
                      {m}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="px-5 py-4 border-b border-[#2a334a]">
            <label className="block text-[11px] uppercase tracking-wider text-gray-400 mb-3">
              Emote <span className="text-gray-600">· {mascot}</span>
            </label>
            <div className="grid grid-cols-3 gap-2">
              {VARIANTS_BY_TIER[mascot].map((v) => {
                const selected = v === variant;
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setVariant(v)}
                    className={
                      'group flex flex-col items-center gap-1 p-2 rounded-md border transition-colors ' +
                      (selected
                        ? 'border-[#00E5FF] bg-[rgba(0,229,255,0.08)]'
                        : 'border-[#2a334a] bg-[#121826] hover:border-[#3a4560]')
                    }
                  >
                    <img
                      src={variantAssetPath(mascot, v)}
                      alt={`${mascot} ${v}`}
                      className="w-14 h-14 object-contain"
                      loading="lazy"
                    />
                    <span className={'text-[10px] uppercase tracking-wider ' + (selected ? 'text-[#00E5FF]' : 'text-gray-400')}>
                      {v}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="px-5 py-4 border-b border-[#2a334a]">
            <label className="block text-[11px] uppercase tracking-wider text-gray-400 mb-3">Chat platform</label>
            <div className="grid grid-cols-2 gap-2">
              {(['claude', 'chatgpt'] as Platform[]).map((p) => {
                const selected = p === platform;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPlatform(p)}
                    className={
                      'py-2 rounded-md border text-sm font-semibold transition-colors ' +
                      (selected
                        ? 'border-[#00E5FF] bg-[rgba(0,229,255,0.12)] text-[#00E5FF]'
                        : 'border-[#2a334a] bg-[#121826] text-gray-300 hover:border-[#3a4560]')
                    }
                  >
                    {p === 'claude' ? 'Claude' : 'ChatGPT'}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="px-5 py-4">
            <label className="block text-[11px] uppercase tracking-wider text-gray-400 mb-3">Slides JSON</label>
            <textarea
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              spellCheck={false}
              className="w-full h-64 bg-[#0e1426] border border-[#2a334a] rounded-md p-3 text-xs font-mono text-gray-200 focus:border-[#00E5FF] focus:outline-none resize-y"
              placeholder="Paste SLIDES JSON here…"
            />
            <div className="mt-2 min-h-[18px] text-xs">
              {status.kind === 'err' && <span className="text-red-400">{status.msg}</span>}
              {status.kind === 'ok' && <span className="text-[#00E5FF]">✓ Rendered. Scroll the preview, then click Download in the engine toolbar.</span>}
              {status.kind === 'rendering' && <span className="text-gray-400">Rendering…</span>}
            </div>
            <button
              type="button"
              onClick={handleRender}
              className="mt-3 w-full bg-[#00E5FF] text-[#0a0e1a] font-bold text-sm py-2.5 rounded-md hover:bg-[#33ECFF] transition-colors"
            >
              Render slides
            </button>
          </section>
        </div>
      </aside>

      <main className="flex-1 overflow-hidden">
        <iframe
          ref={iframeRef}
          srcDoc={engineHtml}
          onLoad={handleIframeLoad}
          className="w-full h-full border-0 bg-[#1a1a1a]"
          title="Kiro slideshow renderer"
        />
      </main>
    </div>
  );
}
