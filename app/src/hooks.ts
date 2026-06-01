// Hook Library: mine every scored post for its opening hook and rank the
// hooks by the post's actual performance score. This is the "reuse what
// works" half of the learning loop — instead of guessing a hook, you pull
// from the ones that already earned their score on this account.
//
// A hook's text comes from the best available source, in order:
//   1. the vision read of an imported self-post (selfAnalysis.hookText)
//   2. the hook.headline baked into a saved draft's JSON snapshot
//   3. the first line of the caption
// Only posts that carry real stats are ranked — an unscored draft tells
// you nothing about what performs.

import type { Post } from './posts';
import { hasStats, scorePost, type ScoreLabel } from './scoring';

export type HookEntry = {
  id: string;          // source post id
  hook: string;        // the hook text, plain
  hookStyle: string;   // question / stat / confession / POV / ...
  niche: string;
  preset: string;
  score: number;       // the source post's 0-100 performance score
  label: ScoreLabel;
  postedAt: number;
  tiktokUrl: string;
};

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function firstLine(s: string): string {
  return (s || '').split('\n').map((t) => t.trim()).find(Boolean) || '';
}

function hookTextOf(post: Post): string {
  const fromVision = post.selfAnalysis?.hookText?.trim();
  if (fromVision) return fromVision;
  if (post.jsonSnapshot) {
    try {
      const j = JSON.parse(post.jsonSnapshot) as { hook?: { headline?: string; text?: string } };
      const h = j?.hook?.headline || j?.hook?.text;
      if (typeof h === 'string' && stripHtml(h)) return stripHtml(h);
    } catch {
      // snapshot wasn't plain JSON — fall through to the caption.
    }
  }
  return firstLine(post.caption);
}

function hookStyleOf(post: Post): string {
  return (post.selfAnalysis?.hookStyle || post.cloneAnalysis?.hookStyle || '').trim();
}

// Ranked, best-first. `allPosts` is the whole population so scores stay
// consistent with the Performance list.
export function extractHooks(allPosts: Post[]): HookEntry[] {
  const entries: HookEntry[] = [];
  for (const post of allPosts) {
    if (!hasStats(post)) continue;
    const hook = hookTextOf(post);
    if (!hook) continue;
    const b = scorePost(post, allPosts);
    entries.push({
      id: post.id,
      hook,
      hookStyle: hookStyleOf(post),
      niche: (post.niche || '').trim(),
      preset: post.preset || '',
      score: b.score,
      label: b.label,
      postedAt: post.postedAt,
      tiktokUrl: post.tiktokUrl,
    });
  }
  entries.sort((a, b) => b.score - a.score);
  return entries;
}

// Distinct, sorted values of a field across entries — drives the filter chips.
export function distinctValues(entries: HookEntry[], key: 'hookStyle' | 'niche'): string[] {
  const set = new Set<string>();
  for (const e of entries) {
    const v = e[key];
    if (v) set.add(v);
  }
  return Array.from(set).sort();
}
