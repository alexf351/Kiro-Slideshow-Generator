// Format-variety coaching. Posting the same format over and over fatigues an
// audience (and the algorithm rewards a varied, healthy posting pattern), so
// the app gently flags when a creator is about to make yet another post in a
// format they've used for their last few. Pure (post list in, streak out) so
// it's deterministic and testable; the save flow reads it and nudges.

import type { Post } from './posts';

// The leading run of identical formats among `posts` (which `listPosts`
// returns newest-first): the format and how many of the most-recent posts in
// a row used it. Null when there's no history or the newest post has no
// recorded format.
export function recentFormatStreak(posts: Post[]): { preset: string; count: number } | null {
  if (!posts || posts.length === 0) return null;
  const top = (posts[0].preset || '').trim();
  if (!top) return null;
  let count = 0;
  for (const p of posts) {
    if ((p.preset || '').trim() === top) count++;
    else break;
  }
  return { preset: top, count };
}

// Would saving `preset` now extend an existing same-format streak to
// `threshold` (default 3) or more in a row? Used to decide whether to nudge.
export function wouldFatigueStreak(posts: Post[], preset: string, threshold = 3): boolean {
  const streak = recentFormatStreak(posts);
  if (!streak || streak.preset !== (preset || '').trim()) return false;
  return streak.count + 1 >= threshold;
}
