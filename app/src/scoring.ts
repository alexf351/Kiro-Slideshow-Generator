// Deterministic performance scoring for the user's own posts.
//
// The problem: raw view counts are meaningless in isolation — 5k views is
// a flop for one account and a smash for another. So a post's score is
// computed RELATIVE to the rest of the user's history (where do its views
// rank?) blended with absolute engagement-quality signals that travel
// across account sizes (save rate, share rate, swipe-through).
//
// Everything here is a pure function of the post + the population, so it's
// cheap, explainable, and needs no API. The LLM predictor (predict.ts)
// reads these scores back as labeled training context — this file is the
// "ground truth" the predictor learns to match.

import type { Post, PostStats } from './posts';

export type ScoreLabel = 'breakout' | 'strong' | 'solid' | 'soft' | 'flop';

export type ScoreBreakdown = {
  score: number;            // 0-100 composite
  label: ScoreLabel;
  reachPercentile: number;  // 0-1: where `views` ranks in the user's history
  engagementRate: number;   // (likes+comments+shares+saves) / views
  saveRate: number;         // saves / views — strongest "TikTok will push it" signal
  shareRate: number;        // shares / views
  swipeThrough: number | null; // photoViews / views, or null when unknown
  // 'relative' once there's enough history to rank against; 'absolute'
  // for the first few posts, where we lean on engagement benchmarks only.
  basis: 'relative' | 'absolute';
};

// Engagement-rate ceilings used to normalize a rate into 0-1. These are
// rough TikTok "this is excellent" marks — hitting the ceiling maps to 1.
const ENGAGEMENT_CEIL = 0.18; // total engagement / views
const SAVE_CEIL = 0.05;       // saves / views
const SHARE_CEIL = 0.04;      // shares / views

const RELATIVE_MIN_HISTORY = 3; // need this many ranked posts to rank fairly

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function safeRate(numerator: number, views: number): number {
  return views > 0 ? numerator / views : 0;
}

export function readStats(stats: PostStats) {
  return {
    views: stats.views || 0,
    likes: stats.likes || 0,
    comments: stats.comments || 0,
    shares: stats.shares || 0,
    saves: stats.saves || 0,
    photoViews: stats.photoViews || 0,
  };
}

// Fraction of `population` whose views are strictly below `views`. With
// ties, a post lands at the bottom of its tie group, which is the
// conservative (fair) choice.
function percentileOfViews(views: number, population: number[]): number {
  if (population.length === 0) return 0.5;
  const below = population.filter((v) => v < views).length;
  return below / population.length;
}

function labelFor(score: number): ScoreLabel {
  if (score >= 80) return 'breakout';
  if (score >= 64) return 'strong';
  if (score >= 44) return 'solid';
  if (score >= 24) return 'soft';
  return 'flop';
}

// Score one post against the whole population (which should include the
// post itself). `allPosts` is every post the user has saved — we only
// rank views against posts that actually have views recorded.
export function scorePost(post: Post, allPosts: Post[]): ScoreBreakdown {
  const s = readStats(post.stats);
  const engagementRate = safeRate(s.likes + s.comments + s.shares + s.saves, s.views);
  const saveRate = safeRate(s.saves, s.views);
  const shareRate = safeRate(s.shares, s.views);
  const swipeThrough = s.photoViews > 0 && s.views > 0 ? s.photoViews / s.views : null;

  // Quality sub-score: engagement signals that hold across account sizes.
  // Saves + shares are weighted hardest because they're what the TikTok
  // algorithm rewards with extra distribution.
  const engagementNorm = clamp01(engagementRate / ENGAGEMENT_CEIL);
  const saveNorm = clamp01(saveRate / SAVE_CEIL);
  const shareNorm = clamp01(shareRate / SHARE_CEIL);
  const quality = 0.4 * engagementNorm + 0.35 * saveNorm + 0.25 * shareNorm;

  const rankedViews = allPosts
    .map((p) => p.stats.views || 0)
    .filter((v) => v > 0);

  let score: number;
  let basis: ScoreBreakdown['basis'];
  let reachPercentile: number;

  if (rankedViews.length >= RELATIVE_MIN_HISTORY && s.views > 0) {
    basis = 'relative';
    reachPercentile = percentileOfViews(s.views, rankedViews);
    // Reach is the dominant signal (the algorithm already voted), quality
    // is the tie-breaker / multiplier on intent.
    score = 100 * (0.55 * reachPercentile + 0.45 * quality);
  } else {
    // Not enough history to rank fairly. Lean on quality, nudged by raw
    // reach magnitude on a log scale so a 50k-view post still outscores a
    // 500-view one with identical rates.
    basis = 'absolute';
    reachPercentile = clamp01(s.views > 0 ? Math.log10(s.views) / 6 : 0); // 1M views ≈ 1.0
    score = 100 * (0.4 * reachPercentile + 0.6 * quality);
  }

  return {
    score: Math.round(score),
    label: labelFor(score),
    reachPercentile,
    engagementRate,
    saveRate,
    shareRate,
    swipeThrough,
    basis,
  };
}

// True when a post has any performance data worth scoring. Drafts saved
// before the user filled in TikTok's numbers score as 0 and shouldn't
// pollute "what's working" rollups.
export function hasStats(post: Post): boolean {
  const s = post.stats;
  return (s.views || 0) + (s.likes || 0) + (s.shares || 0) + (s.saves || 0) > 0;
}

// ---------- "What's working" rollups ----------
//
// Groups scored posts by a dimension (preset, hook style, niche) and
// returns the average score per bucket, best-first. Feeds both the
// Analytics summary header and the predictor's context so Claude can see
// which formats/hooks/niches actually outperform for THIS account.

export type WorkingBucket = {
  key: string;
  count: number;
  avgScore: number;
};

export type WorkingSummary = {
  scored: number;            // how many posts had stats
  topPreset: WorkingBucket | null;
  byPreset: WorkingBucket[];
  byHook: WorkingBucket[];
  byNiche: WorkingBucket[];
  // Calibration: mean absolute error between stored predictions and the
  // actual computed score, across posts that carried a prediction.
  predictionCount: number;
  meanAbsError: number | null;
};

function hookStyleOf(post: Post): string {
  return (
    post.selfAnalysis?.hookStyle ||
    post.cloneAnalysis?.hookStyle ||
    ''
  ).trim();
}

function bucketize(
  rows: { key: string; score: number }[],
): WorkingBucket[] {
  const map = new Map<string, { total: number; count: number }>();
  for (const r of rows) {
    if (!r.key) continue;
    const cur = map.get(r.key) || { total: 0, count: 0 };
    cur.total += r.score;
    cur.count += 1;
    map.set(r.key, cur);
  }
  return Array.from(map.entries())
    .map(([key, v]) => ({ key, count: v.count, avgScore: Math.round(v.total / v.count) }))
    .sort((a, b) => b.avgScore - a.avgScore);
}

export function summarizeWhatWorks(allPosts: Post[]): WorkingSummary {
  const scored = allPosts
    .filter(hasStats)
    .map((p) => ({ post: p, breakdown: scorePost(p, allPosts) }));

  const byPreset = bucketize(
    scored.map(({ post, breakdown }) => ({ key: post.preset || '', score: breakdown.score })),
  );
  const byHook = bucketize(
    scored.map(({ post, breakdown }) => ({ key: hookStyleOf(post), score: breakdown.score })),
  );
  const byNiche = bucketize(
    scored.map(({ post, breakdown }) => ({ key: (post.niche || '').trim(), score: breakdown.score })),
  );

  // Prediction calibration.
  const predicted = scored.filter(({ post }) => post.prediction);
  let meanAbsError: number | null = null;
  if (predicted.length > 0) {
    const totalErr = predicted.reduce(
      (acc, { post, breakdown }) => acc + Math.abs((post.prediction!.score || 0) - breakdown.score),
      0,
    );
    meanAbsError = Math.round(totalErr / predicted.length);
  }

  return {
    scored: scored.length,
    topPreset: byPreset[0] || null,
    byPreset,
    byHook,
    byNiche,
    predictionCount: predicted.length,
    meanAbsError,
  };
}

export const SCORE_LABEL_TEXT: Record<ScoreLabel, string> = {
  breakout: 'Breakout',
  strong: 'Strong',
  solid: 'Solid',
  soft: 'Soft',
  flop: 'Flop',
};

// Tailwind-ish color per label for badges. Hex kept inline to match the
// rest of the app's hand-rolled palette.
export const SCORE_LABEL_COLOR: Record<ScoreLabel, string> = {
  breakout: '#00E5FF',
  strong: '#22C55E',
  solid: '#FFC857',
  soft: '#F59E0B',
  flop: '#EF4444',
};
