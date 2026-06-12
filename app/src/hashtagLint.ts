// Hashtag-mix linter. "Suggest hashtags" (insights.ts) mines the tags that
// travelled with THIS account's winners; this is the deterministic strategy
// check on whatever's in the caption right now. TikTok rewards a tight,
// relevant set — a few broad-reach tags plus specific niche tags — and reads
// a wall of generic #fyp/#viral spam as low-signal. So we grade the COUNT and
// the MIX, not the individual tags, and hand back the one fix that matters.
//
// Pure (caption string in, verdict out), reusing parseHashtags so it sees
// exactly the tags the rest of the app counts.

import { parseHashtags } from './insights';

// Generic "reach" tags that carry almost no topical signal. A caption made
// ONLY of these is shouting into the void — TikTok can't tell who to show it
// to. Stored without the leading '#', lowercase.
const GENERIC_TAGS = new Set([
  'fyp', 'fypage', 'fypシ', 'foryou', 'foryoupage', 'foryourpage', '4u', '4you',
  'viral', 'viralvideo', 'trending', 'trend', 'explore', 'explorepage',
  'tiktok', 'follow', 'followme', 'like', 'likeforlike', 'pageforyou', 'pourtoi',
  'parati', 'xyzbca', 'xybca', 'foryoupageofficiall', 'blowthisup', 'makethisviral',
]);

export type HashtagTier = 'weak' | 'okay' | 'strong';

export type HashtagLint = {
  tier: HashtagTier;
  count: number;        // total distinct tags
  genericCount: number; // how many of them are generic reach tags
  nicheCount: number;   // count - genericCount
  tips: string[];       // prioritized, only what's wrong
};

function tierFor(count: number, niche: number, generic: number): HashtagTier {
  if (count === 0) return 'weak';
  // The sweet spot: 3-6 tags with at least two specific/niche ones.
  if (count >= 3 && count <= 8 && niche >= 2 && generic <= 4) return 'strong';
  // Has at least one niche tag and isn't spammy.
  if (niche >= 1 && count <= 12) return 'okay';
  return 'weak';
}

export function isGenericTag(tag: string): boolean {
  return GENERIC_TAGS.has(tag.toLowerCase());
}

// Grade the hashtags in a caption. `count === 0` is its own "add some" case.
export function lintHashtags(caption: string): HashtagLint {
  const tags = parseHashtags(caption); // distinct, lowercased, no '#'
  const count = tags.length;
  const genericCount = tags.filter((t) => GENERIC_TAGS.has(t)).length;
  const nicheCount = count - genericCount;

  const tips: string[] = [];
  if (count === 0) {
    tips.push('Add 3–5 hashtags so TikTok knows who to show this to.');
  } else {
    if (count < 3) tips.push('Add a couple more — 3–5 relevant tags beats one or two.');
    if (count > 12) tips.push(`Trim to ~5 — ${count} tags reads as spam and dilutes relevance.`);
    if (nicheCount === 0) tips.push('All your tags are generic (#fyp, #viral). Add specific niche tags so the algorithm can place it.');
    else if (nicheCount < 2 && count >= 3) tips.push('Add another specific niche tag — broad tags alone rarely find the right audience.');
    if (genericCount > 4) tips.push('Cut some generic reach tags — a few is fine, a pile looks desperate.');
  }

  return { tier: tierFor(count, nicheCount, genericCount), count, genericCount, nicheCount, tips };
}

export const HASHTAG_TIER_COLOR: Record<HashtagTier, string> = {
  strong: '#22C55E',
  okay: '#FFC857',
  weak: '#F59E0B',
};

export const HASHTAG_TIER_TEXT: Record<HashtagTier, string> = {
  strong: 'Good tag mix',
  okay: 'Okay tags',
  weak: 'Weak tags',
};
