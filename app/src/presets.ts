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
  // Caption template tuned to the format's vibe — first line acts as the
  // hook, hashtags trail at the end. Loaded on demand via the
  // "Generate caption" button next to the Caption textarea.
  defaultCaption: string;
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

const CHECKLIST_JSON = `{
  "preset": "checklist",
  "hook": {
    "headline": "save this if you…",
    "subline": "want to actually get good at AI."
  },
  "items": [
    { "status": "check", "text": "feel left behind in AI" },
    { "status": "check", "text": "tried to learn it before and quit" },
    { "status": "check", "text": "want to use it daily, not just read tweets about it" },
    { "status": "check", "text": "don't have hours to spare" },
    { "status": "cross", "text": "want another endless YouTube playlist" }
  ],
  "cta": {
    "headline": "if this is you<br/><strong>iro</strong> is for you.",
    "instructionAbove": "search",
    "searchTerm": "Iro AI",
    "instructionBelow": "on the App Store.",
    "slogan": "5 min/day. for real."
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


// Caption templates per preset. First line is the hook (TikTok shows
// the first ~80 chars as the visible caption); the rest is body +
// hashtags. Tuned to match each format's voice — the user can edit
// after pulling them in via "Generate caption".

const PROMPT_PACK_CAPTION = `save these before they get patched 🔖

3 prompts I keep on rotation. each one has saved me hours.

want to actually get good at AI? search "Iro AI" on the App Store.

#aiprompts #chatgpt #claude #aitools #productivity`;

const PAIN_STORY_CAPTION = `i used to feel like everyone was getting it but me.

every morning the same thing — open the app, scroll, close, repeat. nothing was sticking. i was falling further behind every day.

then i tried iro. 5 minutes a day. that was it. and somehow it worked.

if you've felt this too, it's not just you.

search "Iro AI" on the App Store ✨

#aijourney #learningai #studytok #aitok #selfimprovement`;

const ASPIRATIONAL_CAPTION = `stop watching them win.

they had a tool you didn't. now you do.

search "Iro AI" on the App Store. 5 min/day. that's it.

#aitools #leveluptiktok #futureready #ai #productivity`;

const MEME_POV_CAPTION = `the AI grindset is unmatched 😭😭

search "Iro AI" if you're tired of watching everyone else figure it out.

#aitok #pov #fyp #ai #relatable #aimemes`;

const PRODUCT_DEMO_CAPTION = `this is the app I wish existed when I started learning AI.

5 min/day. real prompts you'd actually use. progress you can feel.

download Iro AI on the App Store ↓

#ai #aitools #appsthatchangedmylife #learningai #fyp`;

const CHECKLIST_CAPTION = `save this if any of these is you ⤴️

✓ feel left behind in AI
✓ tried to learn it before and quit
✓ want to use it daily, not just read tweets about it
✓ don't have hours to spare

iro is for you. search "Iro AI" on the App Store.

#aitok #aichecklist #fyp #learningai #productivity`;

export const PRESETS: Record<PresetKey, PresetMeta> = {
  prompt_pack: {
    key: 'prompt_pack',
    label: 'Prompt Pack',
    pitch: 'Save-bait list. Big numbered prompts in chat-style boxes.',
    status: 'ready',
    defaultJson: PROMPT_PACK_JSON,
    defaultCaption: PROMPT_PACK_CAPTION,
  },
  pain_story: {
    key: 'pain_story',
    label: 'Pain Story',
    pitch: 'Aesthetic photo bg + italic serif confession. Soft CTA.',
    status: 'ready',
    defaultJson: PAIN_STORY_JSON,
    defaultCaption: PAIN_STORY_CAPTION,
  },
  aspirational: {
    key: 'aspirational',
    label: 'Aspirational',
    pitch: 'Cinematic luxury. Bottom-anchored bold hooks, gold + cyan accents.',
    status: 'ready',
    defaultJson: ASPIRATIONAL_JSON,
    defaultCaption: ASPIRATIONAL_CAPTION,
  },
  meme_pov: {
    key: 'meme_pov',
    label: 'Meme / POV',
    pitch: 'Image-dominant. Top/bottom captions with thick stroke, minimal branding.',
    status: 'ready',
    defaultJson: MEME_POV_JSON,
    defaultCaption: MEME_POV_CAPTION,
  },
  product_demo: {
    key: 'product_demo',
    label: 'Product Demo',
    pitch: 'Phone mockup + Iro screenshots. Branded benefit captions per slide.',
    status: 'ready',
    defaultJson: PRODUCT_DEMO_JSON,
    defaultCaption: PRODUCT_DEMO_CAPTION,
  },
  checklist: {
    key: 'checklist',
    label: 'Checklist',
    pitch: 'Scannable “if you…” qualifier. Big tinted check / cross / warning icons.',
    status: 'ready',
    defaultJson: CHECKLIST_JSON,
    defaultCaption: CHECKLIST_CAPTION,
  },
};
