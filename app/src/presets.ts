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
  'handwritten_pack',
  'app_stack',
  'output_vs_hype',
  'curated_list',
  'tier_list',
  'myth_fact',
  'hot_take',
  'storytime',
  'stat_drop',
  'this_or_that',
  'quote_card',
  'before_after',
  'countdown',
  'definition',
  'qa',
  'flags',
  'steps',
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
  // Accent color used in the format-selector chip when the preset is
  // active. Mirrors the engine's per-preset palette so the sidebar
  // visually previews what the slides will look like.
  accent: string;
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
    "searchTerm": "Iro AI",
    "instructionBelow": "on the App Store.",
    "slogan": "stop asking AI questions.<br/><strong>start building with it.</strong>"
  },
  "attribution": ""
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
  "attribution": ""
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
  "attribution": ""
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
  "attribution": ""
}`;

const HANDWRITTEN_PACK_JSON = `{
  "preset": "handwritten_pack",
  "hook": {
    "headline": "ChatGPT has 187 million users per day. Yet 97% of people don't know how to use it.",
    "sub": "Copy these 5 prompts and use it as a pro:"
  },
  "prompts": [
    {
      "title": "1/ Grocery Receipt Analyzer",
      "prompt": "Here's my grocery receipt [paste]. Show me where I overspent, cheaper alternatives, and how to cut my bill by 30%."
    },
    {
      "title": "2/ Flight Finder",
      "prompt": "Find the cheapest flights from [City A] to [City B] in the next [X weeks]. Include budget airlines, layover hacks, and hidden deals."
    },
    {
      "title": "3/ Meeting Summarizer",
      "prompt": "Here's my meeting transcript: [paste]. Pull out 3 key decisions, 5 action items with owners, and any unresolved questions."
    },
    {
      "title": "4/ Email That Gets Replies",
      "prompt": "Write a 3-line email to [recipient] about [topic]. Friendly but direct. End with one clear ask."
    },
    {
      "title": "5/ Learn Anything Fast",
      "prompt": "Teach me [topic] like I'm 12. One analogy I'd actually relate to. Then ask one question to check I understood."
    }
  ],
  "cta": {
    "headline": "want to actually get good at AI?",
    "instructionAbove": "search",
    "searchTerm": "Iro AI",
    "instructionBelow": "on the App Store.",
    "slogan": "5 min a day. that's it."
  },
  "attribution": ""
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
  "attribution": ""
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
  "attribution": ""
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

const APP_STACK_JSON = `{
  "preset": "app_stack",
  "hook": {
    "headline": "5 apps I use so my phone makes me smarter instead of dumber"
  },
  "apps": [
    {
      "name": "Claude",
      "description": "turning messy ideas into clear plans",
      "iconUrl": ""
    },
    {
      "name": "Iro",
      "description": "learning AI skills before everyone at work catches up",
      "iconUrl": ""
    },
    {
      "name": "Perplexity",
      "description": "researching anything without opening 37 tabs",
      "iconUrl": ""
    },
    {
      "name": "Notion",
      "description": "organizing ideas, scripts, and plans",
      "iconUrl": ""
    },
    {
      "name": "CapCut",
      "description": "making short-form content fast",
      "iconUrl": ""
    }
  ],
  "attribution": ""
}`;

const OUTPUT_VS_HYPE_JSON = `{
  "preset": "output_vs_hype",
  "hook": {
    "headline": "Output <span style=\\"color:#00E5FF\\">vs</span> Hype",
    "sub": "what AI tools actually deliver."
  },
  "tools": [
    { "name": "Claude", "logoUrl": "", "accent": "#D97757", "output": 92, "hype": 70 },
    { "name": "Perplexity", "logoUrl": "", "accent": "#22D3EE", "output": 84, "hype": 62 },
    { "name": "Lovable", "logoUrl": "", "accent": "#F5707A", "output": 48, "hype": 95 },
    { "name": "NotebookLM", "logoUrl": "", "accent": "#5B8DEF", "output": 88, "hype": 55 },
    { "name": "Magnific", "logoUrl": "", "accent": "#E5E7EB", "output": 76, "hype": 64 }
  ],
  "cta": {
    "headline": "want to actually <strong>get good</strong> at AI?",
    "instructionAbove": "search",
    "searchTerm": "Iro AI",
    "instructionBelow": "on the App Store.",
    "slogan": "less hype. more output."
  },
  "attribution": ""
}`;

const OUTPUT_VS_HYPE_CAPTION = `output vs hype — what AI tools actually deliver 📊

been thinking about AI tools lately. sometimes the hype doesn't match what they really do. swipe to see where each one actually lands.

what's overhyped and what's underrated? drop it below 👇

want to cut through the hype and actually get good at AI? search "Iro AI" on the App Store.

#aitools #ai #claude #perplexity #aitok`;

const CURATED_LIST_JSON = `{
  "preset": "curated_list",
  "hook": {
    "headline": "Habits to Become<br/>Disgustingly Well-Educated<br/>(and end brainrot)"
  },
  "picks": [
    {
      "headline": "One Substack Article a Day",
      "sub": "Long-form writing builds real depth.",
      "label": "my recent read"
    },
    {
      "headline": "Use Podcasts During \\"Dead Time\\"",
      "sub": "Commutes, walks, chores = learning time.",
      "label": "my favorite on Spotify"
    },
    {
      "headline": "Replace Doomscrolling With Microlearning Apps",
      "sub": "Small lessons compound faster than you think.",
      "label": "my favorite app",
      "highlight": true
    },
    {
      "headline": "Look Up Everything You Don't Understand",
      "sub": "Words, ideas, references — don't skip them. Curiosity practiced consistently turns into intelligence."
    }
  ],
  "attribution": ""
}`;

const CURATED_LIST_CAPTION = `habits to become disgustingly well-educated (and end brainrot) 📚

small, boring habits compound into a scary-good level of knowledge. save these and actually do them.

which one are you starting with? 👇

want to actually get good at AI while you're at it? search "Iro AI" on the App Store.

#educated #knowledge #selfimprovement #microlearning #studytok`;

const APP_STACK_CAPTION = `5 apps that actually make your phone useful 📱

these aren't "top 10 AI tools" clickbait. these are the 5 I open every single day.

if your screen time is high but your output is low — start here.

#appsyouneed #productivity #aitools #techtools #aitok`;

const HANDWRITTEN_PACK_CAPTION = `save these prompts. wrote them down so you don't have to. 🔖

5 prompts that turn ChatGPT from a glorified search engine into something that actually saves you hours.

want to get good at AI? search "Iro AI" on the App Store. 5 min a day, that's it.

#aiprompts #chatgpt #savethis #aitok #productivity`;

const TIER_LIST_JSON = `{
  "preset": "tier_list",
  "hook": {
    "headline": "I ranked every <strong>AI tool</strong>",
    "subline": "S-tier to absolute trash"
  },
  "tiers": [
    { "grade": "S", "label": "God tier", "items": ["Claude", "Cursor"] },
    { "grade": "A", "label": "Daily driver", "items": ["ChatGPT", "Perplexity"] },
    { "grade": "B", "label": "Situational", "items": ["Gemini", "Notion AI"] },
    { "grade": "F", "label": "Skip it", "items": ["Yet another GPT wrapper"] }
  ],
  "cta": {
    "headline": "Want to actually <strong>learn AI</strong><br/>instead of arguing about tools?",
    "instructionAbove": "search:",
    "searchTerm": "Iro AI",
    "instructionBelow": "on the App Store.",
    "slogan": "stop collecting tools.<br/><strong>start building with them.</strong>"
  },
  "attribution": ""
}`;

const TIER_LIST_CAPTION = `my honest AI tool tier list 🫣 fight me in the comments

S-tier earns its spot. everything in F is just a ChatGPT wrapper with a logo.

want to actually get good at this stuff? search "Iro AI" on the App Store.

#aitools #tierlist #aitok #chatgpt #tech`;

const MYTH_FACT_JSON = `{
  "preset": "myth_fact",
  "hook": {
    "headline": "<strong>AI myths</strong> you still believe",
    "subline": "let's clear these up"
  },
  "items": [
    {
      "myth": "AI will take all the jobs and there's nothing you can do.",
      "fact": "The people who learn to *use* AI take the jobs from those who don't."
    },
    {
      "myth": "You need to know how to code to build with AI.",
      "fact": "You can ship real tools today with plain-English prompts."
    },
    {
      "myth": "ChatGPT just makes things up, so it's useless for real work.",
      "fact": "Give it context + a clear task and it's a genuine force multiplier."
    }
  ],
  "cta": {
    "headline": "Want the <strong>real</strong> skills,<br/>not the hype?",
    "instructionAbove": "search:",
    "searchTerm": "Iro AI",
    "instructionBelow": "on the App Store.",
    "slogan": "5 minutes a day.<br/><strong>start building.</strong>"
  },
  "attribution": ""
}`;

const MYTH_FACT_CAPTION = `3 AI myths that are quietly holding you back 🧠

save this and reread it next time someone says "AI is just hype."

want the real skills? search "Iro AI" on the App Store. 5 min a day.

#ai #aimyths #aitok #learnai #productivity`;

const HOT_TAKE_JSON = `{
  "preset": "hot_take",
  "hook": {
    "headline": "<strong>AI hot takes</strong> that'll make you mad",
    "subline": "(but i'm right)"
  },
  "items": [
    {
      "take": "Prompt engineering isn't a real skill.",
      "defense": "Knowing what to BUILD is. The prompt is the easy part."
    },
    {
      "take": "Most \\"AI gurus\\" have never shipped anything.",
      "defense": "They sell courses about a tool they don't use."
    },
    {
      "take": "You're not behind. You just haven't started.",
      "defense": "Six months of 5-min-a-day beats doomscrolling about it."
    }
  ],
  "cta": {
    "headline": "Stop arguing.<br/><strong>Start building.</strong>",
    "instructionAbove": "search:",
    "searchTerm": "Iro AI",
    "instructionBelow": "on the App Store.",
    "slogan": "5 minutes a day. that's it."
  },
  "attribution": ""
}`;

const HOT_TAKE_CAPTION = `my spiciest AI takes 🌶️ tell me i'm wrong

(i'm not)

if you actually want to get good instead of arguing online — search "Iro AI" on the App Store.

#hottake #ai #aitok #unpopularopinion #tech`;

const STORYTIME_JSON = `{
  "preset": "storytime",
  "contact": "my friend",
  "hook": {
    "headline": "she said AI <strong>couldn't</strong> do her job",
    "subline": "so i showed her this..."
  },
  "items": [
    { "from": "them", "text": "there's no way AI can do what i do. it's all hype." },
    { "from": "me", "text": "ok give me the most annoying part of your week" },
    { "from": "them", "text": "honestly? turning my messy notes into a client report" },
    { "from": "me", "text": "watch this 👀" },
    { "from": "them", "text": "wait. it did in 10 seconds what takes me 2 hours??" }
  ],
  "cta": {
    "headline": "Want to <strong>actually</strong> use AI<br/>like that?",
    "instructionAbove": "search:",
    "searchTerm": "Iro AI",
    "instructionBelow": "on the App Store.",
    "slogan": "5 minutes a day.<br/><strong>start building.</strong>"
  },
  "attribution": ""
}`;

const STORYTIME_CAPTION = `she really thought AI was all hype 😭

watch her change her mind in real time

want to do that too? search "Iro AI" on the App Store. 5 min a day.

#ai #storytime #aitok #productivity #learnai`;

const STAT_DROP_JSON = `{
  "preset": "stat_drop",
  "hook": {
    "headline": "the <strong>AI numbers</strong> nobody tells you",
    "subline": "screenshot the one that scares you"
  },
  "items": [
    { "stat": "90%", "label": "of workers will use AI tools daily by 2026", "sub": "the ones who don't will feel it." },
    { "stat": "10x", "label": "faster on the boring tasks", "sub": "drafts, summaries, research — gone in seconds." },
    { "stat": "5 min", "label": "a day is all it takes to get fluent", "sub": "consistency beats cramming, every time." }
  ],
  "cta": {
    "headline": "Be on the <strong>right side</strong><br/>of these numbers.",
    "instructionAbove": "search:",
    "searchTerm": "Iro AI",
    "instructionBelow": "on the App Store.",
    "slogan": "5 minutes a day.<br/><strong>start building.</strong>"
  },
  "attribution": ""
}`;

const STAT_DROP_CAPTION = `the AI stats that should honestly scare you 📊

save this. the gap between people who use AI and people who don't is widening fast.

want to be on the right side? search "Iro AI" on the App Store.

#ai #stats #aitok #futureofwork #productivity`;

const THIS_OR_THAT_JSON = `{
  "preset": "this_or_that",
  "hook": {
    "headline": "pick one. <strong>be honest.</strong>",
    "subline": "comment your answers 👇"
  },
  "items": [
    { "prompt": "For your first AI project…", "a": "Automate the boring task", "b": "Build a fun side app" },
    { "prompt": "When AI gives a bad answer…", "a": "Reword the prompt", "b": "Give up and Google it" },
    { "prompt": "The better learning style?", "a": "5 min a day, forever", "b": "Cram a weekend course" }
  ],
  "cta": {
    "headline": "However you answered —<br/><strong>start actually doing it.</strong>",
    "instructionAbove": "search:",
    "searchTerm": "Iro AI",
    "instructionBelow": "on the App Store.",
    "slogan": "5 minutes a day. that's it."
  },
  "attribution": ""
}`;

const THIS_OR_THAT_CAPTION = `this or that: AI edition 👀 comment your picks, no skipping

i can guess your whole vibe from #3

want to stop overthinking and start building? search "Iro AI" on the App Store.

#thisorthat #ai #aitok #wouldyourather #tech`;

const QUOTE_CARD_JSON = `{
  "preset": "quote_card",
  "hook": {
    "headline": "5 quotes that <strong>rewired</strong><br/>how i use AI",
    "subline": "save the one that hits"
  },
  "items": [
    { "quote": "The future is already here — it's just not evenly distributed.", "author": "William Gibson" },
    { "quote": "The best way to predict the future is to invent it.", "author": "Alan Kay" },
    { "quote": "A tool is only as good as the question you bring to it.", "author": "Iro" },
    { "quote": "Don't fear the tool. Fear being the person who refused to learn it.", "author": "Iro" }
  ],
  "cta": {
    "headline": "Stop reading about it.<br/><strong>Go build something.</strong>",
    "instructionAbove": "search:",
    "searchTerm": "Iro AI",
    "instructionBelow": "on the App Store.",
    "slogan": "5 minutes a day. that's it."
  },
  "attribution": ""
}`;

const QUOTE_CARD_CAPTION = `save this one 🤍 5 quotes that genuinely changed how i think about AI

#4 lives in my head rent free

want to actually act on them? search "Iro AI" on the App Store.

#quotes #ai #motivation #aitok #mindset`;

const BEFORE_AFTER_JSON = `{
  "preset": "before_after",
  "hook": {
    "headline": "what 30 days of <strong>AI</strong> did<br/>to my workflow",
    "subline": "the before is embarrassing"
  },
  "items": [
    { "label": "My mornings", "before": "2 hours buried in my inbox before any real work.", "after": "AI drafts every reply; I approve them in 15 minutes." },
    { "label": "Writing", "before": "Staring at a blank doc, rewriting the same intro 6 times.", "after": "A solid first draft in one prompt, then I just edit." },
    { "label": "Learning", "before": "Saving tutorials I never watched.", "after": "Building tiny tools and actually remembering it." }
  ],
  "cta": {
    "headline": "Want this <strong>after</strong><br/>for yourself?",
    "instructionAbove": "search:",
    "searchTerm": "Iro AI",
    "instructionBelow": "on the App Store.",
    "slogan": "5 minutes a day.<br/><strong>start building.</strong>"
  },
  "attribution": ""
}`;

const BEFORE_AFTER_CAPTION = `30 days of actually using AI vs before 😮‍💨

the difference is genuinely unfair. save this as your roadmap.

want the after? search "Iro AI" on the App Store. 5 min a day.

#beforeandafter #ai #productivity #aitok #glowup`;

const COUNTDOWN_JSON = `{
  "preset": "countdown",
  "hook": {
    "headline": "top 5 <strong>AI skills</strong><br/>that actually pay",
    "subline": "#1 is the one everyone skips"
  },
  "items": [
    { "title": "Prompt structuring", "body": "Context + task + format. Boring, but it's 80% of good output." },
    { "title": "Verifying outputs", "body": "Knowing when the model is confidently wrong." },
    { "title": "Chaining tools", "body": "Wiring AI into the apps you already use." },
    { "title": "Automating the boring", "body": "Turning repeat tasks into one-click flows." },
    { "title": "Actually shipping", "body": "Building one small real thing beats 100 saved tutorials." }
  ],
  "cta": {
    "headline": "Learn all five —<br/><strong>5 minutes a day.</strong>",
    "instructionAbove": "search:",
    "searchTerm": "Iro AI",
    "instructionBelow": "on the App Store.",
    "slogan": "stop collecting tips.<br/><strong>start building.</strong>"
  },
  "attribution": ""
}`;

const COUNTDOWN_CAPTION = `top 5 AI skills that actually pay 💸 ranked

#1 is the one everyone scrolls past — don't.

want to learn them for real? search "Iro AI" on the App Store.

#ai #skills #aitok #careertok #productivity`;

const DEFINITION_JSON = `{
  "preset": "definition",
  "hook": {
    "headline": "<strong>AI words</strong> everyone<br/>pretends to know",
    "subline": "swipe — save the ones you didn't"
  },
  "items": [
    { "term": "Token", "pron": "/ˈtoʊ.kən/ · noun", "def": "A chunk of text (roughly ¾ of a word) that a model reads and writes one at a time.", "example": "Long prompts cost more tokens." },
    { "term": "Hallucination", "pron": "/həˌluː.sɪˈneɪ.ʃən/ · noun", "def": "When a model states something false with total confidence.", "example": "Always verify the citations." },
    { "term": "Context window", "pron": "noun phrase", "def": "How much text a model can keep in mind at once.", "example": "Paste the whole doc — it fits the context window." }
  ],
  "cta": {
    "headline": "Actually <strong>understand</strong> AI,<br/>not just the buzzwords.",
    "instructionAbove": "search:",
    "searchTerm": "Iro AI",
    "instructionBelow": "on the App Store.",
    "slogan": "5 minutes a day."
  },
  "attribution": ""
}`;

const DEFINITION_CAPTION = `AI words everyone pretends to know 📖 save this glossary

if you've been nodding along to "tokens" and "context windows" — this one's for you.

learn it properly: search "Iro AI" on the App Store.

#ai #glossary #aitok #learnai #tech`;

const QA_JSON = `{
  "preset": "qa",
  "hook": {
    "headline": "your <strong>AI questions</strong>,<br/>answered",
    "subline": "the ones you were too shy to ask"
  },
  "items": [
    { "q": "Do I need to learn to code first?", "a": "No. Start by describing what you want in plain English — the building teaches you the rest." },
    { "q": "Which AI tool should I actually use?", "a": "Whichever you'll open daily. A tool you use beats the \\"best\\" one you don't." },
    { "q": "Isn't it too late to start?", "a": "Six months of 5-min-a-day puts you ahead of 95% of people still just talking about it." }
  ],
  "cta": {
    "headline": "Got more questions?<br/><strong>We answer them daily.</strong>",
    "instructionAbove": "search:",
    "searchTerm": "Iro AI",
    "instructionBelow": "on the App Store.",
    "slogan": "5 minutes a day."
  },
  "attribution": ""
}`;

const QA_CAPTION = `answering your most-asked AI questions 🙋 part 1

drop yours below and i'll do a part 2 👇

want the full answers? search "Iro AI" on the App Store.

#ai #qa #aitok #learnai #askmeanything`;

const FLAGS_JSON = `{
  "preset": "flags",
  "hook": {
    "headline": "<strong>green flags</strong> your AI<br/>habit is actually working",
    "subline": "(and a few red ones)"
  },
  "items": [
    { "type": "green", "flag": "You build small things instead of just saving tutorials." },
    { "type": "green", "flag": "You can tell when the model is confidently wrong." },
    { "type": "red", "flag": "You collect 50 tools but ship with none of them." },
    { "type": "red", "flag": "You copy-paste outputs without ever editing them." }
  ],
  "cta": {
    "headline": "Want more <strong>green flags</strong>?",
    "instructionAbove": "search:",
    "searchTerm": "Iro AI",
    "instructionBelow": "on the App Store.",
    "slogan": "5 minutes a day."
  },
  "attribution": ""
}`;

const FLAGS_CAPTION = `green flags 🟢 vs red flags 🚩 of actually using AI

be honest — which one are you? 👀 comment below

want to be all green flags? search "Iro AI" on the App Store.

#ai #greenflags #redflags #aitok #productivity`;

const STEPS_JSON = `{
  "preset": "steps",
  "hook": {
    "headline": "build your <strong>first AI tool</strong><br/>in 4 steps",
    "subline": "no code, ~10 minutes"
  },
  "items": [
    { "title": "Pick one annoying task", "body": "Something you redo every week — a report, a reply, a summary." },
    { "title": "Describe it to the AI", "body": "Plain English: the input, the output, and the format you want." },
    { "title": "Wire it to your tools", "body": "Drop it into the app you already use so it runs where you work." },
    { "title": "Use it daily, then tweak", "body": "Real use shows you the one prompt line worth fixing." }
  ],
  "cta": {
    "headline": "Want the <strong>guided</strong> version?",
    "instructionAbove": "search:",
    "searchTerm": "Iro AI",
    "instructionBelow": "on the App Store.",
    "slogan": "5 minutes a day."
  },
  "attribution": ""
}`;

const STEPS_CAPTION = `how to build your first AI tool in 4 steps 🛠️ save this

step 2 is where most people overthink it — keep it plain.

want it guided? search "Iro AI" on the App Store.

#ai #tutorial #howto #aitok #nocode`;

export const PRESETS: Record<PresetKey, PresetMeta> = {
  prompt_pack: {
    key: 'prompt_pack',
    label: 'Prompt Pack',
    pitch: 'Save-bait list. Big numbered prompts in chat-style boxes.',
    status: 'ready',
    defaultJson: PROMPT_PACK_JSON,
    defaultCaption: PROMPT_PACK_CAPTION,
    accent: '#00E5FF', // brand cyan
  },
  pain_story: {
    key: 'pain_story',
    label: 'Pain Story',
    pitch: 'Aesthetic photo bg + italic serif confession. Soft CTA.',
    status: 'ready',
    defaultJson: PAIN_STORY_JSON,
    defaultCaption: PAIN_STORY_CAPTION,
    accent: '#E8B4BC', // dusty rose, matches the editorial serif vibe
  },
  aspirational: {
    key: 'aspirational',
    label: 'Aspirational',
    pitch: 'Cinematic luxury. Bottom-anchored bold hooks, gold + cyan accents.',
    status: 'ready',
    defaultJson: ASPIRATIONAL_JSON,
    defaultCaption: ASPIRATIONAL_CAPTION,
    accent: '#FFC857', // gold, matches the engine's <strong> highlight
  },
  meme_pov: {
    key: 'meme_pov',
    label: 'Meme / POV',
    pitch: 'Image-dominant. Top/bottom captions with thick stroke, minimal branding.',
    status: 'ready',
    defaultJson: MEME_POV_JSON,
    defaultCaption: MEME_POV_CAPTION,
    accent: '#FFFFFF', // pure white = the meme caption color
  },
  product_demo: {
    key: 'product_demo',
    label: 'Product Demo',
    pitch: 'Phone mockup + Iro screenshots. Branded benefit captions per slide.',
    status: 'ready',
    defaultJson: PRODUCT_DEMO_JSON,
    defaultCaption: PRODUCT_DEMO_CAPTION,
    accent: '#00E5FF', // brand cyan
  },
  checklist: {
    key: 'checklist',
    label: 'Checklist',
    pitch: 'Scannable “if you…” qualifier. Big tinted check / cross / warning icons.',
    status: 'ready',
    defaultJson: CHECKLIST_JSON,
    defaultCaption: CHECKLIST_CAPTION,
    accent: '#22C55E', // green check
  },
  handwritten_pack: {
    key: 'handwritten_pack',
    label: 'Handwritten Pack',
    pitch: 'Cream paper + handwritten ink. Same prompt-pack structure, notebook aesthetic.',
    status: 'ready',
    defaultJson: HANDWRITTEN_PACK_JSON,
    defaultCaption: HANDWRITTEN_PACK_CAPTION,
    accent: '#1a2858', // ink-on-paper navy
  },
  app_stack: {
    key: 'app_stack',
    label: 'App Stack',
    pitch: '"5 apps I use every day" carousel. Photo bgs + app icons + short descriptions.',
    status: 'ready',
    defaultJson: APP_STACK_JSON,
    defaultCaption: APP_STACK_CAPTION,
    accent: '#A78BFA', // purple, distinct from other presets
  },
  output_vs_hype: {
    key: 'output_vs_hype',
    label: 'Output vs Hype',
    pitch: 'One slide per AI tool. Brand logo + two bars (Output vs Hype) tinted to match.',
    status: 'ready',
    defaultJson: OUTPUT_VS_HYPE_JSON,
    defaultCaption: OUTPUT_VS_HYPE_CAPTION,
    accent: '#00E5FF', // brand cyan, matches the chart labels
  },
  curated_list: {
    key: 'curated_list',
    label: 'Curated List',
    pitch: 'Aesthetic photo + cream heading (optional highlighter) + a recommendation card per slide.',
    status: 'ready',
    defaultJson: CURATED_LIST_JSON,
    defaultCaption: CURATED_LIST_CAPTION,
    accent: '#F1DF79', // warm highlighter yellow
  },
  tier_list: {
    key: 'tier_list',
    label: 'Tier List',
    pitch: 'S/A/B/C ranking. One colored tier per slide with its items. "I ranked every X".',
    status: 'ready',
    defaultJson: TIER_LIST_JSON,
    defaultCaption: TIER_LIST_CAPTION,
    accent: '#FF6B6B', // S-tier red
  },
  myth_fact: {
    key: 'myth_fact',
    label: 'Myth vs Fact',
    pitch: 'Bust misconceptions. Red ✗ MYTH card over a green ✓ FACT card, one pair per slide.',
    status: 'ready',
    defaultJson: MYTH_FACT_JSON,
    defaultCaption: MYTH_FACT_CAPTION,
    accent: '#22C55E', // fact green
  },
  hot_take: {
    key: 'hot_take',
    label: 'Hot Take',
    pitch: 'Bold full-bleed opinions on a fiery gradient. One spicy claim + defense per slide.',
    status: 'ready',
    defaultJson: HOT_TAKE_JSON,
    defaultCaption: HOT_TAKE_CAPTION,
    accent: '#FF6B4D', // ember orange-red
  },
  storytime: {
    key: 'storytime',
    label: 'Storytime',
    pitch: 'iMessage-style chat that plays forward as you swipe. Great for jaw-dropping "they said WHAT" stories.',
    status: 'ready',
    defaultJson: STORYTIME_JSON,
    defaultCaption: STORYTIME_CAPTION,
    accent: '#34C759', // imessage green
  },
  stat_drop: {
    key: 'stat_drop',
    label: 'Stat Drop',
    pitch: 'One giant glowing statistic per slide + context. Shock-value "the numbers speak for themselves" posts.',
    status: 'ready',
    defaultJson: STAT_DROP_JSON,
    defaultCaption: STAT_DROP_CAPTION,
    accent: '#00E5FF', // brand cyan
  },
  this_or_that: {
    key: 'this_or_that',
    label: 'This or That',
    pitch: 'Binary "comment your pick" polls — two option panels split by a VS badge. Engagement bait.',
    status: 'ready',
    defaultJson: THIS_OR_THAT_JSON,
    defaultCaption: THIS_OR_THAT_CAPTION,
    accent: '#FF2D9B', // hot pink (option A)
  },
  quote_card: {
    key: 'quote_card',
    label: 'Quote Card',
    pitch: 'Aesthetic serif quotes with a big mark + author. Save-bait wisdom carousels.',
    status: 'ready',
    defaultJson: QUOTE_CARD_JSON,
    defaultCaption: QUOTE_CARD_CAPTION,
    accent: '#FFC857', // warm gold
  },
  before_after: {
    key: 'before_after',
    label: 'Before / After',
    pitch: 'Transformation slides — a muted BEFORE card, arrow, then a glowing AFTER. Aspirational proof.',
    status: 'ready',
    defaultJson: BEFORE_AFTER_JSON,
    defaultCaption: BEFORE_AFTER_CAPTION,
    accent: '#22C55E', // transformation green
  },
  countdown: {
    key: 'countdown',
    label: 'Countdown',
    pitch: 'Ranked listicle counting down to a gold #1. "Top 5… #1 will surprise you".',
    status: 'ready',
    defaultJson: COUNTDOWN_JSON,
    defaultCaption: COUNTDOWN_CAPTION,
    accent: '#FFC857', // gold #1
  },
  definition: {
    key: 'definition',
    label: 'Definition',
    pitch: 'Clean dictionary cards on cream — term, pronunciation, definition, example. "AI word of the day".',
    status: 'ready',
    defaultJson: DEFINITION_JSON,
    defaultCaption: DEFINITION_CAPTION,
    accent: '#b8861b', // dictionary gold
  },
  qa: {
    key: 'qa',
    label: 'Q&A',
    pitch: 'AMA / FAQ — an Instagram-style question sticker + your answer per slide.',
    status: 'ready',
    defaultJson: QA_JSON,
    defaultCaption: QA_CAPTION,
    accent: '#A78BFA', // sticker violet
  },
  flags: {
    key: 'flags',
    label: 'Green / Red Flags',
    pitch: 'One color-coded flag per slide — "green flags / red flags of X". Comment-bait.',
    status: 'ready',
    defaultJson: FLAGS_JSON,
    defaultCaption: FLAGS_CAPTION,
    accent: '#34D399', // green flag
  },
  steps: {
    key: 'steps',
    label: 'Steps / Tutorial',
    pitch: 'Sequential how-to — one numbered step per slide with a progress bar.',
    status: 'ready',
    defaultJson: STEPS_JSON,
    defaultCaption: STEPS_CAPTION,
    accent: '#00E5FF', // progress cyan
  },
};
