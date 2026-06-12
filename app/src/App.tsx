import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import engineHtml from '../../kiro_slideshow_engine_v3.html?raw';
import Library from './Library';
import Analytics from './Analytics';
import Patterns from './Patterns';
import Propose from './Propose';
import { addStockItem, blobToDataUrl, getItem } from './mediaBank';
import { addPost, listPosts, type CloneAnalysisSnapshot, type PostPrediction } from './posts';
import { PRESETS, PRESET_KEYS, type PresetKey } from './presets';
import CloneFromTikTok from './CloneFromTikTok';
import PredictPanel from './PredictPanel';
import DesignPanel from './DesignPanel';
import QuickEdit from './QuickEdit';
import HypeEditor from './HypeEditor';
import CropAdjust, { DEFAULT_CROP, type CropValue } from './CropAdjust';
import { GRADIENTS, SOLID_BGS } from './gradients';
import { coerceDesign, DEFAULT_DESIGN, designPayload, ASPECT_KEYS, ASPECTS, type BrandDesign } from './design';
import { listDrafts, saveDraft, deleteDraft, type Draft } from './drafts';
import { exportBackup, importBackup, downloadBlob, timestampSlug } from './backup';
import { suggestHashtags, parseHashtags } from './insights';
import { listSets, saveSet, deleteSet, formatTags, type HashtagSet } from './hashtagSets';
import { encodePost, decodePost } from './postShare';
import { useUI } from './ui';
import CommandPalette, { type Command } from './CommandPalette';
import Onboarding, { shouldOnboard } from './Onboarding';
import EmojiPicker from './EmojiPicker';
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
  "attribution": ""
}`;

const STORAGE_KEY = 'kiro_slideshow_generator_state_v2';

// Which formats stamp the creator handle by default. The polished/branded
// styles get it; the casual aesthetic ones (pain story, meme, curated list)
// stay clean. Fully overridable per-format via the HUD checkbox.
const DEFAULT_ATTR_PRESETS: Record<string, boolean> = {
  prompt_pack: true,
  aspirational: true,
  product_demo: true,
};

type Persisted = {
  mascot: Mascot;
  variant: string;
  platform: Platform;
  jsonText: string;
  slideBgs: SlideBgMap;
  slideBgAdjust: Record<string, CropValue>;
  caption: string;
  preset: PresetKey;
  pexelsKey: string;
  unsplashKey: string;
  pixabayKey: string;
  anthropicKey: string;
  claudeModel: ClaudeModelId;
  openaiKey: string;
  // Output format + brand kit (aspect ratio, brand colors, watermark).
  design: BrandDesign;
  // When true, the hook + cta slides render with photo + mascot only,
  // no baked-in text. The user types the hook + CTA natively in
  // TikTok's editor after upload — the algorithm reads native text
  // better than image-baked text per the article.
  nativeTextOverlay: boolean;
  // Creator handle stamped under each slide (e.g. "@yourname"). Empty =
  // no handle. Source of truth for the attribution field at render.
  attribution: string;
  // Per-format toggle for whether the handle is stamped on that style's
  // slides. Absent key → use DEFAULT_ATTR_PRESETS.
  attrPresets: Record<string, boolean>;
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
        slideBgAdjust: (p.slideBgAdjust && typeof p.slideBgAdjust === 'object' ? p.slideBgAdjust : {}) as Record<string, CropValue>,
        caption: typeof p.caption === 'string' ? p.caption : '',
        preset: PRESET_KEYS.includes(p.preset as PresetKey) ? (p.preset as PresetKey) : 'prompt_pack',
        pexelsKey: typeof p.pexelsKey === 'string' ? p.pexelsKey : '',
        unsplashKey: typeof p.unsplashKey === 'string' ? p.unsplashKey : '',
        pixabayKey: typeof p.pixabayKey === 'string' ? p.pixabayKey : '',
        anthropicKey: typeof p.anthropicKey === 'string' ? p.anthropicKey : '',
        claudeModel: CLAUDE_MODEL_IDS.includes(p.claudeModel as ClaudeModelId)
          ? (p.claudeModel as ClaudeModelId)
          : 'claude-opus-4-7',
        openaiKey: typeof p.openaiKey === 'string' ? p.openaiKey : '',
        design: coerceDesign(p.design),
        nativeTextOverlay: p.nativeTextOverlay === true,
        attribution: typeof p.attribution === 'string' ? p.attribution : '',
        attrPresets: { ...DEFAULT_ATTR_PRESETS, ...(p.attrPresets && typeof p.attrPresets === 'object' ? p.attrPresets : {}) },
      };
    }
  } catch {}
  return {
    mascot: 'platinum',
    variant: 'base',
    platform: 'claude',
    jsonText: DEFAULT_JSON,
    slideBgs: {},
    slideBgAdjust: {},
    caption: '',
    preset: 'prompt_pack',
    pexelsKey: '',
    unsplashKey: '',
    pixabayKey: '',
    anthropicKey: '',
    claudeModel: 'claude-opus-4-7',
    openaiKey: '',
    design: { ...DEFAULT_DESIGN },
    nativeTextOverlay: false,
    attribution: '',
    attrPresets: { ...DEFAULT_ATTR_PRESETS },
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

const CONTENT_KEYS = ['hook', 'prompts', 'beats', 'panels', 'features', 'items', 'apps', 'tools', 'picks', 'tiers'];

// If someone pastes a whole clone / propose payload
// ({ preset, slides: {...}, caption, cloneAnalysis, bgAssignments }) into the
// JSON box, the real slide content lives under `slides` — unwrap to it so the
// engine doesn't render blank. A normal slides object (hook/prompts at the
// top level) is returned untouched.
function unwrapClonePayload(obj: unknown): unknown {
  if (!obj || typeof obj !== 'object') return obj;
  const o = obj as Record<string, unknown>;
  const hasContentTop = CONTENT_KEYS.some((k) => k in o);
  if (!hasContentTop && o.slides && typeof o.slides === 'object') {
    return o.slides;
  }
  return obj;
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
    tools?: { name?: string }[];
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
  if (Array.isArray(p.tools)) {
    p.tools.forEach((t, i) => {
      const n = clean(t?.name || `Tool ${i + 1}`);
      out.push({ key: `tool:${i}`, label: truncate(`${i + 1}. ${n}`, 40) });
      out.push({ key: `tool-logo:${i}`, label: truncate(`${i + 1}. ${n} · logo`, 40) });
    });
  }
  if (Array.isArray((p as { picks?: { headline?: string }[] }).picks)) {
    (p as { picks: { headline?: string }[] }).picks.forEach((pk, i) => {
      const t = clean(pk?.headline || `Item ${i + 1}`);
      out.push({ key: `pick:${i}`, label: truncate(`${i + 1}. ${t}`, 40) });
      out.push({ key: `pick-card:${i}`, label: truncate(`${i + 1}. ${t} · card`, 40) });
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

// True when the JSON box is empty or still holds one of the built-in
// example posts (i.e. the user hasn't done custom work yet). Lets us
// auto-swap examples on format change without a confirm, but still
// guard real edits. Caption has the same check.
function isExampleJson(txt: string): boolean {
  const t = txt.trim();
  if (!t) return true;
  if (t === DEFAULT_JSON.trim()) return true; // the first-run starter content
  return PRESET_KEYS.some((k) => PRESETS[k].defaultJson.trim() === t);
}
function isExampleCaption(txt: string): boolean {
  const t = txt.trim();
  if (!t) return true;
  return PRESET_KEYS.some((k) => PRESETS[k].defaultCaption.trim() === t);
}

// Collapsible sidebar group. Defined at module scope (stable identity)
// so toggling/typing elsewhere never remounts its children — important
// because some groups hold stateful panels and controlled inputs.
// Renders a clickable header (accent bar + label + chevron) and only
// mounts its body when expanded, so the sidebar reads as a short funnel.
function Group({
  open,
  onToggle,
  title,
  accent = '#00E5FF',
  suffix,
  hint,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  title: string;
  accent?: string;
  suffix?: ReactNode;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-white/[0.05]">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-5 md:px-10 py-4 md:py-5 text-left hover:bg-white/[0.02] transition-colors"
      >
        <span className="h-5 w-[5px] rounded-full shrink-0" style={{ background: accent }}></span>
        <span className="text-[13px] md:text-[14px] font-bold uppercase tracking-[0.20em] text-gray-300">
          {title}
        </span>
        {suffix}
        {hint && !open && <span className="text-[11px] text-gray-600 truncate">{hint}</span>}
        <svg
          className={'ml-auto shrink-0 text-gray-500 transition-transform duration-200 ' + (open ? 'rotate-180' : '')}
          viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && <div className="px-5 md:px-10 pb-6 md:pb-7 pt-1">{children}</div>}
    </section>
  );
}

export default function App() {
  const ui = useUI();
  const initial = useMemo(loadPersisted, []);
  const [mascot, setMascot] = useState<Mascot>(initial.mascot);
  const [variant, setVariant] = useState<string>(initial.variant);
  const [platform, setPlatform] = useState<Platform>(initial.platform);
  const [jsonText, setJsonText] = useState<string>(initial.jsonText);
  // Quick form vs raw JSON for the slides editor. Quick is the default so
  // most users never see JSON.
  const [editMode, setEditMode] = useState<'quick' | 'json'>('quick');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [mobileView, setMobileView] = useState<MobileView>('edit');
  const [mainView, setMainView] = useState<MainView>('preview');
  const [slideBgs, setSlideBgs] = useState<SlideBgMap>(initial.slideBgs);
  // Per-slide photo crop (pan + zoom), keyed by the same slide key as
  // slideBgs. Persisted with the rest of the workspace.
  const [slideBgAdjust, setSlideBgAdjust] = useState<Record<string, CropValue>>(initial.slideBgAdjust);
  const [openCropKey, setOpenCropKey] = useState<string | null>(null);
  const [caption, setCaption] = useState<string>(initial.caption);
  const [preset, setPreset] = useState<PresetKey>(initial.preset);
  const [pexelsKey, setPexelsKey] = useState<string>(initial.pexelsKey);
  const [pixabayKey, setPixabayKey] = useState<string>(initial.pixabayKey);
  const [unsplashKey, setUnsplashKey] = useState<string>(initial.unsplashKey);
  const [anthropicKey, setAnthropicKey] = useState<string>(initial.anthropicKey);
  const [claudeModel, setClaudeModel] = useState<ClaudeModelId>(initial.claudeModel);
  const [openaiKey, setOpenaiKey] = useState<string>(initial.openaiKey);
  const [design, setDesign] = useState<BrandDesign>(initial.design);
  const [nativeTextOverlay, setNativeTextOverlay] = useState<boolean>(initial.nativeTextOverlay);
  const [attribution, setAttribution] = useState<string>(initial.attribution);
  const [attrPresets, setAttrPresets] = useState<Record<string, boolean>>(initial.attrPresets);
  // Whether the handle is stamped on the currently-selected format.
  const attrOnThisPreset = attrPresets[preset] === true;
  // TikTok publish: the OAuth access token lives in its own localStorage key
  // (kept out of the bulky persisted state blob).
  const [ttToken, setTtToken] = useState<string>(() => {
    try { return localStorage.getItem('kiro_tiktok_token') || ''; } catch { return ''; }
  });
  const [ttStatus, setTtStatus] = useState<{ kind: 'idle' | 'connecting' | 'sending' | 'ok' | 'err'; msg?: string }>({ kind: 'idle' });
  // Phone handoff: QR to a hosted gallery of the exported slides.
  const [phoneBusy, setPhoneBusy] = useState<string | null>(null);
  const [phoneQr, setPhoneQr] = useState<{ img: string; url: string } | null>(null);
  const [phoneErr, setPhoneErr] = useState<string | null>(null);
  // Animated MP4/WebM export progress.
  const [videoBusy, setVideoBusy] = useState<string | null>(null);
  // Seconds per slide for the video export (pacing).
  const [videoPace, setVideoPace] = useState<number>(2.5);
  // PDF export (repurpose the deck as an IG / LinkedIn carousel).
  const [pdfBusy, setPdfBusy] = useState<string | null>(null);
  // Named drafts (multiple in-progress projects).
  const [drafts, setDrafts] = useState<Draft[]>(() => listDrafts());
  // Pre-publish quality checks, derived from the current JSON + caption.
  const prePublishChecks = useMemo(() => {
    let parsed: Record<string, unknown> | null = null;
    try { parsed = JSON.parse(stripJsonWrappers(jsonText.trim())) as Record<string, unknown>; } catch { /* invalid JSON shows as failed checks */ }
    const firstLine = (caption.split('\n')[0] || '').trim();
    const contentArr = parsed ? CONTENT_KEYS.map((k) => parsed![k]).find((v) => Array.isArray(v)) as unknown[] | undefined : undefined;
    const slideCount = (contentArr ? contentArr.length : 0) + (parsed && parsed.hook ? 1 : 0) + (parsed && parsed.cta ? 1 : 0);
    return [
      { label: 'Hook in caption’s first line', ok: firstLine.length > 0 && firstLine.length <= 100 },
      { label: 'Call-to-action slide present', ok: !!(parsed && parsed.cta) },
      { label: 'Hashtags in caption', ok: /#\w/.test(caption) },
      { label: 'Caption within 2,200 chars', ok: caption.length > 0 && caption.length <= 2200 },
      { label: '3+ slides (worth swiping)', ok: slideCount >= 3 },
    ];
  }, [jsonText, caption]);
  // "Fill from topic" — AI populates the current template from a typed topic.
  const [topic, setTopic] = useState('');
  const [topicBusy, setTopicBusy] = useState(false);
  const [improveBusy, setImproveBusy] = useState<string | null>(null);
  const [rewritingIndex, setRewritingIndex] = useState<number | null>(null);
  // Saved hashtag sets (reusable niche blocks).
  const [hashtagSets, setHashtagSets] = useState<HashtagSet[]>(() => listSets());
  // Batch generate — one draft per topic line.
  const [batchTopics, setBatchTopics] = useState('');
  const [batchBusy, setBatchBusy] = useState<string | null>(null);
  // Which collapsible sidebar groups are expanded. Everything outside the
  // core Format → Content → Caption spine is collapsed by default so the
  // panel reads as a simple "make a post" funnel instead of a wall of
  // controls. The user opens the extras (look, backgrounds, AI, settings)
  // only when they need them.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const toggleGroup = (id: string) => setOpenGroups((p) => ({ ...p, [id]: !p[id] }));
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
  const backupInputRef = useRef<HTMLInputElement | null>(null);
  const captionRef = useRef<HTMLTextAreaElement | null>(null);

  // Insert an emoji at the caption's cursor (or append if it isn't focused).
  function insertEmoji(emoji: string) {
    const el = captionRef.current;
    if (!el) {
      setCaption((c) => c + emoji);
      return;
    }
    const s = el.selectionStart ?? caption.length;
    const e = el.selectionEnd ?? caption.length;
    setCaption(caption.slice(0, s) + emoji + caption.slice(e));
    requestAnimationFrame(() => {
      el.focus();
      const pos = s + emoji.length;
      el.setSelectionRange(pos, pos);
    });
  }
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(shouldOnboard);
  // Number of slides the engine actually rendered — drives the navigator.
  const [slideCount, setSlideCount] = useState(0);

  function jumpToSlide(index: number) {
    iframeRef.current?.contentWindow?.postMessage({ type: 'scrollToSlide', index }, '*');
  }

  async function handleExportBackup() {
    try {
      const blob = await exportBackup();
      downloadBlob(blob, `iro-backup-${timestampSlug()}.json`);
      ui.notify('Backup exported.', { type: 'success' });
    } catch (e) {
      ui.notify('Export failed: ' + (e as Error).message, { type: 'error' });
    }
  }

  async function handleImportBackup(file: File) {
    if (!(await ui.confirm({ title: 'Restore backup', message: 'This merges saved posts + settings into this browser. Your API keys are kept.', confirmLabel: 'Restore' }))) return;
    try {
      const text = await file.text();
      const r = await importBackup(text);
      ui.notify(`Restored ${r.posts} post${r.posts === 1 ? '' : 's'}${r.settingsRestored ? ' + settings' : ''}. Reloading…`, { type: 'success' });
      setTimeout(() => window.location.reload(), 900);
    } catch (e) {
      ui.notify('Import failed: ' + (e as Error).message, { type: 'error' });
    }
  }

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
          slideBgAdjust,
          caption,
          preset,
          pexelsKey,
          pixabayKey,
          unsplashKey,
          anthropicKey,
          claudeModel,
          openaiKey,
          design,
          nativeTextOverlay,
          attribution,
          attrPresets,
        }),
      );
    } catch {}
  }, [
    mascot,
    variant,
    platform,
    jsonText,
    slideBgs,
    slideBgAdjust,
    caption,
    preset,
    pexelsKey,
    pixabayKey,
    unsplashKey,
    anthropicKey,
    claudeModel,
    openaiKey,
    design,
    nativeTextOverlay,
    attribution,
    attrPresets,
  ]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const msg = e.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'rendered') {
        setStatus({ kind: 'ok', at: Date.now() });
        if (typeof msg.slideCount === 'number') setSlideCount(msg.slideCount);
      }
      if (msg.type === 'error') setStatus({ kind: 'err', msg: String(msg.message || 'render failed') });
      // App Stack: the user dragged an icon+text cluster (or dblclicked to
      // change its layout) in the preview. The engine already shows it —
      // fold x/y/layout back into the JSON so the change survives the next
      // render and is persisted.
      if (msg.type === 'appLayout' && typeof msg.index === 'number') {
        setJsonText((prev) => {
          try {
            const o = JSON.parse(stripJsonWrappers(prev.trim())) as { apps?: Record<string, unknown>[] };
            if (Array.isArray(o.apps) && o.apps[msg.index]) {
              o.apps[msg.index] = { ...o.apps[msg.index], x: msg.x, y: msg.y, layout: msg.layout };
              return JSON.stringify(o, null, 2);
            }
          } catch {}
          return prev;
        });
      }
      // Curated List: the user dragged the heading/label/card (or the hook
      // title) in the preview. Fold the defined position fields back into
      // the JSON so the layout persists and survives re-renders.
      if (msg.type === 'curatedLayout' && typeof msg.key === 'string') {
        const m = msg as Record<string, unknown> & { key: string };
        const FIELDS = ['x', 'y', 'headX', 'headY', 'labelX', 'labelY', 'cardX', 'cardY', 'cardW'];
        setJsonText((prev) => {
          try {
            const o = JSON.parse(stripJsonWrappers(prev.trim())) as {
              hook?: Record<string, unknown>;
              picks?: Record<string, unknown>[];
            };
            const target = m.key === 'hook' ? o.hook : (Array.isArray(o.picks) ? o.picks[Number(m.key)] : undefined);
            if (!target) return prev;
            const patch: Record<string, unknown> = { ...target };
            for (const f of FIELDS) if (typeof m[f] === 'number') patch[f] = m[f];
            if (m.key === 'hook') o.hook = patch;
            else (o.picks as Record<string, unknown>[])[Number(m.key)] = patch;
            return JSON.stringify(o, null, 2);
          } catch {}
          return prev;
        });
      }
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
      return unwrapClonePayload(JSON.parse(stripped)) as Record<string, unknown>;
    } catch (e) {
      try {
        return unwrapClonePayload(new Function('return (' + stripped + ')')()) as Record<string, unknown>;
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

  // Tracks whether the engine has finished its first render, so the live
  // design effect doesn't post a design-only update before any slides exist.
  const engineReadyRef = useRef(false);

  // `switchView` defaults to true (a user-initiated render jumps mobile to
  // the Preview tab). The initial auto-render on iframe load passes false so
  // a phone user isn't yanked away from the Edit controls on first open.
  async function handleRender(opts?: { switchView?: boolean }) {
    const switchView = opts?.switchView !== false;
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

    // Creator handle: the HUD "Creator handle" field is the single source
    // of truth, so a blank field reliably removes the handle (overriding
    // any "@tryiro" left in older saved JSON). Only stamped on formats
    // toggled on for the handle (polished styles by default).
    slides.attribution = attrPresets[preset] === true ? attribution.trim() : '';

    // Per-photo crop adjustments, keyed by the resolved URL so the engine
    // can apply pan/zoom to that exact background.
    const bgAdjust: Record<string, { pos: string; zoom: number; ar?: number }> = {};
    const recordAdjust = (key: string, url: string | null) => {
      if (!url) return;
      const a = slideBgAdjust[key];
      if (a && (a.x !== 50 || a.y !== 50 || a.zoom !== 1)) {
        bgAdjust[url] = { pos: `${a.x}% ${a.y}%`, zoom: a.zoom, ar: a.ar };
      }
    };

    // Resolve and inject bg per-slide. Done in parallel so big slideshows with
    // multiple uploaded photos don't render serially.
    const hookBg = await resolveSlideBg(slideBgs['hook']);
    if (hookBg && slides.hook && typeof slides.hook === 'object') {
      slides.hook = { ...(slides.hook as object), bg: hookBg };
    }
    recordAdjust('hook', hookBg);
    const ctaBg = await resolveSlideBg(slideBgs['cta']);
    if (ctaBg && slides.cta && typeof slides.cta === 'object') {
      slides.cta = { ...(slides.cta as object), bg: ctaBg };
    }
    recordAdjust('cta', ctaBg);

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
      { field: 'tools', prefix: 'tool' },
      { field: 'picks', prefix: 'pick' },
      { field: 'tiers', prefix: 'tier' },
    ];
    for (const { field, prefix } of contentArrays) {
      const arr = slides[field];
      if (!Array.isArray(arr)) continue;
      slides[field] = await Promise.all(
        (arr as Record<string, unknown>[]).map(async (item, i) => {
          const bg = await resolveSlideBg(slideBgs[`${prefix}:${i}`]);
          recordAdjust(`${prefix}:${i}`, bg);
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

    // Resolve tool logos for output_vs_hype — same picker UX as app icons,
    // travels to the engine as `logoUrl` on each tool.
    if (Array.isArray(slides['tools'])) {
      slides['tools'] = await Promise.all(
        (slides['tools'] as Record<string, unknown>[]).map(async (item, i) => {
          const logoUrl = await resolveSlideBg(slideBgs[`tool-logo:${i}`]);
          return logoUrl ? { ...item, logoUrl } : item;
        }),
      );
    }

    // Resolve recommendation cards for curated_list — the second image on
    // each slide (book / podcast / app screenshot), as `cardUrl`.
    if (Array.isArray(slides['picks'])) {
      slides['picks'] = await Promise.all(
        (slides['picks'] as Record<string, unknown>[]).map(async (item, i) => {
          const cardUrl = await resolveSlideBg(slideBgs[`pick-card:${i}`]);
          return cardUrl ? { ...item, cardUrl } : item;
        }),
      );
    }

    slides.bgAdjust = bgAdjust;
    iframe.contentWindow.postMessage({ type: 'render', slides, design: designPayload(design) }, '*');
    engineReadyRef.current = true;
    // On a user-initiated render, jump to the preview so they see the result
    // (and flip desktop's main pane back from the Library). The initial
    // auto-render skips this so mobile users keep their place on Edit.
    if (switchView) {
      setMobileView('preview');
      setMainView('preview');
    }
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
    const url = await ui.prompt({ title: 'Paste image URL', message: 'Pinterest, any CDN, anywhere — we proxy it.', placeholder: 'https://…', confirmLabel: 'Add' });
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
      ui.notify(
        `Couldn't fetch that URL: ${(e as Error).message}. If the source has hotlink protection, save the image and use Upload instead.`,
        { type: 'error' },
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
    setSlideBgAdjust((prev) => {
      if (!prev[slideKey]) return prev;
      const next = { ...prev };
      delete next[slideKey];
      return next;
    });
    setOpenCropKey((k) => (k === slideKey ? null : k));
  }

  // Per-tool media (logo + optional background) is keyed by slide index in
  // slideBgs, but the tool's name/values live in the JSON. So when the
  // Output vs Hype editor reorders or removes a tool, we have to move the
  // index-keyed media in lockstep — otherwise the logo/background would
  // stay on the old row while everything else shifts.
  const TOOL_BG_PREFIXES = ['tool', 'tool-logo'];
  function swapToolBgs(from: number, to: number) {
    setSlideBgs((prev) => {
      const next = { ...prev };
      for (const p of TOOL_BG_PREFIXES) {
        const ka = `${p}:${from}`;
        const kb = `${p}:${to}`;
        const va = next[ka];
        const vb = next[kb];
        if (vb !== undefined) next[ka] = vb; else delete next[ka];
        if (va !== undefined) next[kb] = va; else delete next[kb];
      }
      return next;
    });
  }
  function shiftToolBgsAfterRemove(idx: number, count: number) {
    setSlideBgs((prev) => {
      const next = { ...prev };
      for (const p of TOOL_BG_PREFIXES) {
        for (let k = idx; k < count - 1; k++) {
          const cur = `${p}:${k}`;
          const nxt = `${p}:${k + 1}`;
          if (next[nxt] !== undefined) next[cur] = next[nxt]; else delete next[cur];
        }
        delete next[`${p}:${count - 1}`];
      }
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
  // Append the account's best-performing hashtags (that aren't already in
  // the caption) — mined from scored history.
  async function handleSuggestHashtags() {
    const posts = await listPosts();
    const tags = suggestHashtags(caption, posts, 6);
    if (tags.length === 0) {
      ui.notify('No proven hashtags yet — score a few posts in the Stats tab first.', { type: 'info' });
      return;
    }
    const add = tags.map((t) => '#' + t).join(' ');
    setCaption((prev) => (prev.trim() ? prev.trimEnd() + '\n\n' + add : add));
  }

  // ---- Saved hashtag sets ----
  async function handleSaveHashtagSet() {
    const tags = parseHashtags(caption);
    if (!tags.length) { ui.notify('Add some #hashtags to the caption first.', { type: 'info' }); return; }
    const name = await ui.prompt({ title: 'Save hashtag set', message: `Name this set of ${tags.length} tags.`, placeholder: 'e.g. AI niche', confirmLabel: 'Save' });
    if (!name || !name.trim()) return;
    setHashtagSets(saveSet(name, tags));
    ui.notify('Hashtag set saved.', { type: 'success' });
  }
  function handleInsertHashtagSet(s: HashtagSet) {
    const add = formatTags(s.tags);
    setCaption((prev) => {
      const has = new Set(parseHashtags(prev).map((t) => t.toLowerCase()));
      const fresh = s.tags.filter((t) => !has.has(t.toLowerCase()));
      if (!fresh.length) return prev;
      const block = formatTags(fresh);
      return prev.trim() ? prev.trimEnd() + (/#\w/.test(prev) ? ' ' : '\n\n') + block : add;
    });
  }

  // Write a fresh caption + hashtags with Claude from the current slide
  // content. Learns the user's voice from their recent saved captions.
  const [captionAiBusy, setCaptionAiBusy] = useState(false);
  const [captionTone, setCaptionTone] = useState('Auto');
  const [translateLang, setTranslateLang] = useState('Spanish');
  const [translateBusy, setTranslateBusy] = useState(false);

  // Translate the current caption into another language for a different
  // audience. Save as a draft afterward to keep one post per market.
  async function handleTranslateCaption() {
    if (!caption.trim()) { ui.notify('Write a caption first.', { type: 'info' }); return; }
    if (!anthropicKey) { ui.notify('Add an Anthropic API key in Settings to translate.', { type: 'error' }); return; }
    if (!(await ui.confirm({ message: `Translate the caption to ${translateLang}? (tip: Save as a draft first to keep the original.)`, confirmLabel: 'Translate' }))) return;
    setTranslateBusy(true);
    try {
      const { translateCaption } = await import('./captionAI');
      const out = await translateCaption({ caption, language: translateLang, apiKey: anthropicKey, model: claudeModel });
      setCaption(out);
      ui.notify(`Translated to ${translateLang}.`, { type: 'success' });
    } catch (e) {
      ui.notify(`Translation failed: ${(e as Error).message}`, { type: 'error' });
    } finally {
      setTranslateBusy(false);
    }
  }

  async function handleAiCaption() {
    if (!anthropicKey) {
      ui.notify('Add an Anthropic API key in Settings to use AI captions.', { type: 'error' });
      return;
    }
    if (caption.trim() && !(await ui.confirm({ message: 'Replace the current caption with an AI-written one?', confirmLabel: 'Write it' }))) return;
    setCaptionAiBusy(true);
    try {
      const { generateCaption, composeCaption } = await import('./captionAI');
      const posts = await listPosts();
      const examples = posts.map((p) => p.caption).filter((c) => c && c.trim().length > 10).slice(0, 4);
      const { caption: body, hashtags } = await generateCaption({
        json: jsonText, preset, apiKey: anthropicKey, model: claudeModel, examples,
        tone: captionTone === 'Auto' ? undefined : captionTone,
      });
      setCaption(composeCaption(body, hashtags));
      ui.notify('Caption written.', { type: 'success' });
    } catch (e) {
      ui.notify(`AI caption failed: ${(e as Error).message}`, { type: 'error' });
    } finally {
      setCaptionAiBusy(false);
    }
  }

  // Apply an A/B variation from the Predict panel: swap the caption and
  // patch the hook headline into the slides JSON, then return to Edit.
  function handleApplyVariant({ hookHeadline, caption: cap }: { hookHeadline: string; caption: string }) {
    setCaption(cap);
    const parsed = parseJson(true);
    if (parsed && typeof parsed === 'object') {
      const hook = (parsed as Record<string, unknown>).hook;
      if (hook && typeof hook === 'object') {
        (hook as Record<string, unknown>).headline = hookHeadline;
        setJsonText(JSON.stringify(parsed, null, 2));
      }
    }
    setMainView('preview');
    setMobileView('edit');
    ui.notify('Variation applied — hit Render to preview it.', { type: 'success' });
  }

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
      ui.notify('Pick an image file.', { type: 'error' });
      return;
    }
    try {
      await saveAndAssignBlob(slideKey, file, file.name || `slide-${slideKey}`);
    } catch (e) {
      ui.notify(`Upload failed: ${(e as Error).message}`, { type: 'error' });
    }
  }

  // Reads the system clipboard, finds the first image item, saves it
  // as this slide's bg. Requires the page to be focused; modern
  // browsers prompt for clipboard-read permission on first use.
  async function handlePasteImageForSlide(slideKey: string) {
    if (typeof navigator === 'undefined' || !navigator.clipboard || !('read' in navigator.clipboard)) {
      ui.notify('Your browser doesn\'t allow reading images from the clipboard. Use Upload instead.', { type: 'error' });
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
      ui.notify('No image found on the clipboard. Copy an image first, then try again.', { type: 'info' });
    } catch (e) {
      // Permissions denied / no user gesture / unsupported MIME — surface a
      // clear message rather than silently failing.
      ui.notify(`Could not read clipboard: ${(e as Error).message}`, { type: 'error' });
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

  // Ask the engine to render every slide to a JPEG data URL and ship them
  // back. Used by the "Send to TikTok" flow. Resolves [] on timeout.
  function captureTikTokSlides(): Promise<string[]> {
    return new Promise((resolve) => {
      const iframe = iframeRef.current;
      if (!iframe || !iframe.contentWindow) { resolve([]); return; }
      const requestId = Math.random().toString(36).slice(2);
      const onMessage = (e: MessageEvent) => {
        const m = e.data as { type?: string; requestId?: string; slides?: string[] };
        if (!m || m.type !== 'tiktokSlides' || m.requestId !== requestId) return;
        window.removeEventListener('message', onMessage);
        clearTimeout(timer);
        resolve(Array.isArray(m.slides) ? m.slides : []);
      };
      window.addEventListener('message', onMessage);
      const timer = setTimeout(() => { window.removeEventListener('message', onMessage); resolve([]); }, 60000);
      iframe.contentWindow.postMessage({ type: 'capture-tiktok', requestId }, '*');
    });
  }

  // OAuth-connect a TikTok account via a popup. The /api/tiktok/callback
  // page postMessages the access token back to us.
  async function connectTikTok(): Promise<boolean> {
    setTtStatus({ kind: 'connecting', msg: 'Opening TikTok…' });
    try {
      const r = await fetch('/api/tiktok/auth-url');
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'TikTok is not configured on this deployment.');
      const popup = window.open(d.url, 'tiktok-auth', 'width=560,height=760');
      const token = await new Promise<string>((resolve, reject) => {
        const onMsg = (e: MessageEvent) => {
          if (e.origin !== window.location.origin) return;
          const m = e.data as { type?: string; ok?: boolean; accessToken?: string; error?: string };
          if (!m || m.type !== 'tiktok-auth') return;
          window.removeEventListener('message', onMsg);
          clearInterval(iv);
          if (m.ok && m.accessToken) resolve(m.accessToken);
          else reject(new Error(m.error || 'Authorization failed.'));
        };
        window.addEventListener('message', onMsg);
        const iv = setInterval(() => {
          if (popup && popup.closed) { clearInterval(iv); window.removeEventListener('message', onMsg); reject(new Error('Window closed before authorizing.')); }
        }, 800);
      });
      setTtToken(token);
      try { localStorage.setItem('kiro_tiktok_token', token); } catch {}
      setTtStatus({ kind: 'ok', msg: 'TikTok connected.' });
      return true;
    } catch (e) {
      setTtStatus({ kind: 'err', msg: (e as Error).message });
      return false;
    }
  }

  function disconnectTikTok() {
    setTtToken('');
    try { localStorage.removeItem('kiro_tiktok_token'); } catch {}
    setTtStatus({ kind: 'idle' });
  }

  // Capture → upload each slide → push to the account's TikTok inbox.
  async function sendToTikTok() {
    let token = ttToken;
    if (!token) { const ok = await connectTikTok(); if (!ok) return; token = (localStorage.getItem('kiro_tiktok_token') || ''); if (!token) return; }
    setTtStatus({ kind: 'sending', msg: 'Capturing slides…' });
    try {
      const slides = await captureTikTokSlides();
      if (!slides.length) throw new Error('No slides captured. Hit Render first, then try again.');
      const mediaUrls: string[] = [];
      for (let i = 0; i < slides.length; i++) {
        setTtStatus({ kind: 'sending', msg: `Uploading slide ${i + 1} / ${slides.length}…` });
        const up = await fetch('/api/tiktok/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataUrl: slides[i] }) });
        const ud = await up.json();
        if (!up.ok) throw new Error(ud.error || 'Slide upload failed.');
        mediaUrls.push(ud.mediaUrl);
      }
      setTtStatus({ kind: 'sending', msg: 'Sending to your TikTok inbox…' });
      const pr = await fetch('/api/tiktok/post', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accessToken: token, mediaUrls, caption }) });
      const pd = await pr.json();
      if (!pr.ok) {
        if (pr.status === 401 || pd.code === 'access_token_invalid') disconnectTikTok();
        throw new Error(pd.error || 'TikTok rejected the post.');
      }
      setTtStatus({ kind: 'ok', msg: 'Sent! Open TikTok → notifications/inbox to finish posting.' });
    } catch (e) {
      setTtStatus({ kind: 'err', msg: (e as Error).message });
    }
  }

  // Capture → upload → publish a mobile gallery page → show a QR so the user
  // opens it on their phone and long-presses each slide to save to Photos.
  async function handlePhoneHandoff() {
    setPhoneErr(null);
    setPhoneBusy('Capturing slides…');
    try {
      const slides = await captureTikTokSlides();
      if (!slides.length) throw new Error('No slides captured. Hit Render first, then try again.');
      const blobUrls: string[] = [];
      for (let i = 0; i < slides.length; i++) {
        setPhoneBusy(`Uploading slide ${i + 1} / ${slides.length}…`);
        const up = await fetch('/api/tiktok/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataUrl: slides[i] }) });
        const ud = await up.json();
        if (!up.ok) throw new Error(ud.error || 'Slide upload failed.');
        blobUrls.push(ud.blobUrl);
      }
      setPhoneBusy('Building your phone page…');
      const gr = await fetch('/api/gallery', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ images: blobUrls, caption }) });
      const gd = await gr.json();
      if (!gr.ok) throw new Error(gd.error || 'Could not publish the gallery.');
      const QRCode = (await import('qrcode')).default;
      const img = await QRCode.toDataURL(gd.url, { width: 460, margin: 2, color: { dark: '#0a0e1a', light: '#ffffff' } });
      setPhoneQr({ img, url: gd.url });
    } catch (e) {
      setPhoneErr((e as Error).message);
    } finally {
      setPhoneBusy(null);
    }
  }

  // Ask the engine to render the deck to a Ken-Burns video and download it.
  function handleExportVideo() {
    const iframe = iframeRef.current;
    if (!iframe || !iframe.contentWindow) { ui.notify('Engine not ready.', { type: 'error' }); return; }
    setVideoBusy('Starting…');
    const requestId = Math.random().toString(36).slice(2);
    const onMessage = (e: MessageEvent) => {
      const m = e.data as { type?: string; requestId?: string; progress?: number; blob?: Blob; mime?: string; error?: string };
      if (!m || m.requestId !== requestId) return;
      if (m.type === 'videoProgress') {
        setVideoBusy(`Rendering… ${Math.round((m.progress || 0) * 100)}%`);
        return;
      }
      if (m.type === 'videoBlob') {
        window.removeEventListener('message', onMessage);
        clearTimeout(timer);
        setVideoBusy(null);
        if (m.error || !(m.blob instanceof Blob)) {
          ui.notify(`Video export failed: ${m.error || 'no data'}`, { type: 'error' });
          return;
        }
        const ext = (m.mime || '').includes('mp4') ? 'mp4' : 'webm';
        const url = URL.createObjectURL(m.blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `iro_${timestampSlug()}.${ext}`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        ui.notify('Video downloaded.', { type: 'success' });
      }
    };
    window.addEventListener('message', onMessage);
    // Generous timeout — real-time recording of a long deck can take a while.
    const timer = setTimeout(() => { window.removeEventListener('message', onMessage); setVideoBusy(null); ui.notify('Video export timed out.', { type: 'error' }); }, 180000);
    iframe.contentWindow.postMessage({ type: 'capture-video', requestId, secondsPerSlide: videoPace }, '*');
  }

  // Capture the slides and assemble a multi-page PDF (one slide per page at
  // 1080×1920) — handy for repurposing the deck as an Instagram / LinkedIn
  // carousel, or just archiving it.
  async function handleExportPdf() {
    setPdfBusy('Capturing slides…');
    try {
      const slides = await captureTikTokSlides();
      if (!slides.length) throw new Error('No slides captured. Hit Render first.');
      setPdfBusy('Building PDF…');
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF({ unit: 'px', format: [1080, 1920], orientation: 'portrait' });
      slides.forEach((dataUrl, i) => {
        if (i > 0) doc.addPage([1080, 1920], 'portrait');
        doc.addImage(dataUrl, 'JPEG', 0, 0, 1080, 1920);
      });
      doc.save(`iro_${timestampSlug()}.pdf`);
      ui.notify('PDF downloaded.', { type: 'success' });
    } catch (e) {
      ui.notify(`PDF export failed: ${(e as Error).message}`, { type: 'error' });
    } finally {
      setPdfBusy(null);
    }
  }

  // Fill the current template's JSON from a one-line topic, via Claude.
  async function handleFillFromTopic() {
    const t = topic.trim();
    if (!t) return;
    if (!anthropicKey) { ui.notify('Add an Anthropic API key in Settings to use this.', { type: 'error' }); return; }
    if (!isExampleJson(jsonText) && !(await ui.confirm({ message: 'Replace the current content with an AI-filled version?', confirmLabel: 'Generate' }))) return;
    setTopicBusy(true);
    try {
      const { generateFromTopic } = await import('./fillFromTopic');
      const filled = await generateFromTopic({
        topic: t, preset, exampleJson: PRESETS[preset].defaultJson, apiKey: anthropicKey, model: claudeModel,
      });
      setJsonText(filled);
      setTimeout(() => void handleRender({ switchView: false }), 80);
      ui.notify('Content generated.', { type: 'success' });
    } catch (e) {
      ui.notify(`Generation failed: ${(e as Error).message}`, { type: 'error' });
    } finally {
      setTopicBusy(false);
    }
  }

  // Rewrite the current post's content per a quick instruction.
  async function handleImprovePost(label: string, instruction: string) {
    if (!anthropicKey) { ui.notify('Add an Anthropic API key in Settings to use this.', { type: 'error' }); return; }
    const parsedNow = parseJson(true);
    if (!parsedNow) { ui.notify('Fix the JSON first.', { type: 'error' }); return; }
    setImproveBusy(label);
    try {
      const { improvePost } = await import('./fillFromTopic');
      const revised = await improvePost({ json: jsonText, instruction, apiKey: anthropicKey, model: claudeModel });
      setJsonText(revised);
      setTimeout(() => void handleRender({ switchView: false }), 80);
      ui.notify(`Rewritten: ${label}.`, { type: 'success' });
    } catch (e) {
      ui.notify(`Rewrite failed: ${(e as Error).message}`, { type: 'error' });
    } finally {
      setImproveBusy(null);
    }
  }

  // Rewrite a single content item (slide) with AI — wired into QuickEdit.
  async function handleRewriteItem(index: number) {
    if (!anthropicKey) { ui.notify('Add an Anthropic API key in Settings to use this.', { type: 'error' }); return; }
    const parsed = parseJson(true);
    if (!parsed) { ui.notify('Fix the JSON first.', { type: 'error' }); return; }
    const key = CONTENT_KEYS.find((k) => Array.isArray((parsed as Record<string, unknown>)[k]));
    if (!key) return;
    const arr = ((parsed as Record<string, unknown>)[key] as Record<string, unknown>[]).slice();
    if (!arr[index]) return;
    setRewritingIndex(index);
    try {
      const { rewriteItem } = await import('./fillFromTopic');
      const revised = JSON.parse(await rewriteItem({ itemJson: JSON.stringify(arr[index]), preset, apiKey: anthropicKey, model: claudeModel }));
      arr[index] = revised;
      (parsed as Record<string, unknown>)[key] = arr;
      setJsonText(JSON.stringify(parsed, null, 2));
      setTimeout(() => void handleRender({ switchView: false }), 80);
      ui.notify(`Slide ${index + 1} rewritten.`, { type: 'success' });
    } catch (e) {
      ui.notify(`Rewrite failed: ${(e as Error).message}`, { type: 'error' });
    } finally {
      setRewritingIndex(null);
    }
  }

  // Batch-generate a draft per topic line — for spinning up a week of content
  // in one go. Reuses fill-from-topic + the drafts store.
  async function handleBatchGenerate() {
    const lines = batchTopics.split('\n').map((s) => s.trim()).filter(Boolean);
    if (!lines.length) return;
    if (!anthropicKey) { ui.notify('Add an Anthropic API key in Settings to use this.', { type: 'error' }); return; }
    setBatchBusy(`Generating 0 / ${lines.length}…`);
    try {
      const { generateFromTopic } = await import('./fillFromTopic');
      let made = 0; let failed = 0; let next = drafts;
      for (let i = 0; i < lines.length; i++) {
        setBatchBusy(`Generating ${i + 1} / ${lines.length}…`);
        try {
          const filled = await generateFromTopic({ topic: lines[i], preset, exampleJson: PRESETS[preset].defaultJson, apiKey: anthropicKey, model: claudeModel });
          next = saveDraft(lines[i].slice(0, 48), { jsonText: filled, caption: '', preset, slideBgs: {}, slideBgAdjust: {}, attribution, attrPresets });
          made++;
        } catch { failed++; }
      }
      setDrafts(next);
      setBatchTopics('');
      ui.notify(`Saved ${made} draft${made === 1 ? '' : 's'}${failed ? `, ${failed} failed` : ''}. Open them in Drafts.`, { type: failed && !made ? 'error' : 'success' });
    } finally {
      setBatchBusy(null);
    }
  }

  // Apply (or clear) a built-in gradient as the shared slide background by
  // setting the JSON's top-level `background`. The engine paints any bg that
  // is a CSS gradient string directly — no photo or API needed. Applies to
  // formats that fall back to the shared background.
  const currentBgGradient = useMemo(() => {
    try {
      const v = (JSON.parse(stripJsonWrappers(jsonText.trim())) as Record<string, unknown>).background;
      return typeof v === 'string' && /-gradient\(/.test(v) ? v : null;
    } catch { return null; }
  }, [jsonText]);

  function applyGlobalGradient(css: string | null) {
    const parsed = parseJson(true);
    if (!parsed) { ui.notify('Fix the JSON first.', { type: 'error' }); return; }
    if (css) parsed.background = css; else delete parsed.background;
    setJsonText(JSON.stringify(parsed, null, 2));
    setTimeout(() => void handleRender({ switchView: false }), 60);
  }

  // ---- Share a single post as a portable code ----
  async function handleSharePost() {
    const code = encodePost({ preset, json: jsonText, caption });
    try {
      await navigator.clipboard.writeText(code);
      ui.notify('Post code copied — send it to a friend to import.', { type: 'success' });
    } catch {
      await ui.prompt({ title: 'Post code', message: 'Copy this and send it:', placeholder: '', confirmLabel: 'Done', defaultValue: code });
    }
  }
  async function handleImportPost() {
    const code = await ui.prompt({ title: 'Import a post', message: 'Paste a post code (starts with IRO1:).', placeholder: 'IRO1:…', confirmLabel: 'Import' });
    if (!code || !code.trim()) return;
    const decoded = decodePost(code);
    if (!decoded) { ui.notify('That code is not valid.', { type: 'error' }); return; }
    if (!isExampleJson(jsonText) && !(await ui.confirm({ message: 'Importing replaces your current post. Continue?', confirmLabel: 'Import' }))) return;
    setJsonText(decoded.json);
    setCaption(decoded.caption);
    if (decoded.preset && (PRESET_KEYS as readonly string[]).includes(decoded.preset)) setPreset(decoded.preset as PresetKey);
    setTimeout(() => void handleRender({ switchView: false }), 80);
    ui.notify('Post imported.', { type: 'success' });
  }

  // ---- Drafts (named in-progress projects) ----
  async function handleSaveDraft() {
    const name = await ui.prompt({ title: 'Save draft', message: 'Name this project (re-using a name overwrites it).', placeholder: 'e.g. Monday prompt pack', confirmLabel: 'Save' });
    if (!name || !name.trim()) return;
    setDrafts(saveDraft(name, { jsonText, caption, preset, slideBgs, slideBgAdjust, attribution, attrPresets }));
    ui.notify('Draft saved.', { type: 'success' });
  }

  async function handleLoadDraft(d: Draft) {
    if (!isExampleJson(jsonText) && !(await ui.confirm({ message: `Load "${d.name}"? Your current unsaved edits will be replaced.`, confirmLabel: 'Load' }))) return;
    const s = d.state;
    setJsonText(s.jsonText);
    setCaption(s.caption || '');
    if (s.preset && (PRESET_KEYS as readonly string[]).includes(s.preset)) setPreset(s.preset as PresetKey);
    setSlideBgs((s.slideBgs || {}) as SlideBgMap);
    setSlideBgAdjust((s.slideBgAdjust || {}) as Record<string, CropValue>);
    setAttribution(s.attribution || '');
    if (s.attrPresets) setAttrPresets(s.attrPresets);
    setTimeout(() => void handleRender({ switchView: false }), 80);
    ui.notify(`Loaded "${d.name}".`, { type: 'success' });
  }

  async function handleDeleteDraft(d: Draft) {
    if (!(await ui.confirm({ message: `Delete draft "${d.name}"?`, confirmLabel: 'Delete' }))) return;
    setDrafts(deleteDraft(d.id));
  }

  async function handleSaveToHistory() {
    if (!caption.trim() && !(await ui.confirm({ message: 'Save this post with no caption?', confirmLabel: 'Save' }))) return;
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
    // switchView:false so a phone user isn't bounced off the Edit tab.
    handleRender({ switchView: false });
  }

  // Live design preview: when the brand kit / aspect / watermark changes,
  // push a lightweight design-only update to the engine (debounced so a
  // color drag doesn't spam it). No content re-resolution — just re-theme.
  useEffect(() => {
    if (!engineReadyRef.current) return;
    const id = setTimeout(() => {
      const iframe = iframeRef.current;
      iframe?.contentWindow?.postMessage({ type: 'design', design: designPayload(design) }, '*');
    }, 200);
    return () => clearTimeout(id);
  }, [design]);

  // ⌘/Ctrl+Enter renders from anywhere. renderRef keeps the handler current
  // without re-binding the listener every render.
  const renderRef = useRef(handleRender);
  renderRef.current = handleRender;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        void renderRef.current();
      } else if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Picking a format chip loads that format's example post into the
  // content + JSON editors and the caption, so the user can choose a
  // template and immediately have something to tweak. We only confirm
  // when the current content/caption is custom (not a built-in example
  // and not empty), so the common "browse the templates" flow stays
  // one tap. Re-tapping the active format with its example already
  // loaded is a no-op. Note: the sidebar preset overrides the JSON's
  // own `preset` at render, so each format must load its matching
  // example or the engine would render mismatched content.
  async function selectFormat(key: PresetKey) {
    if (key === preset && isExampleJson(jsonText)) return;
    const dirty = !isExampleJson(jsonText) || !isExampleCaption(caption);
    if (dirty) {
      const ok = await ui.confirm({
        message: `Load the ${PRESETS[key].label} example post? This replaces your current content and caption.`,
        confirmLabel: 'Load example',
      });
      if (!ok) return;
    }
    setPreset(key);
    setJsonText(PRESETS[key].defaultJson);
    setCaption(PRESETS[key].defaultCaption);
  }

  // Command palette entries, rebuilt when the bits they reference change.
  const commands = useMemo<Command[]>(() => {
    const goto = (main: MainView, mobile: MobileView): (() => void) => () => {
      setMainView(main);
      setMobileView(mobile);
    };
    const list: Command[] = [
      { id: 'render', section: 'Actions', label: 'Render slides', hint: '⌘↵', keywords: 'preview build', run: () => void renderRef.current() },
      { id: 'save', section: 'Actions', label: 'Save to history', keywords: 'post track', run: () => void handleSaveToHistory() },
      { id: 'hashtags', section: 'Actions', label: 'Suggest hashtags', keywords: 'tags caption', run: () => void handleSuggestHashtags() },
      { id: 'copycap', section: 'Actions', label: 'Copy caption', run: () => { if (caption) void navigator.clipboard?.writeText(caption); } },
      { id: 'loaddefault', section: 'Actions', label: `Load ${PRESETS[preset].label} example post`, keywords: 'reset template default', run: () => { setJsonText(PRESETS[preset].defaultJson); setCaption(PRESETS[preset].defaultCaption); } },
      { id: 'toggle-edit', section: 'Actions', label: `Switch editor to ${editMode === 'quick' ? 'JSON' : 'Quick edit'}`, run: () => setEditMode((m) => (m === 'quick' ? 'json' : 'quick')) },
      { id: 'export-backup', section: 'Actions', label: 'Export backup', keywords: 'download save data', run: () => void handleExportBackup() },
      { id: 'welcome', section: 'Actions', label: 'Show welcome / how it works', keywords: 'help onboarding guide', run: () => setShowOnboarding(true) },
      { id: 'go-edit', section: 'Go to', label: 'Edit', run: goto('preview', 'edit') },
      { id: 'go-preview', section: 'Go to', label: 'Preview', run: goto('preview', 'preview') },
      { id: 'go-lib', section: 'Go to', label: 'Media Bank', keywords: 'library photos', run: goto('library', 'library') },
      { id: 'go-patterns', section: 'Go to', label: 'Patterns', run: goto('patterns', 'patterns') },
      { id: 'go-stats', section: 'Go to', label: 'Performance', keywords: 'analytics stats scores', run: goto('analytics', 'analytics') },
    ];
    for (const k of PRESET_KEYS) {
      list.push({ id: `fmt-${k}`, section: 'Format', label: `Format: ${PRESETS[k].label}`, keywords: 'preset template example', run: () => void selectFormat(k) });
    }
    for (const k of ASPECT_KEYS) {
      list.push({ id: `asp-${k}`, section: 'Aspect ratio', label: `Aspect: ${k} (${ASPECTS[k].sub})`, keywords: 'size resize', run: () => setDesign((d) => ({ ...d, aspect: k })) });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, editMode, caption, jsonText]);

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
      ui.notify('Add an OpenAI API key under Settings to use AI-edit.', { type: 'info' });
      return;
    }
    const bg = slideBgs[slideKey];
    if (!bg || bg.type !== 'media') {
      ui.notify('AI-edit works on backgrounds from the Library or a TikTok clone. Assign one first.', { type: 'info' });
      return;
    }
    const item = await getItem(bg.mediaId);
    if (!item) {
      ui.notify('Could not load the source image for that slide.', { type: 'error' });
      return;
    }
    const qualityRaw = await ui.prompt({ title: 'AI-edit quality', message: 'low ≈ $0.04 · medium ≈ $0.07 · high ≈ $0.19', defaultValue: 'medium', confirmLabel: 'Generate' });
    if (qualityRaw === null) return;
    const quality = qualityRaw.trim().toLowerCase() as OpenAIImageQuality;
    if (!['low', 'medium', 'high'].includes(quality)) {
      ui.notify('Enter low, medium, or high.', { type: 'error' });
      return;
    }

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
      ui.notify('AI-edit applied.', { type: 'success' });
    } catch (e) {
      const msg = e instanceof OpenAIImageError ? e.message : (e as Error).message || 'AI-edit failed.';
      ui.notify(`AI-edit failed: ${msg}`, { type: 'error' });
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
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              title="Command palette"
              className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-white/10 bg-white/[0.03] text-gray-400 hover:text-[#00E5FF] hover:border-[#00E5FF]/40 transition-colors"
            >
              <span className="text-[11px]">Commands</span>
              <kbd className="text-[10px] font-mono bg-white/[0.06] rounded px-1 py-0.5">⌘K</kbd>
            </button>
          </div>
          <p className="mt-3 md:mt-4 text-[12px] md:text-[13px] text-gray-500 leading-relaxed">
            Pick a format. Paste content. Render.
          </p>
        </header>

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          <Group open={!!openGroups.ai} onToggle={() => toggleGroup('ai')} title="AI assist" accent="#A78BFA" hint="Clone · Propose · Predict · Design">
            <div className="flex flex-col gap-3">
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
              onApplyVariant={handleApplyVariant}
            />
            <DesignPanel design={design} onChange={setDesign} />
            {lastCloneNote && (
              <div className="text-[11px] text-gray-500 leading-relaxed">
                <strong className="text-gray-400">Last {lastOrigin}:</strong> {lastCloneNote}
              </div>
            )}
            </div>
          </Group>

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
                    onClick={() => void selectFormat(key)}
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
            <p className="mt-1 text-[11px] text-gray-600 leading-relaxed">Tap a format to drop its example post into the editor and caption — then tweak and render.</p>
            <button
              type="button"
              onClick={async () => {
                if (!isExampleJson(jsonText) && !(await ui.confirm({ message: `Reset the content and caption to the ${PRESETS[preset].label} example?`, confirmLabel: 'Reset' }))) return;
                setJsonText(PRESETS[preset].defaultJson);
                setCaption(PRESETS[preset].defaultCaption);
              }}
              className="mt-3 text-[11px] font-bold uppercase tracking-[0.14em] text-gray-500 hover:text-[#00E5FF]"
            >
              Reset to {PRESETS[preset].label} example post →
            </button>
          </section>

          <Group open={!!openGroups.mascot} onToggle={() => toggleGroup('mascot')} title="Mascot" hint={mascot}>
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
          </Group>

          <Group open={!!openGroups.emote} onToggle={() => toggleGroup('emote')} title="Emote" hint={variant + ' · ' + mascot}>
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
          </Group>

          <Group open={!!openGroups.platform} onToggle={() => toggleGroup('platform')} title="Chat platform" hint={platform === 'claude' ? 'Claude' : 'ChatGPT'}>
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
          </Group>

          <section className="px-5 md:px-10 py-6 md:py-7 border-b border-white/[0.04]">
            {sectionLabel(
              'Content',
              <div className="ml-auto flex gap-1 p-0.5 rounded-lg bg-black/30 border border-white/[0.05]">
                {(['quick', 'json'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setEditMode(m)}
                    className={
                      'px-3 py-1 rounded-md text-[10px] font-bold uppercase tracking-[0.14em] transition-colors ' +
                      (editMode === m ? 'bg-[#00E5FF]/15 text-[#00E5FF]' : 'text-gray-500 hover:text-gray-300')
                    }
                  >
                    {m === 'quick' ? 'Quick edit' : 'JSON'}
                  </button>
                ))}
              </div>,
            )}

            {/* AI "fill from topic": populate the current format's content
               from a one-line idea. */}
            <div className="flex gap-2 mb-4">
              <input
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleFillFromTopic(); }}
                placeholder={`✨ Fill this ${PRESETS[preset].label} from a topic…`}
                className="flex-1 min-w-0 bg-[#070b18] border border-white/[0.10] rounded-lg px-3 py-2.5 text-[13px] text-gray-200 placeholder:text-gray-600 focus:border-[#A78BFA]/50 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void handleFillFromTopic()}
                disabled={topicBusy || !topic.trim()}
                className="shrink-0 px-4 py-2.5 rounded-lg text-[12px] font-bold uppercase tracking-[0.1em]
                           bg-gradient-to-r from-[#A78BFA] to-[#7C5CFC] text-white
                           disabled:opacity-50 disabled:cursor-not-allowed hover:brightness-110 transition-all"
              >
                {topicBusy ? '…' : 'Generate'}
              </button>
            </div>

            {/* One-tap AI rewrites of the current content. */}
            <div className="flex items-center gap-1.5 mb-4 flex-wrap">
              <span className="text-[10px] uppercase tracking-[0.12em] text-gray-600 mr-0.5">Improve</span>
              {([
                ['Punchier', 'Make every line punchier and more scroll-stopping; tighten wordy phrases.'],
                ['Simpler', 'Simplify the language so a beginner instantly gets it; cut jargon.'],
                ['Spicier', 'Make it bolder and more opinionated/controversial (still true and on-brand).'],
                ['Shorter', 'Cut each piece of text to the essential words; keep it skimmable.'],
              ] as const).map(([label, instruction]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => void handleImprovePost(label, instruction)}
                  disabled={!!improveBusy}
                  className="px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-[0.1em]
                             border border-[#A78BFA]/25 bg-[#A78BFA]/[0.06] text-[#C4B5FD]
                             disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#A78BFA]/[0.14] transition-all"
                >
                  {improveBusy === label ? '…' : label}
                </button>
              ))}
            </div>

            {editMode === 'quick' ? (
              preset === 'output_vs_hype' ? (
                <HypeEditor
                  jsonText={jsonText}
                  onChange={setJsonText}
                  logoThumb={(i) => bgThumbs[`tool-logo:${i}`]}
                  onPickLogo={(i, name) => void handlePickForSlide(`tool-logo:${i}`, `${name} logo`)}
                  onPasteLogo={(i) => void handlePasteUrlForSlide(`tool-logo:${i}`)}
                  onClearLogoBg={(i) => handleClearBgForSlide(`tool-logo:${i}`)}
                  onReorderTool={swapToolBgs}
                  onRemoveTool={shiftToolBgsAfterRemove}
                />
              ) : (
                <QuickEdit jsonText={jsonText} onChange={setJsonText} onRewriteItem={(i) => void handleRewriteItem(i)} rewritingIndex={rewritingIndex} />
              )
            ) : (
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
            )}
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
                  <span>
                    {preset === 'app_stack'
                      ? 'Rendered — drag an app card on its slide to reposition it; double-click it to switch the icon/text layout.'
                      : preset === 'curated_list'
                        ? 'Rendered — drag the heading, label, or card on a slide to place them; drag the card’s corner to resize it.'
                        : 'Rendered — use “Add text” or Download in the top bar.'}
                  </span>
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

          <Group open={!!openGroups.bg} onToggle={() => toggleGroup('bg')} title="Backgrounds" hint="per slide">
            {/* Quick gradient background — no photo or API key needed. */}
            <div className="mb-4">
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-gray-400 mb-2">Gradient background (all slides)</div>
              <div className="grid grid-cols-8 gap-1.5">
                {GRADIENTS.map((g) => {
                  const active = g.css === currentBgGradient || (g.css === null && !currentBgGradient);
                  return (
                    <button
                      key={g.name}
                      type="button"
                      onClick={() => applyGlobalGradient(g.css)}
                      title={g.name}
                      aria-label={g.name}
                      className={
                        'aspect-square rounded-md border transition-all ' +
                        (active ? 'border-[#00E5FF] ring-2 ring-[#00E5FF]/40' : 'border-white/15 hover:border-white/40')
                      }
                      style={g.css ? { background: g.css } : { background: 'repeating-linear-gradient(45deg, #1a1f2e, #1a1f2e 4px, #0d1018 4px, #0d1018 8px)' }}
                    />
                  );
                })}
              </div>
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-gray-400 mt-3 mb-2">Solid color</div>
              <div className="grid grid-cols-8 gap-1.5">
                {SOLID_BGS.map((s) => {
                  const active = s.css === currentBgGradient;
                  return (
                    <button
                      key={s.name}
                      type="button"
                      onClick={() => applyGlobalGradient(s.css)}
                      title={s.name}
                      aria-label={s.name}
                      className={
                        'aspect-square rounded-md border transition-all ' +
                        (active ? 'border-[#00E5FF] ring-2 ring-[#00E5FF]/40' : 'border-white/15 hover:border-white/40')
                      }
                      style={{ background: s.hex }}
                    />
                  );
                })}
              </div>
              <p className="text-[10px] text-gray-600 leading-relaxed mt-1.5">
                Instant background for photo-style formats. The first (striped) swatch clears it. Per-slide photos still override this.
              </p>
            </div>
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
                        'relative rounded-xl border px-3 py-2.5 flex flex-col gap-2.5 transition-colors ' +
                        (set
                          ? 'border-[#00E5FF]/25 bg-gradient-to-br from-[#0e2030] to-[#0a1424]'
                          : 'border-white/[0.07] bg-[#0b1224]/60')
                      }
                    >
                     <div className="flex gap-3">
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
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={() => setOpenBgMenuKey(menuOpen ? null : key)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] rounded-md
                                       bg-white/[0.04] text-gray-300 hover:bg-[#00E5FF]/15 hover:text-[#00E5FF] border border-white/10"
                          >
                            {editing ? 'AI editing…' : 'Image source'} <span aria-hidden>▾</span>
                          </button>
                          {set && thumb && (
                            <button
                              type="button"
                              onClick={() => setOpenCropKey(openCropKey === key ? null : key)}
                              className={
                                'inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] rounded-md border ' +
                                (openCropKey === key
                                  ? 'bg-[#00E5FF]/15 text-[#00E5FF] border-[#00E5FF]/40'
                                  : 'bg-white/[0.04] text-gray-300 hover:bg-[#00E5FF]/15 hover:text-[#00E5FF] border-white/10')
                              }
                            >
                              Adjust crop
                            </button>
                          )}
                        </div>
                      </div>
                      </div>

                      {set && thumb && openCropKey === key && (
                        <CropAdjust
                          url={thumb}
                          value={slideBgAdjust[key] || DEFAULT_CROP}
                          onChange={(v) => setSlideBgAdjust((prev) => ({ ...prev, [key]: v }))}
                          onClose={() => setOpenCropKey(null)}
                        />
                      )}

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
                              () => ui.notify('Add an OpenAI API key under Settings to enable AI-edit.', { type: 'info' }),
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
          </Group>

          <section className="px-5 md:px-10 py-6 md:py-7 border-b border-white/[0.04]">
            {sectionLabel(
              'Caption',
              <span className="ml-auto text-[10px] font-bold uppercase tracking-[0.14em] tabular-nums">
                <span className={caption.length > 2200 ? 'text-red-400' : 'text-gray-600'}>{caption.length}</span>
                <span className="text-gray-700"> / 2200</span>
              </span>,
            )}
            <textarea
              ref={captionRef}
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
            {(() => {
              const len = caption.length;
              const firstLine = caption.split('\n')[0] || '';
              const over = len > 2200;
              const hookLong = firstLine.trim().length > 100;
              return (
                <div className="mt-1.5 flex items-center justify-between text-[10px] gap-3">
                  <span className={hookLong ? 'text-amber-400' : 'text-gray-600'}>
                    {hookLong ? '⚠ First line is long — TikTok may cut your hook off' : 'First line is your on-screen hook'}
                  </span>
                  <span className={'tabular-nums shrink-0 ' + (over ? 'text-red-400 font-bold' : len > 2000 ? 'text-amber-400' : 'text-gray-600')}>
                    {len}/2200
                  </span>
                </div>
              );
            })()}
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
              <button
                type="button"
                onClick={async () => {
                  if (caption.trim() && !(await ui.confirm({ message: `Replace the caption with the ${PRESETS[preset].label} template?`, confirmLabel: 'Replace' }))) return;
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
              <button
                type="button"
                onClick={handleSuggestHashtags}
                className="text-[11px] font-bold uppercase tracking-[0.14em] text-gray-500 hover:text-[#00E5FF]"
              >
                ＃ Suggest hashtags
              </button>
              <button
                type="button"
                onClick={handleAiCaption}
                disabled={captionAiBusy}
                className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#A78BFA] hover:text-[#C4B5FD] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {captionAiBusy ? '✨ Writing…' : '✨ AI caption'}
              </button>
              <select
                value={captionTone}
                onChange={(e) => setCaptionTone(e.target.value)}
                aria-label="AI caption tone"
                title="Tone for AI caption"
                className="bg-[#070b18] border border-white/[0.10] rounded-md px-1.5 py-1 text-[11px] text-gray-300 focus:outline-none focus:border-[#A78BFA]/50"
              >
                {['Auto', 'Funny', 'Educational', 'Aesthetic', 'Hype', 'Relatable'].map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <EmojiPicker onPick={insertEmoji} />
              <span className="flex items-center gap-1">
                <select
                  value={translateLang}
                  onChange={(e) => setTranslateLang(e.target.value)}
                  aria-label="Translation language"
                  className="bg-[#070b18] border border-white/[0.10] rounded-md px-1.5 py-1 text-[11px] text-gray-300 focus:outline-none focus:border-[#A78BFA]/50"
                >
                  {['Spanish', 'Portuguese', 'French', 'German', 'Italian', 'Hindi', 'Arabic', 'Japanese', 'Indonesian', 'English'].map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleTranslateCaption}
                  disabled={translateBusy}
                  className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#A78BFA] hover:text-[#C4B5FD] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {translateBusy ? '🌐 …' : '🌐 Translate'}
                </button>
              </span>
            </div>

            {/* Saved hashtag sets — reusable niche blocks. */}
            <div className="mt-2.5 flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] uppercase tracking-[0.12em] text-gray-600 mr-0.5">Tag sets</span>
              {hashtagSets.map((s) => (
                <span key={s.id} className="inline-flex items-center rounded-md border border-white/[0.10] bg-white/[0.03] overflow-hidden">
                  <button
                    type="button"
                    onClick={() => handleInsertHashtagSet(s)}
                    title={formatTags(s.tags)}
                    className="px-2 py-1 text-[11px] font-semibold text-gray-300 hover:text-[#00E5FF]"
                  >
                    {s.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => setHashtagSets(deleteSet(s.id))}
                    aria-label={`Delete ${s.name}`}
                    className="px-1.5 py-1 text-[11px] text-gray-600 hover:text-red-400 border-l border-white/[0.08]"
                  >
                    ✕
                  </button>
                </span>
              ))}
              <button
                type="button"
                onClick={handleSaveHashtagSet}
                className="px-2 py-1 rounded-md text-[11px] font-bold text-gray-500 hover:text-[#00E5FF] border border-dashed border-white/[0.14]"
              >
                + Save tags
              </button>
            </div>
          </section>

          <Group open={!!openGroups.more} onToggle={() => toggleGroup('more')} title="Workspace" accent="#FFC857" hint="Media · Patterns · Analytics · options">
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

            {/* Creator handle stamped under each slide. Empty = no handle
               (the old "@tryiro" default is gone). A per-format toggle
               controls which styles actually stamp it. */}
            <div className="flex flex-col gap-2 p-3 rounded-xl border border-white/[0.06] bg-white/[0.02]">
              <label className="flex flex-col gap-1.5">
                <span className="text-[12px] font-bold text-gray-200">Creator handle</span>
                <input
                  type="text"
                  value={attribution}
                  onChange={(e) => setAttribution(e.target.value)}
                  placeholder="@yourhandle (leave blank for none)"
                  className="w-full rounded-lg border border-white/[0.10] bg-[#070b18] px-3 py-2 text-[13px] text-gray-200
                             placeholder:text-gray-600 focus:border-[#00E5FF]/40 focus:outline-none"
                />
              </label>
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={attrOnThisPreset}
                  onChange={(e) => setAttrPresets((prev) => ({ ...prev, [preset]: e.target.checked }))}
                  className="w-4 h-4 accent-[#00E5FF] cursor-pointer"
                />
                <span className="text-[11px] text-gray-300 leading-snug">
                  Show on <strong className="text-gray-100">{PRESETS[preset]?.label || preset}</strong> slides
                </span>
              </label>
              <span className="text-[10px] text-gray-500 leading-relaxed">
                The handle only stamps on the formats you tick here — on by default for Prompt Pack, Aspirational &amp; Product Demo.
              </span>
            </div>
          </Group>

          <Group open={!!openGroups.drafts} onToggle={() => toggleGroup('drafts')} title="Drafts" accent="#34D399" hint={drafts.length ? `${drafts.length} saved` : 'save projects'}>
            <p className="text-xs text-gray-500 leading-relaxed mb-3">
              Keep multiple posts in progress. Saves the JSON, caption, format, backgrounds &amp; handle settings — load any one back instantly.
            </p>
            {/* Batch generate: one AI-filled draft per topic line. */}
            <div className="mb-3 p-3 rounded-xl border border-[#A78BFA]/20 bg-[#A78BFA]/[0.06]">
              <div className="text-[11px] font-bold text-[#C4B5FD] mb-1.5">✨ Batch a week of content</div>
              <textarea
                value={batchTopics}
                onChange={(e) => setBatchTopics(e.target.value)}
                rows={4}
                placeholder={`One topic per line — each becomes a ${PRESETS[preset].label} draft:\nAI tools for students\n5 ChatGPT prompts for writers\nmyths about learning to code`}
                className="w-full bg-[#070b18] border border-white/[0.10] rounded-lg px-3 py-2 text-[12px] leading-relaxed text-gray-200 placeholder:text-gray-600 focus:border-[#A78BFA]/50 focus:outline-none resize-y"
              />
              <button
                type="button"
                onClick={() => void handleBatchGenerate()}
                disabled={!!batchBusy || !batchTopics.trim()}
                className="w-full mt-2 py-2.5 rounded-lg text-[11px] font-bold uppercase tracking-[0.12em]
                           bg-gradient-to-r from-[#A78BFA] to-[#7C5CFC] text-white
                           disabled:opacity-50 disabled:cursor-not-allowed hover:brightness-110 transition-all"
              >
                {batchBusy || `Generate ${batchTopics.split('\n').map((s) => s.trim()).filter(Boolean).length || ''} drafts`.trim()}
              </button>
            </div>
            <button
              type="button"
              onClick={handleSaveDraft}
              className="w-full py-3 mb-3 rounded-xl text-[12px] font-bold uppercase tracking-[0.12em]
                         border border-[#34D399]/30 bg-[#34D399]/10 text-[#34D399]
                         hover:bg-[#34D399]/20 transition-all"
            >
              + Save current as draft
            </button>
            <div className="flex gap-2 mb-3">
              <button
                type="button"
                onClick={() => void handleSharePost()}
                className="flex-1 py-2 rounded-lg text-[11px] font-bold uppercase tracking-[0.1em] border border-white/[0.10] bg-white/[0.03] text-gray-300 hover:text-[#00E5FF] hover:border-[#00E5FF]/30 transition-all"
              >
                ↗ Share post
              </button>
              <button
                type="button"
                onClick={() => void handleImportPost()}
                className="flex-1 py-2 rounded-lg text-[11px] font-bold uppercase tracking-[0.1em] border border-white/[0.10] bg-white/[0.03] text-gray-300 hover:text-[#00E5FF] hover:border-[#00E5FF]/30 transition-all"
              >
                ↙ Import code
              </button>
            </div>
            {drafts.length === 0 ? (
              <div className="text-[11px] text-gray-600 text-center py-2">No drafts yet.</div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {drafts.map((d) => (
                  <div key={d.id} className="flex items-center gap-2 p-2.5 rounded-lg border border-white/[0.08] bg-white/[0.02]">
                    <button
                      type="button"
                      onClick={() => void handleLoadDraft(d)}
                      className="flex-1 text-left min-w-0"
                      title={`Load "${d.name}"`}
                    >
                      <div className="text-[12px] font-bold text-gray-200 truncate">{d.name}</div>
                      <div className="text-[10px] text-gray-500">{new Date(d.savedAt).toLocaleDateString()} · {new Date(d.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteDraft(d)}
                      className="shrink-0 w-7 h-7 rounded-md flex items-center justify-center text-gray-500 hover:text-red-400 hover:bg-red-400/10"
                      title="Delete draft"
                      aria-label="Delete draft"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Group>

          <Group open={!!openGroups.tiktok} onToggle={() => toggleGroup('tiktok')} title="Publish to TikTok" accent="#ff0050" hint={ttToken ? 'connected' : 'send to inbox'}>
            {/* Pre-publish quality checklist */}
            <div className="mb-4 p-3 rounded-xl border border-white/[0.08] bg-white/[0.02]">
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-gray-400 mb-2">
                Pre-publish check · {prePublishChecks.filter((c) => c.ok).length}/{prePublishChecks.length}
              </div>
              <div className="flex flex-col gap-1.5">
                {prePublishChecks.map((c) => (
                  <div key={c.label} className="flex items-center gap-2 text-[12px]">
                    <span className={c.ok ? 'text-emerald-400' : 'text-amber-400'}>{c.ok ? '✓' : '○'}</span>
                    <span className={c.ok ? 'text-gray-300' : 'text-gray-500'}>{c.label}</span>
                  </div>
                ))}
              </div>
            </div>
            <p className="text-xs text-gray-500 leading-relaxed mb-3">
              Push the current slideshow straight to your TikTok <strong className="text-gray-300">inbox</strong> as a photo draft — then open the app to finish posting. Uses your caption below.
            </p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={sendToTikTok}
                disabled={ttStatus.kind === 'sending' || ttStatus.kind === 'connecting'}
                className="w-full py-3 rounded-xl text-[12px] font-bold uppercase tracking-[0.12em]
                           bg-gradient-to-r from-[#ff0050] to-[#ff4d7d] text-white
                           disabled:opacity-60 disabled:cursor-not-allowed hover:brightness-110 transition-all"
              >
                {ttStatus.kind === 'sending' ? (ttStatus.msg || 'Sending…')
                  : ttStatus.kind === 'connecting' ? 'Connecting…'
                  : ttToken ? 'Send to TikTok inbox' : 'Connect TikTok & send'}
              </button>
              <button
                type="button"
                onClick={handlePhoneHandoff}
                disabled={!!phoneBusy}
                className="w-full py-3 rounded-xl text-[12px] font-bold uppercase tracking-[0.12em]
                           border border-white/[0.12] bg-white/[0.03] text-gray-200
                           disabled:opacity-60 disabled:cursor-not-allowed hover:border-[#00E5FF]/40 hover:text-[#00E5FF] transition-all"
              >
                {phoneBusy || '📲 Send to phone (QR)'}
              </button>
              <button
                type="button"
                onClick={handleExportVideo}
                disabled={!!videoBusy}
                className="w-full py-3 rounded-xl text-[12px] font-bold uppercase tracking-[0.12em]
                           border border-white/[0.12] bg-white/[0.03] text-gray-200
                           disabled:opacity-60 disabled:cursor-not-allowed hover:border-[#A78BFA]/50 hover:text-[#A78BFA] transition-all"
              >
                {videoBusy || '🎬 Export as video'}
              </button>
              <div className="flex items-center gap-1 -mt-1">
                <span className="text-[10px] uppercase tracking-[0.12em] text-gray-600 mr-1">Pace</span>
                {([['Fast', 1.5], ['Normal', 2.5], ['Slow', 4]] as const).map(([label, secs]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setVideoPace(secs)}
                    className={
                      'flex-1 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-[0.1em] transition-colors ' +
                      (videoPace === secs ? 'bg-[#A78BFA]/20 text-[#C4B5FD]' : 'text-gray-500 hover:text-gray-300 bg-white/[0.02]')
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={handleExportPdf}
                disabled={!!pdfBusy}
                className="w-full py-3 rounded-xl text-[12px] font-bold uppercase tracking-[0.12em]
                           border border-white/[0.12] bg-white/[0.03] text-gray-200
                           disabled:opacity-60 disabled:cursor-not-allowed hover:border-[#FFC857]/50 hover:text-[#FFC857] transition-all"
              >
                {pdfBusy || '📄 Export PDF (IG / LinkedIn)'}
              </button>
              {phoneErr && <div className="text-[11px] text-red-400 leading-relaxed">{phoneErr}</div>}
              {ttToken && (
                <button
                  type="button"
                  onClick={disconnectTikTok}
                  className="self-start text-[10px] font-bold uppercase tracking-[0.12em] text-gray-500 hover:text-[#ff4d7d]"
                >
                  Disconnect account
                </button>
              )}
              {ttStatus.kind !== 'sending' && ttStatus.msg && (
                <div className={
                  'text-[11px] leading-relaxed mt-0.5 ' +
                  (ttStatus.kind === 'err' ? 'text-red-400' : ttStatus.kind === 'ok' ? 'text-emerald-400' : 'text-gray-400')
                }>
                  {ttStatus.msg}
                </div>
              )}
              <div className="text-[10px] text-gray-600 leading-relaxed mt-1">
                Needs a one-time setup: a TikTok developer app + Vercel Blob storage. See <code className="text-gray-500">TIKTOK_SETUP.md</code>.
              </div>
            </div>
          </Group>

          <Group open={!!openGroups.settings} onToggle={() => toggleGroup('settings')} title="Settings" accent="#94a3b8" hint="API keys · backup · model">
            <p className="text-xs text-gray-500 leading-relaxed mb-4">
              Pasted keys live in this browser only. Pexels &amp; Unsplash are free; Anthropic &amp; OpenAI are pay-per-use.
            </p>

            {/* Backup / restore — the post history + brand settings live only
               in this browser, so a one-tap export is the safety net. API
               keys are intentionally excluded from the file. */}
            <div className="mb-5 p-3 rounded-xl border border-white/[0.08] bg-white/[0.02]">
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-gray-400 mb-2">Backup</div>
              <p className="text-[11px] text-gray-500 leading-relaxed mb-3">
                Export your post history + scores + brand kit to a file (no API keys). Import it on another device or
                after clearing your browser.
              </p>
              <input
                ref={backupInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleImportBackup(f);
                  e.target.value = '';
                }}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleExportBackup}
                  className="flex-1 py-2 rounded-lg text-[11px] font-bold uppercase tracking-[0.14em] bg-[#00E5FF]/15 text-[#00E5FF] hover:bg-[#00E5FF]/25 border border-[#00E5FF]/20"
                >
                  Export backup
                </button>
                <button
                  type="button"
                  onClick={() => backupInputRef.current?.click()}
                  className="flex-1 py-2 rounded-lg text-[11px] font-bold uppercase tracking-[0.14em] bg-white/[0.04] text-gray-300 hover:bg-white/[0.08] border border-white/10"
                >
                  Import backup
                </button>
              </div>
            </div>

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
              { label: 'Pixabay API key', value: pixabayKey, setter: setPixabayKey, href: 'https://pixabay.com/api/docs/', note: 'Free. (Openverse needs no key at all.)' },
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
          </Group>
        </div>

        {/* Sticky action bar — the primary Render + Save controls stay
            pinned to the bottom of the sidebar so they're reachable from
            anywhere in the scroll instead of buried at the end. */}
        <div className="shrink-0 border-t border-white/[0.08] bg-[#0a0e1a]/92 backdrop-blur px-5 md:px-10 py-3.5 md:py-4">
          {pendingPrediction && (
            <div className="mb-2.5 flex items-center justify-between gap-2 text-xs">
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
            <div className="mb-2 text-xs text-red-400">Save failed: {saveStatus.msg}</div>
          )}
          <div className="flex items-stretch gap-2.5">
            <button
              type="button"
              onClick={() => void handleRender()}
              className="flex-1 py-3.5 md:py-4 rounded-xl font-bold text-base md:text-lg tracking-wide
                         bg-gradient-to-r from-[#00E5FF] to-[#00A5D9]
                         text-[#0a0e1a]
                         shadow-[0_6px_30px_rgba(0,229,255,0.4),inset_0_1px_0_rgba(255,255,255,0.3)]
                         hover:shadow-[0_8px_36px_rgba(0,229,255,0.6),inset_0_1px_0_rgba(255,255,255,0.4)]
                         hover:-translate-y-0.5 active:translate-y-0
                         transition-all duration-200"
            >
              <span className="inline-flex items-center justify-center gap-2.5">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="5 3 19 12 5 21 5 3" fill="currentColor" />
                </svg>
                Render slides
              </span>
            </button>
            <button
              type="button"
              onClick={handleSaveToHistory}
              disabled={saveStatus.kind === 'saving'}
              title="Save this post to your history"
              className="shrink-0 px-4 md:px-5 rounded-xl text-[11px] md:text-xs font-bold uppercase tracking-[0.14em]
                         border border-[#00E5FF]/30 bg-[#0e2b3a] text-[#00E5FF]
                         hover:bg-[#13384c] hover:border-[#00E5FF]/60 transition-all
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saveStatus.kind === 'saving' ? 'Saving…' : saveStatus.kind === 'ok' ? '✓ Saved' : 'Save'}
            </button>
          </div>
          <p className="mt-1.5 text-center text-[10px] text-gray-600 tracking-wide">
            tip: press <kbd className="px-1 py-0.5 rounded bg-white/[0.06] text-gray-400 font-mono">⌘/Ctrl + Enter</kbd> to render
          </p>
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
          <Library pickMode={pickRequest} pexelsKey={pexelsKey} unsplashKey={unsplashKey} pixabayKey={pixabayKey} />
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
          'absolute inset-0 flex flex-col ' +
          (mobileView === 'preview' ? 'flex ' : 'hidden ') +
          (mainView === 'preview' ? 'md:flex' : 'md:hidden')
        }>
          {slideCount > 1 && (
            <div className="shrink-0 flex items-center gap-1.5 px-3 py-2 bg-[#0a0e1a]/90 border-b border-white/[0.06] overflow-x-auto custom-scrollbar">
              <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-gray-600 shrink-0 mr-1">Slides</span>
              {Array.from({ length: slideCount }, (_, i) => {
                const label = i === 0 ? 'Hook' : i === slideCount - 1 ? 'CTA' : String(i);
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => jumpToSlide(i)}
                    title={`Jump to slide ${i + 1}`}
                    className="shrink-0 min-w-[28px] px-2 py-1 rounded-md text-[11px] font-bold bg-white/[0.04] text-gray-400 hover:bg-[#00E5FF]/15 hover:text-[#00E5FF] border border-white/10 transition-colors"
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}
          <iframe
            ref={iframeRef}
            srcDoc={engineHtml}
            onLoad={handleIframeLoad}
            className="flex-1 w-full border-0 bg-[#1a1a1a]"
            title="Iro slideshow renderer"
          />
        </div>
      </main>

      <CommandPalette open={paletteOpen} commands={commands} onClose={() => setPaletteOpen(false)} />
      {showOnboarding && <Onboarding onClose={() => setShowOnboarding(false)} />}

      {phoneQr && (
        <div
          className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6"
          onClick={() => setPhoneQr(null)}
        >
          <div
            className="bg-[#0d1320] border border-white/10 rounded-2xl p-6 max-w-sm w-full text-center shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-sm font-bold text-gray-100 mb-1">Scan with your phone</div>
            <p className="text-[12px] text-gray-500 leading-relaxed mb-4">
              Open the camera, scan this, then long-press each slide to save it to Photos. The caption is on the page too.
            </p>
            <img src={phoneQr.img} alt="QR code" className="w-56 h-56 mx-auto rounded-xl bg-white p-2" />
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => { navigator.clipboard?.writeText(phoneQr.url).catch(() => {}); ui.notify('Link copied.', { type: 'success' }); }}
                className="w-full py-2.5 rounded-lg text-[11px] font-bold uppercase tracking-[0.12em] border border-white/[0.12] bg-white/[0.03] text-gray-300 hover:text-[#00E5FF] hover:border-[#00E5FF]/40"
              >
                Copy link instead
              </button>
              <button
                type="button"
                onClick={() => setPhoneQr(null)}
                className="w-full py-2.5 rounded-lg text-[11px] font-bold uppercase tracking-[0.12em] text-gray-500 hover:text-gray-300"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
