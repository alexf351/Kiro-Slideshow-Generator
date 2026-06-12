// Free, offline hook inspiration. The AI hook-variations feature needs an
// API key and a round-trip; this is the instant, no-cost counterpart — a
// curated set of proven TikTok hook STRUCTURES with {placeholders} the
// creator fills in. The hook is the single highest-leverage line on a
// carousel, so beating the blank-page moment is worth a lot. Tapping one
// drops it into the caption's first line (via replaceFirstLine), where the
// hook-strength meter immediately scores it.
//
// Each formula leans on a pattern that reliably stops the scroll: a number,
// a curiosity gap, a contrarian claim, direct address, or stakes.

export const HOOK_FORMULAS: string[] = [
  '3 {things} nobody tells you about {topic}',
  'POV: you just found the {thing} that changes everything',
  'stop {doing this} — do this instead',
  'the {tool} that does {outcome} in {time}',
  'i tried {thing} for {duration}. here’s what happened',
  '{number} {things} i wish i knew before {milestone}',
  'you’re using {thing} wrong. here’s the fix',
  'this {thing} should honestly be illegal',
  'nobody talks about {thing}, but it {outcome}',
  'the {adjective} truth about {topic}',
  'save this before {thing} gets {worse/gatekept}',
  'how to {outcome} without {the hard part}',
  'why everyone is wrong about {topic}',
  '{audience}: this is your sign to {action}',
  'i was today years old when i learned {fact}',
  'the {time} routine that {big outcome}',
  'things i’d do differently if i started {thing} again',
  'green flags vs red flags in {topic}',
  'unpopular opinion: {claim}',
  'read this if you {feel/struggle with X}',
  'what they don’t want you to know about {topic}',
  'i ranked every {thing} so you don’t have to',
  'the only {thing} guide you’ll ever need',
  'how i went from {before} to {after}',
  'no one is talking about {thing} and it’s costing you {cost}',
  'the {number}-second trick that {outcome}',
  'i quit {thing} — best decision i ever made',
  'if you {do this}, watch this before you {do that}',
  'your {thing} is mid. here’s why',
  'the {thing} {audience} are gatekeeping',
  'rating {things} so you don’t waste your {time/money}',
  'everyone’s doing {thing} wrong (including past me)',
  'the {thing} that broke my brain',
  'watch this if you’ve ever {felt/done this}',
  '{thing}: expectation vs reality',
  'normalize {behavior}',
  'tell me you {trait} without telling me you {trait}',
];

// A shuffled subset of `n` formulas — gives the "show me a few, shuffle for
// more" feel. The shuffle is a non-mutating Fisher–Yates so the source list
// is never reordered. `rng` is injectable for deterministic tests.
export function sampleFormulas(n = 6, rng: () => number = Math.random): string[] {
  const a = HOOK_FORMULAS.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, Math.max(1, Math.min(n, a.length)));
}
