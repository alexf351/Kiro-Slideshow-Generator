// "Remix the winner": rank last week's posts from the Fastlane stats, find
// the winning post's deck in this browser, and turn it into a remix with the
// Iro slide moved to slide 3 or 4 (never last).
//
// Ranking: Fastlane only reports views, likes and comments (no saves or
// shares), so a post's score is engagement per view:
//     (likes + 2 × comments) / views
// Comments count double because they take more effort than a like and
// TikTok weighs them more. Per-view rather than raw counts, so a post the
// algorithm happened to push wide doesn't win on reach alone. Posts under a
// views floor are left out, because 3 likes on 20 views is noise. If nothing
// in the week clears the floor, it falls back to ranking by raw views.
//
// Everything here is pure (no fetch, no DOM) and covered by scripts/test.mjs.

import type { FlMetrics, FlPost } from './fastlane';
import { hookLine, hookSimilarity } from './similarity';

export const WINDOW_DAYS = 7;
export const MIN_VIEWS = 500;
export const COMMENT_WEIGHT = 2;

export type RankedPost = {
  post: FlPost;
  views: number;
  likes: number;
  comments: number;
  score: number; // (likes + 2×comments) / views, 0..∞
};

export type Ranking = {
  ranked: RankedPost[];
  basis: 'engagement' | 'views'; // 'views' = nothing cleared the floor
  considered: number; // posted in the window with stats
  belowFloor: number; // of those, how many were under the views floor
};

export function engagementScore(m: { views?: number; likes?: number; comments?: number }): number {
  const v = m.views || 0;
  if (v <= 0) return 0;
  return ((m.likes || 0) + COMMENT_WEIGHT * (m.comments || 0)) / v;
}

export function rankWinners(
  posts: FlPost[],
  metrics: Record<string, FlMetrics>,
  opts: { now?: number; days?: number; minViews?: number } = {},
): Ranking {
  const now = opts.now ?? Date.now();
  const days = opts.days ?? WINDOW_DAYS;
  const minViews = opts.minViews ?? MIN_VIEWS;
  const since = now - days * 86_400_000;

  const rows: RankedPost[] = [];
  for (const p of posts) {
    if (p.status !== 'POSTED') continue;
    const t = Date.parse(p.when);
    if (!Number.isFinite(t) || t < since || t > now) continue;
    const m = metrics[p.id];
    if (!m || m.notFound || !m.views || m.views <= 0) continue;
    rows.push({
      post: p,
      views: m.views,
      likes: m.likes || 0,
      comments: m.comments || 0,
      score: engagementScore(m),
    });
  }

  const cleared = rows.filter((r) => r.views >= minViews);
  if (cleared.length) {
    cleared.sort((a, b) => b.score - a.score || b.views - a.views);
    return { ranked: cleared, basis: 'engagement', considered: rows.length, belowFloor: rows.length - cleared.length };
  }
  const byViews = [...rows].sort((a, b) => b.views - a.views || b.score - a.score);
  return { ranked: byViews, basis: 'views', considered: rows.length, belowFloor: rows.length };
}

export function pct(score: number): string {
  const p = score * 100;
  return (p >= 10 ? p.toFixed(0) : p.toFixed(1)).replace(/\.0$/, '') + '%';
}

// ---------------------------------------------------------------------------
// Finding the winner's deck in this browser
// ---------------------------------------------------------------------------

export type DeckSource = {
  kind: 'history' | 'draft' | 'ready';
  name: string;
  caption: string;
  json: string;
  url?: string; // the posted TikTok link, for history posts
  preset?: string;
  // Sidebar photo picks a draft keeps outside its JSON (keyed hook, cta,
  // prompt:0, skill-shot:2:1 …). Carried into the remix so photos survive.
  slideBgs?: Record<string, unknown>;
  slideBgAdjust?: Record<string, unknown>;
};

export type DeckMatch = { source: DeckSource; how: 'link' | 'caption'; similarity: number };

// TikTok video / photo-carousel id from a share link, e.g.
// https://www.tiktok.com/@tryiro/photo/7571234567890123456 -> "7571234567890123456".
export function tiktokId(url: string): string {
  const m = /\/(?:video|photo)\/(\d{8,})/.exec(url || '');
  return m ? m[1] : '';
}

// Match by the post's TikTok link first (exact), then by the caption's hook
// line (the same similarity the repeat-hook guard uses). On a tie a draft
// wins (it keeps its sidebar photo picks), then a history post, then a
// Ready deck.
export function findWinnerDeck(
  post: { caption: string; url?: string },
  sources: DeckSource[],
  threshold = 0.6,
): DeckMatch | null {
  const id = tiktokId(post.url || '');
  if (id) {
    const byLink = sources.find((s) => s.url && tiktokId(s.url) === id);
    if (byLink) return { source: byLink, how: 'link', similarity: 1 };
  }
  const hook = hookLine(post.caption);
  if (!hook) return null;
  const rank = { draft: 0, history: 1, ready: 2 } as const;
  let best: DeckMatch | null = null;
  for (const s of sources) {
    const sim = hookSimilarity(hook, hookLine(s.caption));
    if (sim < threshold) continue;
    if (!best || sim > best.similarity || (sim === best.similarity && rank[s.kind] < rank[best.source.kind])) {
      best = { source: s, how: 'caption', similarity: sim };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Building the remix
// ---------------------------------------------------------------------------

// Default Iro slide angle. No dollar amounts or income claims.
export const IRO_HEADLINE = 'How to <strong>make money</strong><br/>with AI';
export const IRO_SKILL_HEADLINE = ['How to', 'make money', 'with AI'];

// Formats whose engine build has no closing CTA slide; the Iro slide there
// is one of the list items (an app in the stack, the app card in 10/10 Skills).
const NO_CTA_PRESETS = new Set(['app_stack', 'tool_ranks', 'app_rating']);
// Formats where the closing slide is optional in the engine.
const OPTIONAL_CTA_PRESETS = new Set(['meme_pov', 'skill_list', 'habit_list', 'disciplined_list']);
// Formats with no hook slide in front of the list.
const NO_HOOK_PRESETS = new Set(['meme_pov']);

function unwrap(json: string): string {
  return json.trim().replace(/^\s*(?:const\s+SLIDES\s*=\s*)?/, '').replace(/;\s*$/, '');
}

const mentionsIro = (v: unknown): boolean => /\biro\b/i.test(JSON.stringify(v ?? ''));

// The deck's main list: the longest array of slide objects (prompts, beats,
// items, skills, apps…). Ties go to the first key, which matches the engine.
function mainList(deck: Record<string, unknown>): string | null {
  let best: string | null = null;
  let len = 0;
  for (const [k, v] of Object.entries(deck)) {
    if (!Array.isArray(v) || v.length === 0) continue;
    if (!v.every((x) => x && typeof x === 'object' && !Array.isArray(x))) continue;
    if (v.length > len) { best = k; len = v.length; }
  }
  return best;
}

export type RemixResult =
  | {
      ok: true;
      json: string;
      slot: number; // where the Iro slide renders, 1-based
      total: number;
      how: 'moved-cta' | 'moved-item';
      move?: { from: number; to: number }; // list indexes, when an item moved
      notes: string[];
    }
  | { ok: false; reason: string };

// Turn the winner's deck into the remix: same slides and photos, with the Iro
// slide at `slot` (1-based, so 3 or 4) and the default "make money with AI"
// headline on it. Never leaves the Iro slide last.
export function remixDeck(jsonText: string, slot: 3 | 4 = 3): RemixResult {
  let deck: Record<string, unknown>;
  try {
    const parsed = JSON.parse(unwrap(jsonText));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, reason: 'The deck JSON is not an object.' };
    deck = parsed as Record<string, unknown>;
  } catch {
    return { ok: false, reason: 'The deck JSON does not parse.' };
  }
  delete deck.ctaAt; // start clean if the winner was itself a remix
  const preset = typeof deck.preset === 'string' ? deck.preset : 'prompt_pack';
  const hasHook = !!deck.hook && typeof deck.hook === 'object' && !NO_HOOK_PRESETS.has(preset);
  const listKey = mainList(deck);
  const list = listKey ? (deck[listKey] as Record<string, unknown>[]) : [];
  const hasCta = !!deck.cta && typeof deck.cta === 'object' && !NO_CTA_PRESETS.has(preset);
  const notes: string[] = [];

  // 1) An Iro item inside the list (app card, app in the stack): move it.
  // Only for formats where the closing slide is missing or optional; where
  // the engine always closes on the CTA, that CTA is the Iro slide (step 2).
  const listMayHoldIro = !hasCta || OPTIONAL_CTA_PRESETS.has(preset);
  const iroIdx = listMayHoldIro ? list.findIndex((it) => !!it.app || mentionsIro(it)) : -1;
  if (iroIdx >= 0) {
    // Keep the Iro slide off the end. If the closing slide is optional and
    // also pitches Iro, drop it so Iro isn't pitched twice.
    if (hasCta && OPTIONAL_CTA_PRESETS.has(preset) && mentionsIro(deck.cta)) {
      delete deck.cta;
      notes.push('Dropped the closing Iro slide so Iro is pitched once, mid-deck.');
    }
    const ctaCount = deck.cta && typeof deck.cta === 'object' && !NO_CTA_PRESETS.has(preset) ? 1 : 0;
    const total = (hasHook ? 1 : 0) + list.length + ctaCount;
    if (total < 3) return { ok: false, reason: 'The deck is too short to put the Iro slide in the middle.' };
    const target = Math.min(slot, total - 1); // never last
    const offset = hasHook ? 1 : 0;
    const to = Math.max(0, Math.min(list.length - 1, target - 1 - offset));
    const [item] = list.splice(iroIdx, 1);
    if (preset === 'skill_list' && item.app) {
      item.headline = [...IRO_SKILL_HEADLINE];
      item.accentLine = 1;
    }
    list.splice(to, 0, item);
    const finalSlot = offset + to + 1;
    if (finalSlot === total) return { ok: false, reason: 'The Iro slide would end up last.' };
    return { ok: true, json: JSON.stringify(deck, null, 2), slot: finalSlot, total, how: 'moved-item', move: { from: iroIdx, to }, notes };
  }

  // 2) The closing CTA is the Iro slide: the engine moves it to `ctaAt`.
  if (hasCta) {
    const total = (hasHook ? 1 : 0) + list.length + 1;
    if (total < 3) return { ok: false, reason: 'The deck is too short to put the Iro slide in the middle.' };
    const target = Math.min(slot, total - 1);
    deck.ctaAt = target;
    const cta = deck.cta as Record<string, unknown>;
    if (typeof cta.headline === 'string') cta.headline = IRO_HEADLINE;
    else notes.push('This format’s Iro slide has no headline field, so its text was kept as is.');
    if (!cta.bg) notes.push('The Iro slide has no photo yet. Pick one for it under Backgrounds.');
    return { ok: true, json: JSON.stringify(deck, null, 2), slot: target, total, how: 'moved-cta', notes };
  }

  return { ok: false, reason: 'This deck has no Iro slide to move (no closing CTA and no Iro item in the list).' };
}

// A dated, filesystem-safe slug for a Ready deck file in decks/.
export function remixSlug(name: string, now = Date.now()): string {
  const d = new Date(now);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const base = name.replace(/<[^>]+>/g, ' ').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  return `${date}-remix-${base || 'winner'}`;
}

// The Ready deck file body: deck JSON plus title + caption (readyDecks.ts
// strips those two back out when it loads the deck).
export function readyDeckFile(remixJson: string, title: string, caption: string): string {
  const deck = JSON.parse(remixJson) as Record<string, unknown>;
  return JSON.stringify({ title, ...deck, caption }, null, 2) + '\n';
}

// Sidebar picks are keyed by list index ("skill:2", "skill-shot:2:1",
// "app-icon:4"). When the Iro item moves from one index to another, every
// key's first index shifts the same way the list did. Keys with no index
// (hook, cta) pass through.
export function remapIndexedKeys<T>(map: Record<string, T>, from: number, to: number): Record<string, T> {
  if (from === to) return { ...map };
  const shift = (i: number): number => {
    if (i === from) return to;
    if (from < to && i > from && i <= to) return i - 1;
    if (from > to && i >= to && i < from) return i + 1;
    return i;
  };
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(map)) {
    const m = /^([^:]+):(\d+)(.*)$/.exec(k);
    out[m ? `${m[1]}:${shift(Number(m[2]))}${m[3]}` : k] = v;
  }
  return out;
}
