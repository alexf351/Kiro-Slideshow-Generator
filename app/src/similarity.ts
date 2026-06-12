// Repeat-hook guard. A creator posting at volume can accidentally reuse the
// same opening line across posts — TikTok suppresses content it reads as a
// near-duplicate of something the account already published, so the second
// post quietly underperforms. This module compares a draft's hook (the first
// line of its caption, which the app already treats as the hook) against the
// hooks of posts already in history and flags strong matches BEFORE saving.
//
// Everything here is a pure function of strings — deterministic, no API, and
// unit-testable in isolation. The UI (App.handleSaveToHistory) reads
// findSimilarHooks() and shows a one-tap "post anyway?" confirm.

import type { Post } from './posts';

// First non-empty line of a caption, with surrounding whitespace trimmed.
// Mirrors the "hook in caption's first line" convention used by the
// pre-publish checks, so the comparison is on the same text the creator
// thinks of as their hook.
export function hookLine(caption: string): string {
  for (const raw of (caption || '').split('\n')) {
    const line = raw.trim();
    if (line) return line;
  }
  return '';
}

// Strip a hook down to comparable content words: lowercase, drop hashtags,
// @mentions and urls, remove emoji/punctuation, collapse whitespace. Two
// hooks that say the same thing with different casing, emoji or trailing
// tags normalize to the same string.
export function normalizeHook(hook: string): string {
  return (hook || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')   // urls
    .replace(/[#@][\p{L}0-9_]+/gu, ' ') // hashtags + mentions
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')  // emoji + punctuation
    .replace(/\s+/g, ' ')
    .trim();
}

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'how',
  'i', 'if', 'in', 'is', 'it', 'me', 'my', 'of', 'on', 'or', 'so', 'that', 'the',
  'this', 'to', 'up', 'we', 'you', 'your',
]);

// Content-word token set (stopwords dropped). Short hooks lose most of their
// words to stopwords, so we keep the raw token set too and let the caller's
// Jaccard fall back to it when the content set is empty.
export function tokenSet(normalized: string): Set<string> {
  const all = normalized ? normalized.split(' ').filter(Boolean) : [];
  const content = all.filter((t) => !STOPWORDS.has(t) && t.length > 1);
  return new Set(content.length >= 2 ? content : all);
}

// Jaccard overlap of two token sets: |A ∩ B| / |A ∪ B|, in [0,1].
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

// Similarity of two raw hook strings in [0,1]. 1.0 when they normalize
// identically; otherwise the Jaccard overlap of their content words.
export function hookSimilarity(a: string, b: string): number {
  const na = normalizeHook(a);
  const nb = normalizeHook(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  return jaccard(tokenSet(na), tokenSet(nb));
}

export type HookMatch = {
  post: Post;
  hook: string;        // the existing post's hook line
  similarity: number;  // 0-1
};

// Posts whose hook is at least `threshold` similar to the draft's hook,
// strongest first. Empty when the draft has no hook or nothing matches.
// `threshold` defaults to 0.6 — high enough that paraphrases pass but a
// recycled hook trips it.
export function findSimilarHooks(
  draftCaption: string,
  posts: Post[],
  threshold = 0.6,
): HookMatch[] {
  const draft = hookLine(draftCaption);
  if (normalizeHook(draft).length === 0) return [];
  const out: HookMatch[] = [];
  for (const p of posts) {
    const hook = hookLine(p.caption);
    const sim = hookSimilarity(draft, hook);
    if (sim >= threshold) out.push({ post: p, hook, similarity: sim });
  }
  return out.sort((a, b) => b.similarity - a.similarity);
}
