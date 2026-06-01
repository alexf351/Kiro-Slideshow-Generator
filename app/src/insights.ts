// Hashtag intelligence — which tags actually correlate with high scores on
// THIS account. Deterministic (no API): parse hashtags out of scored posts'
// captions and rank them by the average performance score of the posts that
// used them, so the creator reuses tags that travel with winners.

import { hasStats, scorePost } from './scoring';
import type { Post } from './posts';

export type HashtagStat = {
  tag: string;        // without the leading '#'
  count: number;      // posts that used it
  avgScore: number;   // mean performance score of those posts
  totalViews: number;
};

const HASHTAG_RE = /#([\p{L}0-9_]+)/gu;

export function parseHashtags(caption: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  HASHTAG_RE.lastIndex = 0;
  while ((m = HASHTAG_RE.exec(caption || '')) !== null) {
    const tag = m[1].toLowerCase();
    if (!seen.has(tag)) {
      seen.add(tag);
      out.push(tag);
    }
  }
  return out;
}

// Ranked best-first by avg score, then by usage count. Only scored posts
// contribute, so the ranking reflects real performance.
export function topHashtags(posts: Post[], opts?: { minCount?: number }): HashtagStat[] {
  const minCount = opts?.minCount ?? 1;
  const map = new Map<string, { total: number; count: number; views: number }>();
  for (const p of posts) {
    if (!hasStats(p)) continue;
    const score = scorePost(p, posts).score;
    const views = p.stats.views || 0;
    for (const tag of parseHashtags(p.caption)) {
      const cur = map.get(tag) || { total: 0, count: 0, views: 0 };
      cur.total += score;
      cur.count += 1;
      cur.views += views;
      map.set(tag, cur);
    }
  }
  return Array.from(map.entries())
    .filter(([, v]) => v.count >= minCount)
    .map(([tag, v]) => ({ tag, count: v.count, avgScore: Math.round(v.total / v.count), totalViews: v.views }))
    .sort((a, b) => b.avgScore - a.avgScore || b.count - a.count);
}

// Suggest up-to-n proven hashtags that aren't already in the draft caption.
export function suggestHashtags(caption: string, posts: Post[], n = 6): string[] {
  const already = new Set(parseHashtags(caption));
  return topHashtags(posts)
    .map((h) => h.tag)
    .filter((t) => !already.has(t))
    .slice(0, n);
}
