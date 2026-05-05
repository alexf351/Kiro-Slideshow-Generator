import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import engineHtml from '../../kiro_slideshow_engine_v3.html?raw';
import Library from './Library';
import Analytics from './Analytics';
import { blobToDataUrl, getItem } from './mediaBank';
import { addPost } from './posts';
import { PRESETS, PRESET_KEYS, type PresetKey } from './presets';

type Mascot = 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond' | 'iridescent';
type Platform = 'claude' | 'chatgpt';
type Status = { kind: 'idle' } | { kind: 'rendering' } | { kind: 'ok'; at: number } | { kind: 'err'; msg: string };
type MobileView = 'edit' | 'library' | 'analytics' | 'preview';
type MainView = 'preview' | 'library' | 'analytics';

// Per-slide background. Either a media-bank item id (resolved to a data URL at
// render time) or a pasted URL we hand straight through to the engine.
type SlideBg = { type: 'media'; mediaId: string } | { type: 'url'; url: string };
// Keys: 'hook', 'cta', 'prompt:0', 'prompt:1', … so renaming/reordering JSON
// keeps the slot stable as long as the prompt index doesn't shift.
type SlideBgMap = Record<string, SlideBg>;

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
    "searchTerm": "Iro AI",
    "instructionBelow": "on the App Store.",
    "slogan": "stop asking AI questions.<br/><strong>start building with it.</strong>"
  },
  "attribution": "@tryiro"
}`;

const STORAGE_KEY = 'kiro_slideshow_generator_state_v2';

type Persisted = {
  mascot: Mascot;
  variant: string;
  platform: Platform;
  jsonText: string;
  slideBgs: SlideBgMap;
  caption: string;
  preset: PresetKey;
  pexelsKey: string;
  unsplashKey: string;
};

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
        slideBgs: (p.slideBgs && typeof p.slideBgs === 'object' ? p.slideBgs : {}) as SlideBgMap,
        caption: typeof p.caption === 'string' ? p.caption : '',
        preset: PRESET_KEYS.includes(p.preset as PresetKey) ? (p.preset as PresetKey) : 'prompt_pack',
        pexelsKey: typeof p.pexelsKey === 'string' ? p.pexelsKey : '',
        unsplashKey: typeof p.unsplashKey === 'string' ? p.unsplashKey : '',
      };
    }
  } catch {}
  return {
    mascot: 'platinum',
    variant: 'base',
    platform: 'claude',
    jsonText: DEFAULT_JSON,
    slideBgs: {},
    caption: '',
    preset: 'prompt_pack',
    pexelsKey: '',
    unsplashKey: '',
  };
}

// Strip wrappers like `const SLIDES =` / `;` / ```json fences before JSON.parse.
function stripJsonWrappers(t: string): string {
  return t
    .replace(/^\s*(const|let|var)\s+SLIDES\s*=\s*/, '')
    .replace(/;\s*$/, '')
    .replace(/^```(?:json|javascript|js)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
}

// Walks the parsed JSON and returns one row per visible slide, in render order.
// `key` is what we use in slideBgs; `label` shows up in the picker UI.
//
// Different presets put their content in different array fields:
//   prompt_pack → prompts[]   (key prompt:N)
//   pain_story  → beats[]     (key beat:N)
//   meme_pov    → panels[]    (key panel:N)
// The picker is preset-agnostic; whichever array exists gets enumerated.
type SlideMeta = { key: string; label: string };
function clean(text: string): string {
  return text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}
function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 3) + '…' : s;
}
function extractSlideMeta(parsed: unknown): SlideMeta[] {
  if (!parsed || typeof parsed !== 'object') return [];
  const p = parsed as {
    hook?: { headline?: string; text?: string };
    prompts?: { title?: string }[];
    beats?: { text?: string }[];
    panels?: { top?: string; bottom?: string }[];
    features?: { headline?: string }[];
    cta?: unknown;
  };
  const out: SlideMeta[] = [];
  if (p.hook) {
    const h = clean(p.hook.headline || p.hook.text || 'Hook');
    out.push({ key: 'hook', label: truncate(`Hook — ${h}`, 40) });
  }
  if (Array.isArray(p.prompts)) {
    p.prompts.forEach((pr, i) => {
      const t = clean(pr?.title || `Prompt ${i + 1}`);
      out.push({ key: `prompt:${i}`, label: truncate(t, 40) });
    });
  }
  if (Array.isArray(p.beats)) {
    p.beats.forEach((b, i) => {
      const t = clean(b?.text || `Beat ${i + 1}`);
      out.push({ key: `beat:${i}`, label: truncate(`${i + 1}. ${t}`, 40) });
    });
  }
  if (Array.isArray(p.panels)) {
    p.panels.forEach((pn, i) => {
      const t = clean(pn?.top || pn?.bottom || `Panel ${i + 1}`);
      out.push({ key: `panel:${i}`, label: truncate(`Panel ${i + 1} — ${t}`, 40) });
    });
  }
  if (Array.isArray(p.features)) {
    p.features.forEach((f, i) => {
      const t = clean(f?.headline || `Feature ${i + 1}`);
      out.push({ key: `feature:${i}`, label: truncate(`Feature ${i + 1} — ${t}`, 40) });
    });
  }
  if (Array.isArray((p as { items?: { text?: string }[] }).items)) {
    (p as { items: { text?: string }[] }).items.forEach((it, i) => {
      const t = clean(it?.text || `Item ${i + 1}`);
      out.push({ key: `item:${i}`, label: truncate(`${i + 1}. ${t}`, 40) });
    });
  }
  if (p.cta) out.push({ key: 'cta', label: 'CTA' });
  return out;
}

export default function App() {
  const initial = useMemo(loadPersisted, []);
  const [mascot, setMascot] = useState<Mascot>(initial.mascot);
  const [variant, setVariant] = useState<string>(initial.variant);
  const [platform, setPlatform] = useState<Platform>(initial.platform);
  const [jsonText, setJsonText] = useState<string>(initial.jsonText);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [mobileView, setMobileView] = useState<MobileView>('edit');
  const [mainView, setMainView] = useState<MainView>('preview');
  const [slideBgs, setSlideBgs] = useState<SlideBgMap>(initial.slideBgs);
  const [caption, setCaption] = useState<string>(initial.caption);
  const [preset, setPreset] = useState<PresetKey>(initial.preset);
  const [pexelsKey, setPexelsKey] = useState<string>(initial.pexelsKey);
  const [unsplashKey, setUnsplashKey] = useState<string>(initial.unsplashKey);
  const [saveStatus, setSaveStatus] = useState<{ kind: 'idle' } | { kind: 'saving' } | { kind: 'ok' } | { kind: 'err'; msg: string }>({ kind: 'idle' });
  // Active "pick a background for slide X" request — when set, the Library
  // shows a banner + cancel button and the next tap on an item resolves the
  // promise and writes back into slideBgs.
  const [pickRequest, setPickRequest] = useState<{
    slideKey: string;
    slideLabel: string;
    resolve: (mediaId: string | null) => void;
  } | null>(null);
  // Thumbnails for the per-slide bg picker rows. Resolved async from
  // IndexedDB (for media items) or used as-is (for direct URLs). Cleared
  // and recreated whenever the slideBgs map changes; object URLs from
  // previous resolutions get revoked in the cleanup below.
  const [bgThumbs, setBgThumbs] = useState<Record<string, string>>({});
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // When tier changes, keep the current variant if the new tier has it; otherwise reset to base.
  function handleTierChange(newTier: Mascot) {
    setMascot(newTier);
    if (!VARIANTS_BY_TIER[newTier].includes(variant)) setVariant('base');
  }

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ mascot, variant, platform, jsonText, slideBgs, caption, preset, pexelsKey, unsplashKey }),
      );
    } catch {}
  }, [mascot, variant, platform, jsonText, slideBgs, caption, preset, pexelsKey, unsplashKey]);

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

  // Resolve every entry in slideBgs to a thumbnail URL. Direct URLs pass
  // through; media-bank IDs hit IndexedDB and become Blob object URLs
  // we revoke on cleanup.
  useEffect(() => {
    let cancelled = false;
    const created: string[] = [];

    (async () => {
      const next: Record<string, string> = {};
      for (const [slideKey, bg] of Object.entries(slideBgs)) {
        if (!bg) continue;
        if (bg.type === 'url') {
          next[slideKey] = bg.url;
        } else {
          const item = await getItem(bg.mediaId);
          if (cancelled) return;
          if (item) {
            const url = URL.createObjectURL(item.blob);
            next[slideKey] = url;
            created.push(url);
          }
        }
      }
      if (!cancelled) setBgThumbs(next);
    })();

    return () => {
      cancelled = true;
      for (const url of created) URL.revokeObjectURL(url);
    };
  }, [slideBgs]);

  function parseJson(silent = false): Record<string, unknown> | null {
    const t = jsonText.trim();
    if (!t) {
      if (!silent) setStatus({ kind: 'err', msg: 'JSON is empty.' });
      return null;
    }
    const stripped = stripJsonWrappers(t);
    try {
      return JSON.parse(stripped);
    } catch (e) {
      try {
        return new Function('return (' + stripped + ')')() as Record<string, unknown>;
      } catch {
        if (!silent) setStatus({ kind: 'err', msg: 'Invalid JSON — check quotes/commas. ' + (e as Error).message });
        return null;
      }
    }
  }

  // Slide list for the per-slide bg picker. Re-parses lazily on JSON edits;
  // returns [] if the JSON is currently broken so the picker just collapses.
  const slideMetas = useMemo(() => {
    const parsed = parseJson(true);
    return parsed ? extractSlideMeta(parsed) : [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jsonText]);

  // Resolve a SlideBg into an actual URL the engine can use.
  // For media items: read the Blob from IndexedDB and convert to a data URL,
  // since blob: URLs from the parent document aren't always reachable inside
  // a srcDoc iframe (Safari quirk).
  async function resolveSlideBg(bg: SlideBg | undefined): Promise<string | null> {
    if (!bg) return null;
    if (bg.type === 'url') return bg.url;
    const item = await getItem(bg.mediaId);
    if (!item) return null;
    return await blobToDataUrl(item.blob);
  }

  async function handleRender() {
    const parsed = parseJson();
    if (!parsed) return;
    const iframe = iframeRef.current;
    if (!iframe || !iframe.contentWindow) {
      setStatus({ kind: 'err', msg: 'Engine iframe not ready.' });
      return;
    }
    setStatus({ kind: 'rendering' });

    // Sidebar preset always wins over whatever's in the pasted JSON — the
    // dropdown is the explicit user choice, the JSON field is just a hint
    // about which format the JSON was authored for.
    const slides: Record<string, unknown> = { ...parsed, mascot: mascotKey(mascot, variant), platform, preset };

    // Resolve and inject bg per-slide. Done in parallel so big slideshows with
    // multiple uploaded photos don't render serially.
    const hookBg = await resolveSlideBg(slideBgs['hook']);
    if (hookBg && slides.hook && typeof slides.hook === 'object') {
      slides.hook = { ...(slides.hook as object), bg: hookBg };
    }
    const ctaBg = await resolveSlideBg(slideBgs['cta']);
    if (ctaBg && slides.cta && typeof slides.cta === 'object') {
      slides.cta = { ...(slides.cta as object), bg: ctaBg };
    }
    // Walk every known content array. Each preset's content lives under
    // a different key (prompt_pack→prompts, pain_story→beats, meme_pov
    // →panels) and the slideBgs map uses a parallel key prefix.
    const contentArrays: { field: string; prefix: string }[] = [
      { field: 'prompts', prefix: 'prompt' },
      { field: 'beats', prefix: 'beat' },
      { field: 'panels', prefix: 'panel' },
      // For product_demo, item.bg becomes the screenshot inside the
      // phone mockup — same picker UX, different rendering surface.
      { field: 'features', prefix: 'feature' },
      { field: 'items', prefix: 'item' },
    ];
    for (const { field, prefix } of contentArrays) {
      const arr = slides[field];
      if (!Array.isArray(arr)) continue;
      slides[field] = await Promise.all(
        (arr as Record<string, unknown>[]).map(async (item, i) => {
          const bg = await resolveSlideBg(slideBgs[`${prefix}:${i}`]);
          return bg ? { ...item, bg } : item;
        }),
      );
    }

    iframe.contentWindow.postMessage({ type: 'render', slides }, '*');
    // On mobile, jump to the preview so the user sees the result. Also flip
    // desktop's main pane back to preview if we were sitting in the Library.
    setMobileView('preview');
    setMainView('preview');
  }

  // Open the Library in pick-a-bg mode and resolve once the user chooses or cancels.
  function pickBgFromLibrary(slideKey: string, slideLabel: string): Promise<string | null> {
    return new Promise((resolve) => {
      setPickRequest({ slideKey, slideLabel, resolve });
      setMainView('library');
      setMobileView('library');
    });
  }

  async function handlePickForSlide(slideKey: string, slideLabel: string) {
    const mediaId = await pickBgFromLibrary(slideKey, slideLabel);
    setPickRequest(null);
    setMainView('preview');
    if (mediaId) {
      setSlideBgs((prev) => ({ ...prev, [slideKey]: { type: 'media', mediaId } }));
    }
    // Bring the user back to the Edit tab on mobile so they see the change.
    setMobileView('edit');
  }

  function handlePasteUrlForSlide(slideKey: string) {
    const url = window.prompt('Paste an image URL (must be publicly reachable so the engine can fetch it):');
    if (!url) return;
    setSlideBgs((prev) => ({ ...prev, [slideKey]: { type: 'url', url: url.trim() } }));
  }

  function handleClearBgForSlide(slideKey: string) {
    setSlideBgs((prev) => {
      const next = { ...prev };
      delete next[slideKey];
      return next;
    });
  }

  // Asks the engine to render a small PNG of the hook slide and ship it
  // back via postMessage. Resolves to null if the engine never replies
  // (timeout) or hasn't rendered any slides yet — we still save the post,
  // just without a thumbnail.
  function captureThumbnail(): Promise<Blob | null> {
    return new Promise((resolve) => {
      const iframe = iframeRef.current;
      if (!iframe || !iframe.contentWindow) {
        resolve(null);
        return;
      }
      const requestId = Math.random().toString(36).slice(2);
      const onMessage = (e: MessageEvent) => {
        const m = e.data as { type?: string; requestId?: string; blob?: unknown };
        if (!m || m.type !== 'thumb' || m.requestId !== requestId) return;
        window.removeEventListener('message', onMessage);
        clearTimeout(timer);
        resolve(m.blob instanceof Blob ? m.blob : null);
      };
      window.addEventListener('message', onMessage);
      const timer = setTimeout(() => {
        window.removeEventListener('message', onMessage);
        resolve(null);
      }, 15000);
      iframe.contentWindow.postMessage({ type: 'capture-thumb', requestId }, '*');
    });
  }

  async function handleSaveToHistory() {
    if (!caption.trim() && !window.confirm('Save this post with no caption?')) return;
    setSaveStatus({ kind: 'saving' });
    try {
      const thumb = await captureThumbnail();
      await addPost({
        caption: caption.trim(),
        tiktokUrl: '',
        jsonSnapshot: jsonText,
        mascot: mascotKey(mascot, variant),
        platform,
        thumbnailBlob: thumb,
      });
      setSaveStatus({ kind: 'ok' });
      setTimeout(() => setSaveStatus({ kind: 'idle' }), 2500);
    } catch (e) {
      setSaveStatus({ kind: 'err', msg: (e as Error).message || 'save failed' });
    }
  }

  function handleIframeLoad() {
    // Push current sidebar state into the engine on initial load so the
    // preview matches the controls instead of showing the engine's default.
    handleRender();
  }

  const tileBase =
    'group relative flex flex-col items-center gap-3 p-5 rounded-2xl ' +
    'transition-all duration-200 ease-out';
  const tileSelected =
    'border border-[#00E5FF]/60 bg-gradient-to-br from-[#0e2b3a] to-[#091626] ' +
    'shadow-[0_0_0_1px_rgba(0,229,255,0.15),0_8px_24px_-8px_rgba(0,229,255,0.55)]';
  const tileIdle =
    'border border-white/[0.06] bg-gradient-to-br from-[#131a2e] to-[#0b1224] ' +
    'hover:border-white/[0.14] hover:from-[#1a2340] hover:to-[#0e1730] ' +
    'hover:-translate-y-0.5';

  const sectionLabel = (text: string, suffix?: ReactNode) => (
    <div className="flex items-center gap-3 mb-6">
      <span className="h-5 w-[5px] rounded-full bg-gradient-to-b from-[#00E5FF] to-[#00A5D9]"></span>
      <label className="text-[15px] font-bold uppercase tracking-[0.22em] text-gray-200">
        {text}
      </label>
      {suffix}
    </div>
  );

  const mobileTabBtn = (kind: MobileView, label: string) => {
    const active = mobileView === kind;
    return (
      <button
        type="button"
        onClick={() => setMobileView(kind)}
        className={
          'relative flex-1 py-3.5 text-[11px] font-bold uppercase tracking-[0.18em] transition-colors ' +
          (active ? 'text-[#00E5FF]' : 'text-gray-500 hover:text-gray-300')
        }
      >
        {label}
        <span
          className={
            'absolute left-1/2 bottom-0 -translate-x-1/2 h-[2px] rounded-full transition-all duration-200 ' +
            (active ? 'w-8 bg-[#00E5FF] shadow-[0_0_10px_rgba(0,229,255,0.7)]' : 'w-0 bg-transparent')
          }
        />
      </button>
    );
  };

  return (
    <div className="flex flex-col md:flex-row h-screen bg-[#070a14] text-gray-100">
      {/* Mobile-only tab bar; hidden on md+ where the sidebar is always visible. */}
      <nav className="md:hidden flex shrink-0 bg-gradient-to-b from-[#0a0e1a] to-[#080b16] border-b border-white/[0.05]">
        {mobileTabBtn('edit', 'Edit')}
        {mobileTabBtn('library', 'Library')}
        {mobileTabBtn('analytics', 'Stats')}
        {mobileTabBtn('preview', 'Preview')}
      </nav>

      <aside className={
        (mobileView === 'edit' ? 'flex' : 'hidden') +
        ' md:flex w-full md:w-[520px] xl:w-[640px] 2xl:w-[760px] shrink-0 flex-col overflow-hidden relative ' +
        'bg-gradient-to-b from-[#0b1020] via-[#0a0e1a] to-[#07091a] ' +
        'border-r border-white/[0.06] ' +
        'shadow-[inset_-1px_0_0_rgba(0,229,255,0.04)]'
      }>
        {/* subtle top accent */}
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#00E5FF]/40 to-transparent"></div>

        <header className="px-5 md:px-10 pt-7 md:pt-9 pb-5 md:pb-6 border-b border-white/[0.05]">
          <div className="flex items-baseline gap-3">
            <h1 className="text-3xl md:text-5xl font-black tracking-[-0.04em] text-white leading-none">
              iro
            </h1>
            <span className="text-[10px] md:text-[11px] font-bold uppercase tracking-[0.32em] text-[#00E5FF]">
              studio
            </span>
          </div>
          <p className="mt-3 md:mt-4 text-[12px] md:text-[13px] text-gray-500 leading-relaxed">
            Pick a format. Paste content. Render.
          </p>
        </header>

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          <section className="px-5 md:px-10 py-6 md:py-7 border-b border-white/[0.05]">
            {sectionLabel('Format')}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {PRESET_KEYS.map((key) => {
                const meta = PRESETS[key];
                const selected = preset === key;
                const planned = meta.status === 'planned';
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setPreset(key)}
                    style={selected ? {
                      borderColor: meta.accent + '99',
                      boxShadow: `0 0 0 1px ${meta.accent}26, 0 8px 24px -10px ${meta.accent}80`,
                    } : undefined}
                    className={
                      'group relative px-3 py-3 rounded-xl text-left transition-all duration-200 border ' +
                      (selected
                        ? 'bg-gradient-to-br from-white/[0.04] to-white/[0.01]'
                        : 'border-white/[0.07] bg-[#0b1224]/60 hover:border-white/[0.16] hover:bg-[#0c1428]')
                    }
                  >
                    {/* tiny accent dot, always visible to telegraph the format's color */}
                    <span
                      style={{ background: meta.accent, boxShadow: selected ? `0 0 12px ${meta.accent}99` : undefined }}
                      className="absolute top-3 right-3 w-1.5 h-1.5 rounded-full opacity-80"
                    />
                    <div
                      style={selected ? { color: meta.accent } : undefined}
                      className={
                        'text-[12px] font-bold uppercase tracking-[0.16em] ' +
                        (selected ? '' : 'text-gray-200 group-hover:text-white')
                      }
                    >
                      {meta.label}
                    </div>
                    {planned && (
                      <span className="mt-1 inline-block text-[9px] font-bold uppercase tracking-[0.14em] text-amber-300/80">
                        Coming soon
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-gray-500 leading-relaxed">{PRESETS[preset].pitch}</p>
            <button
              type="button"
              onClick={() => {
                if (jsonText.trim() && !window.confirm(`Replace the JSON with the ${PRESETS[preset].label} default?`)) return;
                setJsonText(PRESETS[preset].defaultJson);
              }}
              className="mt-3 text-[11px] font-bold uppercase tracking-[0.14em] text-gray-500 hover:text-[#00E5FF]"
            >
              Load default JSON for {PRESETS[preset].label} →
            </button>
          </section>

          <section className="px-5 md:px-10 py-6 md:py-7 border-b border-white/[0.04]">
            {sectionLabel('Mascot')}
            <div className="grid grid-cols-3 gap-3 md:gap-4">
              {MASCOT_ORDER.map((m) => {
                const selected = m === mascot;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => handleTierChange(m)}
                    className={tileBase + ' ' + (selected ? tileSelected : tileIdle)}
                  >
                    <img
                      src={`/${m}-kiro.webp`}
                      alt={`${m} iro`}
                      className={
                        'w-20 h-20 md:w-36 md:h-36 object-contain transition-transform duration-200 ' +
                        (selected ? 'drop-shadow-[0_6px_20px_rgba(0,229,255,0.55)]' : 'group-hover:scale-105')
                      }
                      // Eager load + async decode — iOS Safari sometimes
                      // skipped lazy-loaded tiles inside the scrollable
                      // sidebar, leaving placeholders forever. There are
                      // only six tiles, so the bandwidth cost is small.
                      loading="eager"
                      decoding="async"
                    />
                    <span className={
                      'text-[11px] md:text-[13px] font-bold uppercase tracking-[0.18em] ' +
                      (selected ? 'text-[#00E5FF]' : 'text-gray-500 group-hover:text-gray-300')
                    }>
                      {m}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="px-5 md:px-10 py-6 md:py-7 border-b border-white/[0.04]">
            {sectionLabel(
              'Emote',
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-600">
                · {mascot}
              </span>
            )}
            <div className="grid grid-cols-3 gap-3 md:gap-4">
              {VARIANTS_BY_TIER[mascot].map((v) => {
                const selected = v === variant;
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setVariant(v)}
                    className={tileBase + ' ' + (selected ? tileSelected : tileIdle)}
                  >
                    <img
                      src={variantAssetPath(mascot, v)}
                      alt={`${mascot} ${v}`}
                      className={
                        'w-20 h-20 md:w-32 md:h-32 object-contain transition-transform duration-200 ' +
                        (selected ? 'drop-shadow-[0_6px_20px_rgba(0,229,255,0.55)]' : 'group-hover:scale-105')
                      }
                      // See mascot tile note above re: iOS lazy-loading.
                      loading="eager"
                      decoding="async"
                    />
                    <span className={
                      'text-[11px] md:text-[13px] font-bold uppercase tracking-[0.18em] ' +
                      (selected ? 'text-[#00E5FF]' : 'text-gray-500 group-hover:text-gray-300')
                    }>
                      {v}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="px-5 md:px-10 py-6 md:py-7 border-b border-white/[0.04]">
            {sectionLabel('Chat platform')}
            <div className="grid grid-cols-2 gap-2 p-1.5 rounded-xl bg-black/30 border border-white/[0.04]">
              {(['claude', 'chatgpt'] as Platform[]).map((p) => {
                const selected = p === platform;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPlatform(p)}
                    className={
                      'py-4 md:py-5 rounded-lg text-base md:text-lg font-bold tracking-wide transition-all duration-200 ' +
                      (selected
                        ? 'bg-gradient-to-br from-[#00E5FF]/20 to-[#00A5D9]/10 text-[#00E5FF] shadow-[inset_0_0_20px_rgba(0,229,255,0.08),0_1px_0_rgba(255,255,255,0.04)]'
                        : 'text-gray-400 hover:text-gray-200 hover:bg-white/[0.03]')
                    }
                  >
                    {p === 'claude' ? 'Claude' : 'ChatGPT'}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="px-5 md:px-10 py-6 md:py-7 border-b border-white/[0.04]">
            {sectionLabel('Slides JSON')}
            <textarea
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              spellCheck={false}
              className="w-full h-72 md:h-[28rem] bg-[#070b18] border border-white/[0.08] rounded-xl p-4 md:p-6
                         text-sm font-mono leading-relaxed text-gray-200
                         placeholder:text-gray-700
                         focus:border-[#00E5FF]/50 focus:outline-none
                         focus:shadow-[0_0_0_4px_rgba(0,229,255,0.08)]
                         resize-y custom-scrollbar transition-all duration-200"
              placeholder="Paste SLIDES JSON here…"
            />
            <div className="mt-3 min-h-[20px] text-xs">
              {status.kind === 'err' && (
                <div className="flex items-start gap-2 text-red-400">
                  <span className="mt-1 shrink-0 w-1.5 h-1.5 rounded-full bg-red-400"></span>
                  <span className="leading-relaxed">{status.msg}</span>
                </div>
              )}
              {status.kind === 'ok' && (
                <div className="flex items-center gap-2 text-[#00E5FF]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#00E5FF] shadow-[0_0_8px_rgba(0,229,255,0.8)]"></span>
                  <span>Rendered — hit Download in the top bar.</span>
                </div>
              )}
              {status.kind === 'rendering' && (
                <div className="flex items-center gap-2 text-gray-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-pulse"></span>
                  <span>Rendering…</span>
                </div>
              )}
            </div>
          </section>

          <section className="px-5 md:px-10 py-6 md:py-7 border-b border-white/[0.04]">
            {sectionLabel(
              'Backgrounds',
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-600">
                · per slide
              </span>,
            )}
            {slideMetas.length === 0 ? (
              <div className="text-xs text-gray-500 leading-relaxed">
                Fix the JSON above and the slide list will show up here.
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {slideMetas.map(({ key, label }) => {
                  const bg = slideBgs[key];
                  const thumb = bgThumbs[key];
                  const set = !!bg;
                  let bgLabel = 'Mascot default';
                  if (bg?.type === 'url') bgLabel = 'Pasted URL';
                  if (bg?.type === 'media') bgLabel = 'From library';
                  return (
                    <div
                      key={key}
                      className={
                        'rounded-xl border px-3 py-2.5 flex gap-3 transition-colors ' +
                        (set
                          ? 'border-[#00E5FF]/25 bg-gradient-to-br from-[#0e2030] to-[#0a1424]'
                          : 'border-white/[0.07] bg-[#0b1224]/60')
                      }
                    >
                      {/* 9:16 thumbnail. Shows the assigned bg if any,
                         otherwise a subtle "default" placeholder so the
                         row keeps its visual rhythm regardless. */}
                      <div className={
                        'shrink-0 w-10 h-[60px] rounded-md overflow-hidden border ' +
                        (set ? 'border-[#00E5FF]/40' : 'border-white/[0.08] bg-[#070b18]')
                      }>
                        {thumb ? (
                          <img src={thumb} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <span className="text-[8px] uppercase tracking-[0.16em] text-gray-700">
                              auto
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] text-gray-100 font-medium truncate">{label}</div>
                        <div
                          className={
                            'text-[10px] mt-0.5 uppercase tracking-[0.14em] font-bold ' +
                            (set ? 'text-[#00E5FF]' : 'text-gray-600')
                          }
                        >
                          {bgLabel}
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={() => handlePickForSlide(key, label)}
                            className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] rounded-md
                                       bg-white/[0.04] text-gray-300 hover:bg-[#00E5FF]/15 hover:text-[#00E5FF] border border-white/10"
                          >
                            Library
                          </button>
                          <button
                            type="button"
                            onClick={() => handlePasteUrlForSlide(key)}
                            className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] rounded-md
                                       bg-white/[0.04] text-gray-300 hover:bg-[#00E5FF]/15 hover:text-[#00E5FF] border border-white/10"
                          >
                            URL
                          </button>
                          {set && (
                            <button
                              type="button"
                              onClick={() => handleClearBgForSlide(key)}
                              className="px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] rounded-md
                                         text-gray-500 hover:text-red-300"
                            >
                              Clear
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="px-5 md:px-10 py-6 md:py-7 border-b border-white/[0.04]">
            {sectionLabel(
              'Caption',
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-600">
                · for TikTok
              </span>,
            )}
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              spellCheck={true}
              rows={3}
              className="w-full bg-[#070b18] border border-white/[0.08] rounded-xl p-3 md:p-4
                         text-sm leading-relaxed text-gray-200
                         placeholder:text-gray-700
                         focus:border-[#00E5FF]/50 focus:outline-none
                         focus:shadow-[0_0_0_4px_rgba(0,229,255,0.08)]
                         resize-y custom-scrollbar transition-all duration-200"
              placeholder="Hook in the first line. Hashtags at the end. (Saved with the post when you tap Save to history.)"
            />
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
              <button
                type="button"
                onClick={() => {
                  if (caption.trim() && !window.confirm(`Replace the caption with the ${PRESETS[preset].label} template?`)) return;
                  setCaption(PRESETS[preset].defaultCaption);
                }}
                className="text-[11px] font-bold uppercase tracking-[0.14em] text-gray-500 hover:text-[#00E5FF]"
              >
                Generate from {PRESETS[preset].label}
              </button>
              <button
                type="button"
                disabled={!caption}
                onClick={() => {
                  if (!caption) return;
                  navigator.clipboard?.writeText(caption).catch(() => {});
                }}
                className="text-[11px] font-bold uppercase tracking-[0.14em] text-gray-500 hover:text-[#00E5FF] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Copy caption
              </button>
            </div>
          </section>

          <section className="px-5 md:px-10 py-6 md:py-7">
            <div className="grid grid-cols-2 gap-2 mb-4">
              <button
                type="button"
                onClick={() => {
                  setMainView('library');
                  setMobileView('library');
                }}
                className="py-3 rounded-xl text-xs md:text-sm font-bold uppercase tracking-[0.14em]
                           border border-white/[0.10] bg-white/[0.03] text-gray-300
                           hover:border-[#00E5FF]/40 hover:text-[#00E5FF] transition-all"
              >
                Media Bank
              </button>
              <button
                type="button"
                onClick={() => {
                  setMainView('analytics');
                  setMobileView('analytics');
                }}
                className="py-3 rounded-xl text-xs md:text-sm font-bold uppercase tracking-[0.14em]
                           border border-white/[0.10] bg-white/[0.03] text-gray-300
                           hover:border-[#00E5FF]/40 hover:text-[#00E5FF] transition-all"
              >
                Analytics
              </button>
            </div>
            <button
              type="button"
              onClick={handleRender}
              className="w-full py-4 md:py-5 rounded-xl font-bold text-base md:text-lg tracking-wide
                         bg-gradient-to-r from-[#00E5FF] to-[#00A5D9]
                         text-[#0a0e1a]
                         shadow-[0_6px_30px_rgba(0,229,255,0.4),inset_0_1px_0_rgba(255,255,255,0.3)]
                         hover:shadow-[0_8px_36px_rgba(0,229,255,0.6),inset_0_1px_0_rgba(255,255,255,0.4)]
                         hover:-translate-y-0.5 active:translate-y-0
                         transition-all duration-200"
            >
              <span className="inline-flex items-center justify-center gap-3">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="5 3 19 12 5 21 5 3" fill="currentColor" />
                </svg>
                Render slides
              </span>
            </button>
            <button
              type="button"
              onClick={handleSaveToHistory}
              disabled={saveStatus.kind === 'saving'}
              className="mt-3 w-full py-3 md:py-3.5 rounded-xl text-sm font-bold uppercase tracking-[0.16em]
                         border border-[#00E5FF]/30 bg-[#0e2b3a] text-[#00E5FF]
                         hover:bg-[#13384c] hover:border-[#00E5FF]/60 transition-all
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saveStatus.kind === 'saving' ? 'Saving…' : saveStatus.kind === 'ok' ? '✓ Saved to history' : 'Save to history'}
            </button>
            {saveStatus.kind === 'err' && (
              <div className="mt-2 text-xs text-red-400">Save failed: {saveStatus.msg}</div>
            )}
          </section>

          <section className="px-5 md:px-10 py-6 md:py-7 border-t border-white/[0.05]">
            {sectionLabel('Settings')}
            <p className="text-xs text-gray-500 leading-relaxed mb-4">
              Pasted keys live in this browser only. Both signups are free.
            </p>
            {([
              { label: 'Pexels API key', value: pexelsKey, setter: setPexelsKey, href: 'https://www.pexels.com/api/' },
              { label: 'Unsplash access key', value: unsplashKey, setter: setUnsplashKey, href: 'https://unsplash.com/developers' },
            ] as const).map(({ label, value, setter, href }) => {
              const set = !!value;
              return (
                <label key={label} className="flex flex-col gap-1.5 mb-3 last:mb-0">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-gray-500 inline-flex items-center gap-2">
                      {label}
                      {set && (
                        <span className="text-[#22C55E] inline-flex items-center gap-1 normal-case tracking-normal font-medium">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E] shadow-[0_0_8px_rgba(34,197,94,0.7)]" />
                          set
                        </span>
                      )}
                    </span>
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] font-medium text-[#00E5FF]/80 hover:text-[#00E5FF]"
                    >
                      get one →
                    </a>
                  </div>
                  <input
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={value}
                    onChange={(e) => setter(e.target.value)}
                    placeholder="Paste here"
                    className="bg-[#070b18] border border-white/[0.10] rounded-md px-3 py-2 text-sm font-mono text-gray-200 placeholder:text-gray-700 focus:border-[#00E5FF]/40 focus:outline-none focus:shadow-[0_0_0_3px_rgba(0,229,255,0.08)] transition-shadow"
                  />
                </label>
              );
            })}
          </section>
        </div>
      </aside>

      {/*
        Main pane shows either the engine iframe (preview) or the Library, but
        keeps both mounted at all times. Toggling display:none preserves the
        iframe's loaded engine state across view switches — re-mounting it
        would force the user to wait for html2canvas / fonts to reload.
      */}
      {/*
        Main pane shows either the engine iframe or the Library. Both stay
        mounted with display:none so toggling between them keeps the engine's
        loaded state (fonts, html2canvas) instead of forcing a fresh load.
        On mobile the visible pane is driven by `mobileView`; on md+ by
        `mainView`. We compose the responsive classes with the `md:` prefix
        so Tailwind can pick them up statically.
      */}
      <main className={
        ((mobileView === 'edit') ? 'hidden' : 'block') +
        ' md:block flex-1 overflow-hidden relative'
      }>
        <div className={
          'absolute inset-0 ' +
          (mobileView === 'library' ? 'block ' : 'hidden ') +
          (mainView === 'library' ? 'md:block' : 'md:hidden')
        }>
          <Library pickMode={pickRequest} pexelsKey={pexelsKey} unsplashKey={unsplashKey} />
        </div>
        <div className={
          'absolute inset-0 ' +
          (mobileView === 'analytics' ? 'block ' : 'hidden ') +
          (mainView === 'analytics' ? 'md:block' : 'md:hidden')
        }>
          <Analytics />
        </div>
        <div className={
          'absolute inset-0 ' +
          (mobileView === 'preview' ? 'block ' : 'hidden ') +
          (mainView === 'preview' ? 'md:block' : 'md:hidden')
        }>
          <iframe
            ref={iframeRef}
            srcDoc={engineHtml}
            onLoad={handleIframeLoad}
            className="w-full h-full border-0 bg-[#1a1a1a]"
            title="Iro slideshow renderer"
          />
        </div>
      </main>
    </div>
  );
}
