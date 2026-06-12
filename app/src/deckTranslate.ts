// Whole-deck translation. Translating a caption reaches one audience;
// translating the SLIDES content lets a creator repost the same deck in
// another language and tap an entirely different side of TikTok — a real
// reach multiplier. The danger is an LLM rewriting the JSON and breaking the
// structure, so we never ask it to. Instead we deterministically EXTRACT the
// on-screen text strings, translate just that flat list, and REINSERT them in
// the same order — every key, number, color, url and layout field is
// preserved byte-for-byte. Only the prose changes.
//
// collectStrings + applyStrings are pure and symmetric (identical walk
// order), so the reinsertion is index-aligned and round-trips exactly. The
// LLM only ever sees/returns a flat string array.

import { callClaude, extractToolUse, type ClaudeModelId } from './anthropic';

// Keys whose values are NOT on-screen prose: assets, colors, identity/brand
// fields, structural flags, and engagement numbers. Their subtrees are
// skipped during BOTH collect and apply, keeping the two walks aligned.
const SKIP_KEYS = new Set([
  'bg', 'background', 'image', 'img', 'src', 'url', 'icon', 'color', 'accent',
  'preset', 'platform', 'mascot', 'bgAdjust', 'layout', 'status', 'handle',
  'date', 'stars', 'verified', 'replies', 'retweets', 'likes', 'rank', 'grade',
  'searchTerm', 'attribution', 'name', 'pron', 'watermark',
]);

// Deterministic in-order walk collecting every translatable string.
export function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, out);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SKIP_KEYS.has(k)) continue;
      collectStrings(v, out);
    }
  }
  return out;
}

// Rebuild `value` with each translatable string replaced by the next entry of
// `strings` (same order collectStrings produced). A null/undefined
// replacement leaves the original in place. Non-text + skipped fields pass
// through untouched.
export function applyStrings(value: unknown, strings: string[], ctr: { i: number } = { i: 0 }): unknown {
  if (typeof value === 'string') {
    const t = strings[ctr.i];
    ctr.i++;
    return t == null ? value : t;
  }
  if (Array.isArray(value)) {
    return value.map((v) => applyStrings(v, strings, ctr));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SKIP_KEYS.has(k) ? v : applyStrings(v, strings, ctr);
    }
    return out;
  }
  return value;
}

// Strip the optional `const SLIDES = … ;` wrapper the engine accepts, so we
// can parse the raw object. Mirrors the engine's own tolerance.
function unwrap(json: string): string {
  return json.trim().replace(/^\s*(?:const\s+SLIDES\s*=\s*)?/, '').replace(/;\s*$/, '');
}

// Translate the on-screen text of a whole deck into `language`, returning a
// new pretty-printed JSON string with identical structure. Throws if the
// model returns the wrong number of strings (so we never apply a misaligned
// translation).
export async function translateDeck(opts: {
  json: string;
  language: string;
  apiKey: string;
  model: ClaudeModelId;
}): Promise<string> {
  const parsed = JSON.parse(unwrap(opts.json)) as unknown;
  const strings = collectStrings(parsed);
  if (strings.length === 0) return opts.json;

  const system = `You localize the on-screen text of a TikTok slideshow into ${opts.language}. ` +
    `You are given a JSON array of strings in order. Return an array of the SAME length, each entry the ${opts.language} version of the matching input, ` +
    `written the way a native creator on that side of TikTok would phrase it (casual, punchy — not a stiff literal translation). ` +
    `Rules: keep any HTML tags (like <strong>, <br/>) exactly where they are; keep #hashtags, @handles, URLs, emoji and brand names (e.g. "Iro AI") unchanged; ` +
    `do not add, drop, reorder or merge entries — a one-to-one mapping.`;

  const res = await callClaude({
    apiKey: opts.apiKey,
    model: opts.model,
    maxTokens: 2000,
    system: [{ type: 'text', text: system }],
    messages: [{ role: 'user', content: JSON.stringify(strings) }],
    tools: [{
      name: 'translation',
      description: 'Return the translated strings, same length and order as the input.',
      input_schema: {
        type: 'object',
        properties: { strings: { type: 'array', items: { type: 'string' } } },
        required: ['strings'],
      },
    }],
    toolChoice: { type: 'tool', name: 'translation' },
  });

  const out = extractToolUse<{ strings: string[] }>(res, 'translation');
  if (!out || !Array.isArray(out.strings)) throw new Error('Translation did not return strings.');
  if (out.strings.length !== strings.length) {
    throw new Error(`Translation length mismatch (${out.strings.length} vs ${strings.length}). Try again.`);
  }
  const translated = applyStrings(parsed, out.strings);
  return JSON.stringify(translated, null, 2);
}
