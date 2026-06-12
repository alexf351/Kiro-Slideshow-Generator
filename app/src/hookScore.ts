// Live hook-strength meter. On TikTok the first line / first slide decides
// whether anyone swipes — a weak hook sinks even great content. The Hook
// Library (hooks.ts) tells you which of your PAST hooks performed; this
// scores the hook you're writing RIGHT NOW against the patterns that
// reliably stop the scroll, and hands back concrete fixes for what's
// missing. Deterministic, no API, instant — a free first-pass before the
// AI tools.

// Words that signal curiosity, stakes or emotion — the levers that make a
// viewer need to see slide 2. Matched as whole words, case-insensitive.
const POWER_WORDS = [
  'secret', 'secrets', 'mistake', 'mistakes', 'nobody', 'everyone', 'stop',
  'never', 'always', 'instantly', 'proven', 'worst', 'best', 'hack', 'hacks',
  'truth', 'wrong', 'wish', 'regret', 'avoid', 'underrated', 'overrated',
  'free', 'fast', 'easy', 'simple', 'now', 'before', 'after', 'actually',
  'lying', 'lied', 'ruining', 'broke', 'rich', 'hidden', 'banned', 'illegal',
];

// Question / curiosity-gap openers — phrases that promise a payoff.
const CURIOSITY_OPENERS = [
  'how', 'why', 'what', 'the secret', 'nobody tells you', 'stop', "don't",
  'do not', 'here', "here's", 'these', 'this is', 'the one', 'the real',
  'the truth', 'i wish', 'before you', 'if you', 'you need', 'you should',
  'things', 'reasons', 'ways', 'signs',
];

export type HookTier = 'weak' | 'okay' | 'strong';

export type HookScore = {
  score: number;     // 0-100
  tier: HookTier;
  wordCount: number;
  tips: string[];    // concrete, prioritized fixes for what's missing
  // Which signals fired — lets the UI show a compact checklist.
  signals: {
    length: boolean;
    number: boolean;
    curiosity: boolean;
    powerWord: boolean;
    directAddress: boolean;
  };
};

function words(s: string): string[] {
  return (s || '').trim().split(/\s+/).filter(Boolean);
}

function hasWholeWord(haystackLower: string, word: string): boolean {
  // Escape nothing fancy — our lists are plain words/phrases. Word-boundary
  // match so "now" doesn't fire inside "knowing".
  return new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(haystackLower);
}

function tierFor(score: number): HookTier {
  if (score >= 70) return 'strong';
  if (score >= 40) return 'okay';
  return 'weak';
}

// Score a single hook line (already plain text — strip HTML/markup before
// calling). Empty input scores 0 with a single "write a hook" tip.
export function scoreHook(raw: string): HookScore {
  const hook = (raw || '').trim();
  const wl = words(hook);
  const wordCount = wl.length;
  const lower = hook.toLowerCase();

  if (wordCount === 0) {
    return {
      score: 0, tier: 'weak', wordCount: 0,
      tips: ['Write a hook — the first line is what stops the scroll.'],
      signals: { length: false, number: false, curiosity: false, powerWord: false, directAddress: false },
    };
  }

  // --- Signals ---
  // Length: 3–12 words is the punchy sweet spot. Too short reads like a
  // fragment; too long buries the hook.
  const length = wordCount >= 3 && wordCount <= 12;
  const number = /\d/.test(hook);
  const isQuestion = hook.includes('?');
  // Curiosity gap: a question, a single-word opener at the START (how / why /
  // stop…), or a multi-word curiosity phrase ANYWHERE in the line ("nobody
  // tells you", "the secret"), since those promise a payoff mid-sentence too.
  const curiosityOpener =
    isQuestion ||
    CURIOSITY_OPENERS.some((o) =>
      o.includes(' ') ? lower.includes(o) : lower.startsWith(o),
    );
  const powerWord = POWER_WORDS.some((w) => hasWholeWord(lower, w));
  const directAddress = /\byou\b|\byour\b|\byou're\b|\byou'll\b/i.test(hook);

  // --- Score (weighted, capped 0-100) ---
  let score = 20; // a non-empty hook of any kind starts here
  if (length) score += 22;
  else if (wordCount > 12) score += 4; // long but present
  if (number) score += 16;
  if (curiosityOpener) score += 20;
  if (powerWord) score += 14;
  if (directAddress) score += 10;
  // Tiny readability nudge: an all-caps SHOUTING hook over a few words reads
  // as spam, shave a little.
  if (hook.length > 8 && hook === hook.toUpperCase() && /[A-Z]/.test(hook)) score -= 8;
  score = Math.max(0, Math.min(100, score));

  // --- Tips (only for what's missing, most impactful first) ---
  const tips: string[] = [];
  if (!length && wordCount > 12) tips.push(`Tighten it — ${wordCount} words is long. Aim for 3–12 so the hook lands fast.`);
  if (!length && wordCount < 3) tips.push('Give it a bit more — a 3–12 word hook reads as a complete promise.');
  if (!curiosityOpener) tips.push('Open a curiosity gap: ask a question or start with “how / why / nobody tells you…”.');
  if (!number) tips.push('Add a number (“3 ways”, “in 7 days”) — specifics out-pull vague claims.');
  if (!powerWord) tips.push('Raise the stakes with a power word (secret, mistake, stop, proven, underrated).');
  if (!directAddress) tips.push('Talk to one person — “you / your” makes it feel addressed to the viewer.');

  return {
    score, tier: tierFor(score), wordCount, tips,
    signals: { length, number, curiosity: curiosityOpener, powerWord, directAddress },
  };
}

export const HOOK_TIER_COLOR: Record<HookTier, string> = {
  strong: '#22C55E',
  okay: '#FFC857',
  weak: '#F59E0B',
};

export const HOOK_TIER_TEXT: Record<HookTier, string> = {
  strong: 'Strong hook',
  okay: 'Okay hook',
  weak: 'Weak hook',
};
