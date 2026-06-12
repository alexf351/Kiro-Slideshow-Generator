// Inspiration library for the Discover tab. A curated set of the slideshow
// PATTERNS that reliably go viral on TikTok/Reels — the structure + the hook
// formula + why it works — each mapped to one of the app's formats so a
// creator can browse them and "Adapt" one into the editor in a tap.
//
// This is the "look at other viral slideshows and adapt them" surface:
// instead of scraping (fragile, against ToS), it distills the recurring,
// recognizable viral shapes into reusable starting points. Each entry seeds
// the matching format + a topic angle so the AI ("Full post") can spin up the
// creator's own version in that proven shape.

import type { PresetKey } from './presets';

// The viral mechanic — why the pattern travels. Used as the filter chips.
export type ViralMechanic =
  | 'Listicle' | 'Story' | 'Social proof' | 'Hot take' | 'Reveal' | 'Transformation' | 'Relatable';

export type ViralPattern = {
  id: string;
  title: string;        // the pattern's name
  mechanic: ViralMechanic;
  preset: PresetKey;    // the app format that renders this shape
  hook: string;         // the opening-line formula (with {blanks})
  example: string;      // one concrete filled-in example, for inspiration
  why: string;          // one sentence: the viral mechanic at work
  // Seed for the "Full post" topic field so Adapt can one-tap AI-generate the
  // creator's own version in this shape.
  adapt: string;
};

export const VIRAL_MECHANICS: ViralMechanic[] = [
  'Listicle', 'Story', 'Social proof', 'Hot take', 'Reveal', 'Transformation', 'Relatable',
];

export const VIRAL_PATTERNS: ViralPattern[] = [
  {
    id: 'wish-i-knew',
    title: 'Things I wish I knew before {X}',
    mechanic: 'Listicle',
    preset: 'curated_list',
    hook: '5 things i wish i knew before {milestone}',
    example: '5 things i wish i knew before learning to code',
    why: 'Regret + curiosity: the viewer fears missing the lesson, so they swipe and save.',
    adapt: 'the things you wish you knew before [your topic] — 5 hard-won lessons',
  },
  {
    id: 'ranked-every',
    title: 'I ranked every {X}',
    mechanic: 'Hot take',
    preset: 'tier_list',
    hook: 'i ranked every {thing} so you don’t have to',
    example: 'i ranked every AI tool from S to F tier',
    why: 'A confident ranking is comment bait — everyone wants to argue their pick.',
    adapt: 'an S-to-F tier ranking of [the things in your niche], with a spicy take per tier',
  },
  {
    id: 'green-red-flags',
    title: 'Green flags vs red flags',
    mechanic: 'Hot take',
    preset: 'flags',
    hook: 'green flags 🟢 vs red flags 🚩 in {topic}',
    example: 'green flags vs red flags in a productivity app',
    why: 'Binary judgment is instantly shareable and tags a friend who needs it.',
    adapt: 'green flags vs red flags in [your topic]',
  },
  {
    id: 'search-history',
    title: 'What your {search history} says about you',
    mechanic: 'Reveal',
    preset: 'search',
    hook: 'what your search history says about you',
    example: 'the things every new founder secretly googles',
    why: 'A relatable reveal — viewers see themselves and comment “this is me”.',
    adapt: 'the search-bar autocompletes that expose [your audience] (relatable + a little roasty)',
  },
  {
    id: 'tweets-that-get-it',
    title: 'Tweets that {get it}',
    mechanic: 'Social proof',
    preset: 'tweet',
    hook: 'tweets about {topic} that live in my head rent free',
    example: 'tweets that explain the AI hype better than any expert',
    why: 'Borrowed authority — a punchy “tweet” feels like a stranger validating your point.',
    adapt: 'tweet-style one-liners that nail the truth about [your topic]',
  },
  {
    id: 'aita-story',
    title: 'AITA / Reddit story',
    mechanic: 'Story',
    preset: 'reddit',
    hook: 'AITA for {controversial thing}?',
    example: 'AITA for automating my whole job and not telling anyone?',
    why: 'A cliffhanger story with a moral verdict keeps people swiping for the update.',
    adapt: 'a Reddit-style AITA / story-time about [a relatable conflict in your niche], with an update twist',
  },
  {
    id: 'breaking-news',
    title: 'BREAKING: {satirical headline}',
    mechanic: 'Relatable',
    preset: 'news',
    hook: 'BREAKING: {exaggerated true thing}',
    example: 'BREAKING: local man finishes his workday by 10:43am',
    why: 'A news-parody chyron is a pattern interrupt that reads as “important” mid-scroll.',
    adapt: 'breaking-news-parody headlines about [your topic], each a little too real',
  },
  {
    id: 'what-people-saying',
    title: 'What people are saying about {X}',
    mechanic: 'Social proof',
    preset: 'receipts',
    hook: 'what people are saying about {product/idea}',
    example: 'the reviews that made me finally try it',
    why: 'Star-review “receipts” are social proof you can’t argue with.',
    adapt: 'gold-star testimonial cards (real or composite) about [your product/idea]',
  },
  {
    id: 'notes-app-confession',
    title: 'Notes-app confession / announcement',
    mechanic: 'Story',
    preset: 'notes',
    hook: 'had to put it in the notes app to actually say it',
    example: 'why i quit my 9–5 (a notes app story)',
    why: 'The notes-app aesthetic signals raw honesty — viewers read it like a diary.',
    adapt: 'a notes-app confession / announcement about [a turning point in your story]',
  },
  {
    id: 'stop-do-instead',
    title: 'Stop {X}, do {Y} instead',
    mechanic: 'Hot take',
    preset: 'checklist',
    hook: 'stop {common mistake} — do this instead',
    example: 'stop watching AI tutorials — build this instead',
    why: 'A contrarian fix promises a shortcut and frames the viewer’s current habit as the problem.',
    adapt: 'the common mistakes in [your topic] and the punchy “do this instead” fix for each',
  },
  {
    id: 'tools-you-need',
    title: '{N} {tools} you need for {X}',
    mechanic: 'Listicle',
    preset: 'app_stack',
    hook: '5 {tools} that do {outcome} for you',
    example: '5 apps that run my entire content workflow',
    why: 'Pure save-bait utility — viewers save the list to come back to it.',
    adapt: 'the [N] tools/apps every [audience] needs for [outcome], one per slide',
  },
  {
    id: 'routine-that',
    title: 'The {time} routine that {outcome}',
    mechanic: 'Transformation',
    preset: 'steps',
    hook: 'the {5-minute} routine that {big outcome}',
    example: 'the 5-minute morning routine that fixed my focus',
    why: 'A small, concrete routine feels achievable — low effort, big promised payoff.',
    adapt: 'a step-by-step [time-bound] routine that delivers [outcome] in your niche',
  },
  {
    id: 'stat-shock',
    title: 'This {stat} will {shock you}',
    mechanic: 'Reveal',
    preset: 'stat_drop',
    hook: '{shocking number}% of people {surprising fact}',
    example: '97% of people use ChatGPT wrong',
    why: 'A bold number stops the scroll and demands the context on the next slide.',
    adapt: 'the eye-popping stats about [your topic], one giant number per slide',
  },
  {
    id: 'before-after',
    title: 'Before vs after {X}',
    mechanic: 'Transformation',
    preset: 'before_after',
    hook: '{thing}: before vs after',
    example: 'my content: before vs after i learned hooks',
    why: 'A visible transformation is proof — the “after” is the result they want.',
    adapt: 'a before-vs-after on [a transformation in your niche], with the turning point',
  },
  {
    id: 'unpopular-opinion',
    title: 'Unpopular opinion: {claim}',
    mechanic: 'Hot take',
    preset: 'hot_take',
    hook: 'unpopular opinion: {contrarian claim}',
    example: 'unpopular opinion: most productivity apps make you less productive',
    why: 'A divisive claim splits the comments into camps — engagement skyrockets.',
    adapt: 'your most defensible hot takes about [your topic], one bold opinion per slide',
  },
  {
    id: 'glow-up',
    title: 'How it started vs how it’s going',
    mechanic: 'Transformation',
    preset: 'timeline',
    hook: 'the {thing} glow-up: how it started → now',
    example: 'how my side project went from 0 to 40k in 6 months',
    why: 'A timeline of milestones is an aspirational arc viewers want to follow.',
    adapt: 'a how-it-started-vs-now timeline of [your journey], milestone by milestone',
  },
  {
    id: 'pov-achieved',
    title: 'POV: you {achieved X}',
    mechanic: 'Relatable',
    preset: 'meme_pov',
    hook: 'POV: you finally {did the thing}',
    example: 'POV: you finally stopped doom-scrolling and started building',
    why: 'Second-person POV drops the viewer into the win — aspirational immersion.',
    adapt: 'a POV / meme take on [the win or struggle] your audience knows',
  },
  {
    id: 'iceberg-secrets',
    title: 'Secrets {audience} are gatekeeping',
    mechanic: 'Reveal',
    preset: 'checklist',
    hook: '{N} {topic} secrets the pros are gatekeeping',
    example: '5 editing tricks creators are gatekeeping',
    why: 'Forbidden-knowledge framing triggers FOMO — “they don’t want you to know this”.',
    adapt: 'the “gatekept secrets” of [your niche] — insider tips framed as forbidden knowledge',
  },
];
