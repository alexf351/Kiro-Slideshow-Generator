// Preset registry for the React shell. Mirrors the keys the engine knows
// about, plus per-preset metadata for the sidebar UI and a default JSON
// example the user can load with one tap.
//
// Engine-side rendering lives in kiro_slideshow_engine_v3.html (PRESETS
// const). Adding a new preset means adding an entry here AND there.

export const PRESET_KEYS = [
  'prompt_pack',
  'pain_story',
  'aspirational',
  'meme_pov',
  'product_demo',
  'checklist',
] as const;

export type PresetKey = (typeof PRESET_KEYS)[number];

export type PresetMeta = {
  key: PresetKey;
  label: string;
  // One-line user-facing pitch for the sidebar.
  pitch: string;
  // 'ready' = engine renders this preset as its own format. 'planned' =
  // selecting it falls back to prompt_pack rendering until we ship it.
  status: 'ready' | 'planned';
  // Pretty-printed JSON the user can drop into the textarea as a starting
  // point for this format.
  defaultJson: string;
};

const PROMPT_PACK_JSON = `{
  "preset": "prompt_pack",
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

const PAIN_STORY_JSON = `{
  "preset": "pain_story",
  "hook": { "text": "i used to dread waking up." },
  "beats": [
    { "text": "every morning felt like starting over." },
    { "text": "i'd scroll for an hour before i could move." },
    { "text": "nothing was sticking. nothing was working." },
    { "text": "until something finally clicked." }
  ],
  "cta": {
    "headline": "iro changed how i learn.",
    "instructionAbove": "search",
    "searchTerm": "Iro AI",
    "instructionBelow": "on the App Store.",
    "slogan": "5 minutes a day. that's it."
  },
  "attribution": "@IRO.AI"
}`;

const MEME_POV_JSON = `{
  "preset": "meme_pov",
  "panels": [
    {
      "top": "POV: you finally start learning AI",
      "bottom": "and your boss says 'so you're an expert now?'"
    },
    {
      "top": "what they think you're doing",
      "bottom": "vs what you're actually doing"
    }
  ],
  "cta": {
    "instructionAbove": "search",
    "searchTerm": "Iro AI",
    "instructionBelow": "on the App Store",
    "slogan": "actually get good at AI."
  },
  "attribution": "@IRO.AI"
}`;

const PRODUCT_DEMO_JSON = `{
  "preset": "product_demo",
  "hook": {
    "headline": "Iro is the <strong>Duolingo for AI</strong>."
  },
  "features": [
    {
      "headline": "5 minutes a day.",
      "subline": "AI lessons that fit between your morning coffee and your first meeting."
    },
    {
      "headline": "Real practice. Not theory.",
      "subline": "Every lesson ends with a real prompt you'd actually use."
    },
    {
      "headline": "Progress you can feel.",
      "subline": "Streaks, mastery levels, and weekly checkpoints. Like a fitness app for your brain."
    }
  ],
  "cta": {
    "headline": "Get good at AI.",
    "instructionAbove": "search",
    "searchTerm": "Iro AI",
    "instructionBelow": "on the App Store.",
    "slogan": "5 min/day. that's it."
  },
  "attribution": "@IRO.AI"
}`;

const ASPIRATIONAL_JSON = `{
  "preset": "aspirational",
  "hook": {
    "headline": "stop watching them <em>win</em>.",
    "supporting": "while you fall further behind."
  },
  "beats": [
    {
      "label": "the gap",
      "text": "they had a tool you <strong>didn't</strong>."
    },
    {
      "label": "the discovery",
      "text": "5 minutes a day. that was it."
    },
    {
      "label": "the unlock",
      "text": "<em>actually</em> understanding AI."
    },
    {
      "label": "the outcome",
      "text": "you stop <strong>watching</strong>. you start <em>building</em>."
    }
  ],
  "cta": {
    "headline": "stop scrolling.<br/>start <em>building</em>.",
    "instructionAbove": "search",
    "searchTerm": "Iro AI",
    "instructionBelow": "on the App Store.",
    "slogan": "the future is yours."
  },
  "attribution": "@IRO.AI"
}`;

// Placeholders for not-yet-shipped presets. Selecting one will currently
// render as prompt_pack on the engine side; we keep the entries here so
// the selector shows what's coming.
const PLACEHOLDER_JSON = (preset: PresetKey) => `{
  "preset": "${preset}",
  "// note": "This preset isn't fully built yet — falls back to prompt_pack rendering.",
  "platform": "claude",
  "hook": { "headline": "Coming soon", "sub": "(${preset})" },
  "prompts": [],
  "cta": {
    "headline": "Try a different preset for now.",
    "instructionAbove": "search:",
    "searchTerm": "Iro AI",
    "instructionBelow": "on the App Store.",
    "slogan": "more formats coming."
  },
  "attribution": "@IRO.AI"
}`;

export const PRESETS: Record<PresetKey, PresetMeta> = {
  prompt_pack: {
    key: 'prompt_pack',
    label: 'Prompt Pack',
    pitch: 'Save-bait list. Big numbered prompts in chat-style boxes.',
    status: 'ready',
    defaultJson: PROMPT_PACK_JSON,
  },
  pain_story: {
    key: 'pain_story',
    label: 'Pain Story',
    pitch: 'Aesthetic photo bg + italic serif confession. Soft CTA.',
    status: 'ready',
    defaultJson: PAIN_STORY_JSON,
  },
  aspirational: {
    key: 'aspirational',
    label: 'Aspirational',
    pitch: 'Cinematic luxury. Bottom-anchored bold hooks, gold + cyan accents.',
    status: 'ready',
    defaultJson: ASPIRATIONAL_JSON,
  },
  meme_pov: {
    key: 'meme_pov',
    label: 'Meme / POV',
    pitch: 'Image-dominant. Top/bottom captions with thick stroke, minimal branding.',
    status: 'ready',
    defaultJson: MEME_POV_JSON,
  },
  product_demo: {
    key: 'product_demo',
    label: 'Product Demo',
    pitch: 'Phone mockup + Iro screenshots. Branded benefit captions per slide.',
    status: 'ready',
    defaultJson: PRODUCT_DEMO_JSON,
  },
  checklist: {
    key: 'checklist',
    label: 'Checklist',
    pitch: 'Scannable “if you…” qualifier with status indicators. (Coming soon.)',
    status: 'planned',
    defaultJson: PLACEHOLDER_JSON('checklist'),
  },
};
