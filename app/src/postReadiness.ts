// Post-readiness score. The app now surfaces a lot of individual signals —
// hook strength, hashtag mix, a comment prompt, deck pacing, the structural
// pre-publish checks. This synthesizes them into ONE glanceable 0-100 verdict
// plus the single highest-impact thing to fix next, so the creator knows "is
// this ready?" and "what do I do about it?" without scanning five widgets.
//
// Pure: takes the already-computed signals, returns a verdict. It consumes
// the other modules' outputs rather than recomputing, so it can never
// disagree with what those widgets show.

export type ReadinessTier = 'ready' | 'almost' | 'rough';

export type ReadinessInput = {
  hookScore: number;            // 0-100 from scoreHook
  hookTips: string[];
  hashtagTier: 'strong' | 'okay' | 'weak';
  hashtagCount: number;
  hashtagTips: string[];
  invitesComment: boolean;
  deckBalanced: boolean;
  deckTip: string | null;
  validJson: boolean;
  hasCta: boolean;
  slideCount: number;
  captionLen: number;
};

export type Readiness = {
  score: number;        // 0-100 composite
  tier: ReadinessTier;
  topFix: string | null; // the single most impactful next action, or null when ready
};

const HASHTAG_WEIGHT: Record<'strong' | 'okay' | 'weak', number> = {
  strong: 1,
  okay: 0.6,
  weak: 0.2,
};

function tierFor(score: number): ReadinessTier {
  if (score >= 80) return 'ready';
  if (score >= 55) return 'almost';
  return 'rough';
}

export function computeReadiness(i: ReadinessInput): Readiness {
  // Quality components (sum 80) + structure (sum 20) = 100.
  const hook = 0.35 * (Math.max(0, Math.min(100, i.hookScore)) / 100); // 0..0.35
  const engagement = i.invitesComment ? 0.15 : 0;
  const hashtags = 0.20 * (i.hashtagCount === 0 ? 0 : HASHTAG_WEIGHT[i.hashtagTier]);
  const deck = i.deckBalanced ? 0.10 : 0;
  // Structure: four 5-point gates.
  const structure =
    (i.validJson ? 0.05 : 0) +
    (i.slideCount >= 3 ? 0.05 : 0) +
    (i.hasCta ? 0.05 : 0) +
    (i.captionLen > 0 && i.captionLen <= 2200 ? 0.05 : 0);

  const score = Math.round((hook + engagement + hashtags + deck + structure) * 100);

  // Single highest-impact fix, hardest blockers first: a post that won't
  // render or has nothing to swipe matters more than a soft hook.
  let topFix: string | null = null;
  if (!i.validJson) topFix = 'Fix the JSON — the post won’t render.';
  else if (i.slideCount < 3) topFix = 'Add slides — aim for 3+ so it’s worth swiping.';
  else if (i.captionLen === 0) topFix = 'Write a caption with your hook in the first line.';
  else if (i.captionLen > 2200) topFix = 'Trim the caption under 2,200 characters.';
  else if (!i.hasCta) topFix = 'Add a call-to-action slide.';
  else if (i.hookScore < 40) topFix = i.hookTips[0] || 'Strengthen your hook — it decides who swipes.';
  else if (!i.invitesComment) topFix = 'Ask a question so viewers comment — it drives reach.';
  else if (i.hashtagTier === 'weak') topFix = i.hashtagTips[0] || 'Tighten your hashtag mix.';
  else if (!i.deckBalanced) topFix = i.deckTip || 'Balance your slide lengths.';
  else if (i.slideCount > 12) topFix = 'Trim toward ~10 slides — long carousels lose viewers before the end.';
  else if (i.hookScore < 70) topFix = i.hookTips[0] || 'Sharpen the hook a touch more.';

  return { score, tier: tierFor(score), topFix };
}

export const READINESS_COLOR: Record<ReadinessTier, string> = {
  ready: '#22C55E',
  almost: '#FFC857',
  rough: '#F59E0B',
};

export const READINESS_TEXT: Record<ReadinessTier, string> = {
  ready: 'Ready to post',
  almost: 'Almost there',
  rough: 'Needs work',
};
