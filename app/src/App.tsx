import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import engineHtml from '../../kiro_slideshow_engine_v3.html?raw';
import Library from './Library';
import Analytics from './Analytics';
import Patterns from './Patterns';
import Propose from './Propose';
import { addStockItem, blobToDataUrl, getItem } from './mediaBank';
import { addPost, type CloneAnalysisSnapshot, type PostPrediction } from './posts';
import { PRESETS, PRESET_KEYS, type PresetKey } from './presets';
import CloneFromTikTok from './CloneFromTikTok';
import PredictPanel from './PredictPanel';
import { CLAUDE_MODELS, type ClaudeModelId } from './anthropic';
import { buildIroEditPrompt, editImage, OpenAIImageError, type OpenAIImageQuality } from './openaiImage';

type Mascot = 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond' | 'iridescent';
type Platform = 'claude' | 'chatgpt';
type Status = { kind: 'idle' } | { kind: 'rendering' } | { kind: 'ok'; at: number } | { kind: 'err'; msg: string };
type MobileView = 'edit' | 'library' | 'patterns' | 'analytics' | 'preview';
type MainView = 'preview' | 'library' | 'patterns' | 'analytics';

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
  anthropicKey: string;
  claudeModel: ClaudeModelId;
  openaiKey: string;
  // When true, the hook + cta slides render with photo + mascot only,
  // no baked-in text. The user types the hook + CTA natively in
  // TikTok's editor after upload — the algorithm reads native text
  // better than image-baked text per the article.
  nativeTextOverlay: boolean;
};

const CLAUDE_MODEL_IDS = CLAUDE_MODELS.map((m) => m.id) as readonly ClaudeModelId[];

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
        anthropicKey: typeof p.anthropicKey === 'string' ? p.anthropicKey : '',
        claudeModel: CLAUDE_MODEL_IDS.includes(p.claudeModel as ClaudeModelId)
          ? (p.claudeModel as ClaudeModelId)
          : 'claude-opus-4-7',
        openaiKey: typeof p.openaiKey === 'string' ? p.openaiKey : '',
        nativeTextOverlay: p.nativeTextOverlay === true,
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
    anthropicKey: '',
    claudeModel: 'claude-opus-4-7',
    openaiKey: '',
    nativeTextOverlay: false,
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
    apps?: { name?: string }[];
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
  if (Array.isArray(p.apps)) {
    p.apps.forEach((a, i) => {
      const t = clean(a?.name || `App ${i + 1}`);
      out.push({ key: `app:${i}`, label: truncate(`${i + 1}. ${t}`, 40) });
      out.push({ key: `app-icon:${i}`, label: truncate(`${i + 1}. ${t} · icon`, 40) });
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
  const [anthropicKey, setAnthropicKey] = useState<string>(initial.anthropicKey);
  const [claudeModel, setClaudeModel] = useState<ClaudeModelId>(initial.claudeModel);
  const [openaiKey, setOpenaiKey] = useState<string>(initial.openaiKey);
  const [nativeTextOverlay, setNativeTextOverlay] = useState<boolean>(initial.nativeTextOverlay);
  // Bumped by Patterns → "Clone again". CloneFromTikTok watches this
  // and prefills its URL input + expands. Resets to empty string
  // when the panel consumes it.
  const [prefillCloneUrl, setPrefillCloneUrl] = useState('');
  // Last successful clone/proposal's structural analysis. Surfaced as
  // a small info card under the Clone panel + carried into the saved
  // Post (handleSaveToHistory) so the Patterns view + future Propose
  // runs can read it back as context.
  const [lastCloneNote, setLastCloneNote] = useState<string | null>(null);
  const [lastCloneAnalysis, setLastCloneAnalysis] = useState<CloneAnalysisSnapshot | null>(null);
  const [lastCloneSourceUrl, setLastCloneSourceUrl] = useState<string>('');
  const [lastOrigin, setLastOrigin] = useState<'manual' | 'clone' | 'propose'>('manual');
  // A score the Predict panel produced for the current draft, staged to
  // be persisted with the next "Save to history". Cleared after save (and
  // whenever the draft changes enough that the prediction is stale).
  const [pendingPrediction, setPendingPrediction] = useState<PostPrediction | null>(null);
  // Per-slide-key flag while an AI-edit is in flight. Greys out the
  // AI-edit button + shows a spinner.
  const [editingBg, setEditingBg] = useState<Record<string, boolean>>({});
  // Which slide row's source menu is open. Only one open at a time —
  // opening another closes the previous.
  const [openBgMenuKey, setOpenBgMenuKey] = useState<string | null>(null);
  // Hidden <input type="file"> per slide so each row can trigger its
  // own file picker without sharing state with other rows.
  const slideFileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
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
        JSON.stringify({
          mascot,
          variant,
          platform,
          jsonText,
          slideBgs,
          caption,
          preset,
          pexelsKey,
          unsplashKey,
          anthropicKey,
          claudeModel,
          openaiKey,
          nativeTextOverlay,
        }),
      );
    } catch {}
  }, [
    mascot,
    variant,
    platform,
    jsonText,
    slideBgs,
    caption,
    preset,
    pexelsKey,
    unsplashKey,
    anthropicKey,
    claudeModel,
    openaiKey,
    nativeTextOverlay,
  ]);

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

    // Native-overlay mode: blank the text fields on hook + cta so the
    // engine renders bg + mascot only. The user types the actual hook
    // and CTA copy in TikTok's editor after upload — algorithm reads
    // native text overlays better than baked-in PNG text per the
    // article. Middle slides keep their baked-in text since the
    // algorithm cares less there.
    if (nativeTextOverlay) {
      if (slides.hook && typeof slides.hook === 'object') {
        slides.hook = {
          ...(slides.hook as Record<string, unknown>),
          headline: '', sub: '', text: '', supporting: '', subline: '',
        };
      }
      if (slides.cta && typeof slides.cta === 'object') {
        slides.cta = {
          ...(slides.cta as Record<string, unknown>),
          headline: '', instructionAbove: '', searchTerm: '', instructionBelow: '', slogan: '',
        };
      }
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
      { field: 'apps', prefix: 'app' },
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

    // Resolve app icons for app_stack — separate from backgrounds.
    if (Array.isArray(slides['apps'])) {
      slides['apps'] = await Promise.all(
        (slides['apps'] as Record<string, unknown>[]).map(async (item, i) => {
          const iconUrl = await resolveSlideBg(slideBgs[`app-icon:${i}`]);
          return iconUrl ? { ...item, iconUrl } : item;
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

  async function handlePasteUrlForSlide(slideKey: string) {
    const url = window.prompt('Paste an image URL (Pinterest, any CDN, anywhere — we proxy it):');
    if (!url) return;
    const trimmed = url.trim();
    // Data URLs are same-origin so they're fine to hand straight to
    // the engine. HTTP(S) URLs need to flow through the proxy and
    // land in the media bank — most CDNs (Pinterest, image scrapers,
    // etc.) don't send CORS headers, which means html2canvas can't
    // capture them during the slide-export step.
    if (trimmed.startsWith('data:')) {
      setSlideBgs((prev) => ({ ...prev, [slideKey]: { type: 'url', url: trimmed } }));
      return;
    }
    setEditingBg((prev) => ({ ...prev, [slideKey]: true }));
    try {
      const res = await fetch(`/api/proxy-image?url=${encodeURIComponent(trimmed)}`);
      if (!res.ok) {
        let detail = '';
        try {
          const j = (await res.json()) as { error?: string };
          detail = j?.error || '';
        } catch {}
        throw new Error(detail || `Proxy returned ${res.status}`);
      }
      const blob = await res.blob();
      await saveAndAssignBlob(slideKey, blob, `url-paste-${Date.now()}`);
    } catch (e) {
      window.alert(
        `Couldn't fetch that URL: ${(e as Error).message}\n\n` +
          'If the source has hotlink protection, save the image to your device and use Upload instead.',
      );
    } finally {
      setEditingBg((prev) => {
        const next = { ...prev };
        delete next[slideKey];
        return next;
      });
    }
  }

  function handleClearBgForSlide(slideKey: string) {
    setSlideBgs((prev) => {
      const next = { ...prev };
      delete next[slideKey];
      return next;
    });
  }

  // Triggered by Patterns → "Clone again". Switches the user back to
  // the Edit pane and feeds the source URL into the Clone panel.
  function handleCloneAgain(sourceUrl: string) {
    setMainView('preview');
    setMobileView('edit');
    setPrefillCloneUrl(sourceUrl);
  }

  // From the Hook Library → "→ Editor". Prepend the proven hook to the
  // caption (so it becomes the first line / TikTok hook) and jump back to
  // the Edit pane so the user can build the rest of the post around it.
  function handleUseHook(hook: string) {
    setCaption((prev) => {
      const trimmed = prev.trim();
      if (!trimmed) return hook;
      if (trimmed.startsWith(hook)) return prev;
      return `${hook}\n\n${trimmed}`;
    });
    setMainView('preview');
    setMobileView('edit');
  }

  // Save a File/Blob from a direct upload (or a clipboard paste) into
  // the media bank and assign it as this slide's bg. Used by the
  // per-slide Upload + Paste menu items so the user can drop an image
  // they generated in Midjourney / ChatGPT / Nano Banana straight onto
  // a slide without bouncing through the Library tab.
  async function saveAndAssignBlob(slideKey: string, blob: Blob, name: string) {
    const item = await addStockItem({
      blob,
      mimeType: blob.type || 'image/png',
      name,
      source: { provider: 'upload' },
    });
    setSlideBgs((prev) => ({ ...prev, [slideKey]: { type: 'media', mediaId: item.id } }));
  }

  async function handleUploadForSlide(slideKey: string, file: File) {
    if (!file.type.startsWith('image/')) {
      window.alert('Pick an image file.');
      return;
    }
    try {
      await saveAndAssignBlob(slideKey, file, file.name || `slide-${slideKey}`);
    } catch (e) {
      window.alert(`Upload failed: ${(e as Error).message}`);
    }
  }

  // Reads the system clipboard, finds the first image item, saves it
  // as this slide's bg. Requires the page to be focused; modern
  // browsers prompt for clipboard-read permission on first use.
  async function handlePasteImageForSlide(slideKey: string) {
    if (typeof navigator === 'undefined' || !navigator.clipboard || !('read' in navigator.clipboard)) {
      window.alert(
        'Your browser doesn\'t allow reading images from the clipboard. Use the Upload option instead.',
      );
      return;
    }
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((t) => t.startsWith('image/'));
        if (!imageType) continue;
        const blob = await item.getType(imageType);
        await saveAndAssignBlob(slideKey, blob, `pasted-${Date.now()}.${imageType.split('/')[1] || 'png'}`);
        return;
      }
      window.alert('No image found on the clipboard. Copy an image first, then try again.');
    } catch (e) {
      // Permissions denied / no user gesture / unsupported MIME — surface a
      // clear message rather than silently failing.
      window.alert(`Could not read clipboard: ${(e as Error).message}`);
    }
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
        // New fields — populated when the post originated from a
        // clone or a propose. Manual edits land here as undefined,
        // which is fine — they just won't show up in Patterns.
        preset,
        sourceTikTokUrl: lastCloneSourceUrl || undefined,
        cloneAnalysis: lastCloneAnalysis,
        niche: lastCloneAnalysis?.niche,
        origin: lastOrigin,
        // Attach the staged prediction (if any) so Analytics can later
        // show predicted-vs-actual once the real numbers come in.
        prediction: pendingPrediction,
      });
      setSaveStatus({ kind: 'ok' });
      setPendingPrediction(null);
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

  // Wired to the CloneFromTikTok panel. Takes the clone result and
  // populates everything in one shot: JSON, preset, caption, per-slide
  // bgs. We don't auto-render so the user can eyeball the output first
  // — they hit "Render slides" themselves.
  function handleCloned(input: {
    preset: PresetKey;
    jsonText: string;
    caption: string;
    bgByKey: Record<string, string>;
    source: { url: string; author: { uniqueId: string }; slides: { index: number }[] };
    cloneAnalysis: CloneAnalysisSnapshot;
  }) {
    setPreset(input.preset);
    setJsonText(input.jsonText);
    setCaption(input.caption);
    const next: SlideBgMap = {};
    for (const [k, mediaId] of Object.entries(input.bgByKey)) {
      next[k] = { type: 'media', mediaId };
    }
    setSlideBgs(next);
    setLastCloneNote(
      `Source: @${input.source.author.uniqueId} · ${input.source.slides.length} slide${input.source.slides.length === 1 ? '' : 's'} — ` +
        `${input.cloneAnalysis.structuralFingerprint}`,
    );
    setLastCloneAnalysis(input.cloneAnalysis);
    setLastCloneSourceUrl(input.source.url);
    setLastOrigin('clone');
  }

  // Wired to the Propose panel. Unlike clone, propose has no source
  // URL and no source images — the user picks bgs from their own
  // library afterward (or copies the image prompts into Midjourney /
  // ChatGPT / Pexels).
  function handleProposed(input: {
    preset: PresetKey;
    jsonText: string;
    caption: string;
    cloneAnalysis: CloneAnalysisSnapshot;
    imageQueries: string[];
    rationale: string;
  }) {
    setPreset(input.preset);
    setJsonText(input.jsonText);
    setCaption(input.caption);
    // Propose doesn't auto-assign bgs. Leave the existing slideBgs
    // map in place — the user may want to reuse photos from a recent
    // clone.
    const fingerprint = input.cloneAnalysis.structuralFingerprint || 'fresh proposal';
    setLastCloneNote(`Proposal · ${fingerprint}${input.rationale ? ' — ' + input.rationale : ''}`);
    setLastCloneAnalysis(input.cloneAnalysis);
    setLastCloneSourceUrl('');
    setLastOrigin('propose');
    if (input.imageQueries.length > 0) {
      // Stash the image prompts in the clipboard-friendly format so
      // the user has them ready to paste into Midjourney/ChatGPT.
      // Best-effort — no toast if it fails.
      void navigator.clipboard?.writeText(input.imageQueries.map((q, i) => `${i + 1}. ${q}`).join('\n')).catch(() => {});
    }
  }

  // AI-edit pass on an existing slide bg. Pulls the current media
  // item's blob, sends it + an Iro-tailored prompt to gpt-image-1,
  // saves the result back into the media bank, and points the slide
  // at the new item. Opt-in (needs an OpenAI key in Settings) because
  // it's pay-per-image.
  async function handleAiEditBg(slideKey: string, slideLabel: string) {
    if (!openaiKey) {
      window.alert('Add an OpenAI API key under Settings to use AI-edit.');
      return;
    }
    const bg = slideBgs[slideKey];
    if (!bg || bg.type !== 'media') {
      window.alert('AI-edit works on backgrounds picked from the Library or cloned from TikTok. Assign one first.');
      return;
    }
    const item = await getItem(bg.mediaId);
    if (!item) {
      window.alert('Could not load the source image for that slide.');
      return;
    }
    const quality = (window.prompt('Image quality? low / medium / high (low ≈ $0.04, high ≈ $0.19)', 'medium') || 'medium')
      .trim()
      .toLowerCase() as OpenAIImageQuality;
    if (!['low', 'medium', 'high'].includes(quality)) return;

    setEditingBg((prev) => ({ ...prev, [slideKey]: true }));
    try {
      const editedBlob = await editImage({
        apiKey: openaiKey,
        sourceImage: item.blob,
        quality,
        prompt: buildIroEditPrompt({ slideRoleLabel: slideLabel, sourceCaption: lastCloneNote || caption }),
      });
      const newItem = await addStockItem({
        blob: editedBlob,
        mimeType: editedBlob.type || 'image/png',
        name: `iro-edit-${slideKey}-${Date.now()}`,
        source: { provider: 'upload' },
      });
      setSlideBgs((prev) => ({ ...prev, [slideKey]: { type: 'media', mediaId: newItem.id } }));
    } catch (e) {
      const msg = e instanceof OpenAIImageError ? e.message : (e as Error).message || 'AI-edit failed.';
      window.alert(`AI-edit failed: ${msg}`);
    } finally {
      setEditingBg((prev) => {
        const next = { ...prev };
        delete next[slideKey];
        return next;
      });
    }
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
          'relative flex-1 py-3.5 text-[10px] font-bold uppercase tracking-[0.10em] transition-colors ' +
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
        {mobileTabBtn('library', 'Lib')}
        {mobileTabBtn('patterns', 'Patterns')}
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
          <section className="px-5 md:px-10 pt-6 md:pt-7 pb-3 md:pb-4 flex flex-col gap-3">
            <CloneFromTikTok
              anthropicKey={anthropicKey}
              model={claudeModel}
              onModelChange={setClaudeModel}
              onCloned={handleCloned}
              prefillUrl={prefillCloneUrl}
              onPrefillConsumed={() => setPrefillCloneUrl('')}
            />
            <Propose
              anthropicKey={anthropicKey}
              model={claudeModel}
              onModelChange={setClaudeModel}
              onProposed={handleProposed}
            />
            <PredictPanel
              anthropicKey={anthropicKey}
              model={claudeModel}
              onModelChange={setClaudeModel}
              preset={preset}
              jsonText={jsonText}
              caption={caption}
              onPrediction={setPendingPrediction}
              attachedScore={pendingPrediction?.score ?? null}
            />
            {lastCloneNote && (
              <div className="text-[11px] text-gray-500 leading-relaxed">
                <strong className="text-gray-400">Last {lastOrigin}:</strong> {lastCloneNote}
              </div>
            )}
          </section>

          <section className="px-5 md:px-10 py-6 md:py-7 border-b border-white/[0.05]">
            {sectionLabel('Format')}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
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
                  if (bg?.type === 'media') bgLabel = 'My library';
                  const menuOpen = openBgMenuKey === key;
                  const editing = !!editingBg[key];

                  const menuItem = (
                    text: string,
                    onClick: () => void,
                    opts?: { danger?: boolean; sub?: string; disabled?: boolean },
                  ) => (
                    <button
                      key={text}
                      type="button"
                      disabled={opts?.disabled}
                      onClick={() => {
                        setOpenBgMenuKey(null);
                        onClick();
                      }}
                      className={
                        'flex flex-col items-start px-3 py-2 text-left text-[12px] transition-colors ' +
                        (opts?.danger
                          ? 'text-red-300 hover:bg-red-500/10'
                          : 'text-gray-200 hover:bg-[#00E5FF]/10 hover:text-[#00E5FF]') +
                        (opts?.disabled ? ' opacity-40 cursor-not-allowed pointer-events-none' : '')
                      }
                    >
                      <span className="font-medium">{text}</span>
                      {opts?.sub && (
                        <span className="text-[10px] text-gray-500 normal-case">{opts.sub}</span>
                      )}
                    </button>
                  );

                  return (
                    <div
                      key={key}
                      className={
                        'relative rounded-xl border px-3 py-2.5 flex gap-3 transition-colors ' +
                        (set
                          ? 'border-[#00E5FF]/25 bg-gradient-to-br from-[#0e2030] to-[#0a1424]'
                          : 'border-white/[0.07] bg-[#0b1224]/60')
                      }
                    >
                      {/* Hidden per-slide file input — triggered by the
                         "Upload from device" menu item. */}
                      <input
                        ref={(el) => {
                          slideFileInputRefs.current[key] = el;
                        }}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void handleUploadForSlide(key, file);
                          e.target.value = '';
                        }}
                      />

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
                        <div className="mt-1.5">
                          <button
                            type="button"
                            onClick={() => setOpenBgMenuKey(menuOpen ? null : key)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] rounded-md
                                       bg-white/[0.04] text-gray-300 hover:bg-[#00E5FF]/15 hover:text-[#00E5FF] border border-white/10"
                          >
                            {editing ? 'AI editing…' : 'Image source'} <span aria-hidden>▾</span>
                          </button>
                        </div>
                      </div>

                      {menuOpen && (
                        <>
                          {/* Click-outside catcher. Pointer-events on the
                             popover stay live because it's stacked above
                             this overlay via z-index. */}
                          <button
                            type="button"
                            aria-label="Close menu"
                            onClick={() => setOpenBgMenuKey(null)}
                            className="fixed inset-0 z-30 bg-transparent cursor-default"
                          />
                          <div className="absolute right-3 top-3 z-40 w-60 rounded-xl border border-white/10 bg-[#0a0e1a] shadow-[0_18px_44px_-10px_rgba(0,0,0,0.7)] overflow-hidden flex flex-col">
                            {menuItem('Upload from device', () => slideFileInputRefs.current[key]?.click(), {
                              sub: 'Pick a file — Midjourney / ChatGPT / Nano Banana export, whatever.',
                            })}
                            {menuItem('Paste from clipboard', () => void handlePasteImageForSlide(key), {
                              sub: 'Copy an image first, then tap this. Cmd/Ctrl+V style.',
                            })}
                            {menuItem('Pick from My Library', () => handlePickForSlide(key, label), {
                              sub: 'Uploads, stock results, cloned TikTok photos.',
                            })}
                            {menuItem('Paste image URL', () => handlePasteUrlForSlide(key), {
                              sub: 'Direct link to a publicly reachable image.',
                            })}
                            {set && bg?.type === 'media' && openaiKey && menuItem(
                              editing ? 'AI-editing…' : 'AI-edit current image',
                              () => void handleAiEditBg(key, label),
                              {
                                sub: 'gpt-image-1 · pay-per-image · drops Iro vibe into the current photo.',
                                disabled: editing,
                              },
                            )}
                            {set && bg?.type === 'media' && !openaiKey && menuItem(
                              'AI-edit (needs OpenAI key)',
                              () => window.alert('Add an OpenAI API key under Settings to enable AI-edit.'),
                              { sub: 'Pay-per-image. Optional.', disabled: false },
                            )}
                            {set && menuItem('Clear (use mascot default)', () => handleClearBgForSlide(key), {
                              danger: true,
                            })}
                          </div>
                        </>
                      )}
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
            <div className="grid grid-cols-3 gap-2 mb-4">
              <button
                type="button"
                onClick={() => {
                  setMainView('library');
                  setMobileView('library');
                }}
                className="py-3 rounded-xl text-[11px] md:text-xs font-bold uppercase tracking-[0.12em]
                           border border-white/[0.10] bg-white/[0.03] text-gray-300
                           hover:border-[#00E5FF]/40 hover:text-[#00E5FF] transition-all"
              >
                Media Bank
              </button>
              <button
                type="button"
                onClick={() => {
                  setMainView('patterns');
                  setMobileView('patterns');
                }}
                className="py-3 rounded-xl text-[11px] md:text-xs font-bold uppercase tracking-[0.12em]
                           border border-white/[0.10] bg-white/[0.03] text-gray-300
                           hover:border-[#FFC857]/40 hover:text-[#FFC857] transition-all"
              >
                Patterns
              </button>
              <button
                type="button"
                onClick={() => {
                  setMainView('analytics');
                  setMobileView('analytics');
                }}
                className="py-3 rounded-xl text-[11px] md:text-xs font-bold uppercase tracking-[0.12em]
                           border border-white/[0.10] bg-white/[0.03] text-gray-300
                           hover:border-[#00E5FF]/40 hover:text-[#00E5FF] transition-all"
              >
                Analytics
              </button>
            </div>

            {/* Native-overlay toggle. When on, the hook + cta slides
               export with bg + mascot only — the user types the actual
               hook/CTA copy in TikTok's editor after upload. Per the
               article, native text overlays get better algorithm
               treatment than baked-in PNG text on the highest-stakes
               slides. Middle slides keep their baked text. */}
            <label className="flex items-start gap-3 mb-4 p-3 rounded-xl border border-white/[0.06] bg-white/[0.02] cursor-pointer hover:border-white/[0.12] transition-colors">
              <input
                type="checkbox"
                checked={nativeTextOverlay}
                onChange={(e) => setNativeTextOverlay(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-[#00E5FF] cursor-pointer"
              />
              <span className="flex-1">
                <span className="block text-[12px] font-bold text-gray-200">
                  Native TikTok text overlay
                </span>
                <span className="block text-[10px] text-gray-500 mt-0.5 leading-relaxed">
                  Strip hook + CTA text from the render so you can type them natively in TikTok's editor.
                  Algorithm reads native text better than baked-in image text.
                </span>
              </span>
            </label>

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
            {pendingPrediction && (
              <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                <span className="text-[#A78BFA]">
                  ⌁ Prediction <strong>{pendingPrediction.score}/100</strong> will be saved with this post.
                </span>
                <button
                  type="button"
                  onClick={() => setPendingPrediction(null)}
                  className="text-gray-500 hover:text-gray-300 uppercase tracking-[0.14em] text-[10px] font-bold"
                >
                  Detach
                </button>
              </div>
            )}
            {saveStatus.kind === 'err' && (
              <div className="mt-2 text-xs text-red-400">Save failed: {saveStatus.msg}</div>
            )}
          </section>

          <section className="px-5 md:px-10 py-6 md:py-7 border-t border-white/[0.05]">
            {sectionLabel('Settings')}
            <p className="text-xs text-gray-500 leading-relaxed mb-4">
              Pasted keys live in this browser only. Pexels &amp; Unsplash are free; Anthropic &amp; OpenAI are pay-per-use.
            </p>

            <label className="flex flex-col gap-1.5 mb-3">
              <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-gray-500">
                Claude model (for cloning)
              </span>
              <select
                value={claudeModel}
                onChange={(e) => setClaudeModel(e.target.value as ClaudeModelId)}
                className="bg-[#070b18] border border-white/[0.10] rounded-md px-3 py-2 text-sm text-gray-200 focus:border-[#00E5FF]/40 focus:outline-none"
              >
                {CLAUDE_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </label>

            {([
              {
                label: 'Anthropic API key',
                value: anthropicKey,
                setter: setAnthropicKey,
                href: 'https://console.anthropic.com/settings/keys',
                note: 'Required for "Clone from TikTok". Pay-per-token.',
              },
              {
                label: 'OpenAI API key (optional)',
                value: openaiKey,
                setter: setOpenaiKey,
                href: 'https://platform.openai.com/api-keys',
                note: 'Only needed for AI-edit of slide backgrounds. ~$0.04–$0.19 per image.',
              },
              { label: 'Pexels API key', value: pexelsKey, setter: setPexelsKey, href: 'https://www.pexels.com/api/', note: 'Free.' },
              { label: 'Unsplash access key', value: unsplashKey, setter: setUnsplashKey, href: 'https://unsplash.com/developers', note: 'Free.' },
            ] as const).map(({ label, value, setter, href, note }) => {
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
                  {note && <span className="text-[10px] text-gray-600 leading-relaxed">{note}</span>}
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
          (mobileView === 'patterns' ? 'block ' : 'hidden ') +
          (mainView === 'patterns' ? 'md:block' : 'md:hidden')
        }>
          <Patterns onCloneAgain={handleCloneAgain} />
        </div>
        <div className={
          'absolute inset-0 ' +
          (mobileView === 'analytics' ? 'block ' : 'hidden ') +
          (mainView === 'analytics' ? 'md:block' : 'md:hidden')
        }>
          <Analytics
            anthropicKey={anthropicKey}
            model={claudeModel}
            onModelChange={setClaudeModel}
            onUseHook={handleUseHook}
          />
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
