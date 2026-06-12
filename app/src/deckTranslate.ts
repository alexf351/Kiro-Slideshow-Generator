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

// Shared engine for every structure-preserving deck transform: send the flat
// string list to the model with a task-specific `system` prompt, get back a
// same-length list (forced tool-use, length-checked), and reinsert. The whole
// point is the LLM only ever touches a string array — never the JSON shape.
async function transformDeckStrings(
  json: string,
  system: string,
  apiKey: string,
  model: ClaudeModelId,
): Promise<string> {
  const parsed = JSON.parse(unwrap(json)) as unknown;
  const strings = collectStrings(parsed);
  if (strings.length === 0) return json;

  const res = await callClaude({
    apiKey,
    model,
    maxTokens: 2000,
    system: [{ type: 'text', text: system }],
    messages: [{ role: 'user', content: JSON.stringify(strings) }],
    tools: [{
      name: 'lines',
      description: 'Return the rewritten strings, same length and order as the input.',
      input_schema: {
        type: 'object',
        properties: { strings: { type: 'array', items: { type: 'string' } } },
        required: ['strings'],
      },
    }],
    toolChoice: { type: 'tool', name: 'lines' },
  });

  const out = extractToolUse<{ strings: string[] }>(res, 'lines');
  if (!out || !Array.isArray(out.strings)) throw new Error('The model did not return strings.');
  if (out.strings.length !== strings.length) {
    throw new Error(`Length mismatch (${out.strings.length} vs ${strings.length}). Try again.`);
  }
  return JSON.stringify(applyStrings(parsed, out.strings), null, 2);
}

// Translate the on-screen text of a whole deck into `language`, returning a
// new pretty-printed JSON string with identical structure.
export async function translateDeck(opts: {
  json: string;
  language: string;
  apiKey: string;
  model: ClaudeModelId;
}): Promise<string> {
  const system = `You localize the on-screen text of a TikTok slideshow into ${opts.language}. ` +
    `You are given a JSON array of strings in order. Return an array of the SAME length, each entry the ${opts.language} version of the matching input, ` +
    `written the way a native creator on that side of TikTok would phrase it (casual, punchy — not a stiff literal translation). ` +
    `Rules: keep any HTML tags (like <strong>, <br/>) exactly where they are; keep #hashtags, @handles, URLs, emoji and brand names (e.g. "Iro AI") unchanged; ` +
    `do not add, drop, reorder or merge entries — a one-to-one mapping.`;
  return transformDeckStrings(opts.json, system, opts.apiKey, opts.model);
}

// Rewrite the on-screen text of a whole deck per an instruction (punchier,
// simpler, etc.) WITHOUT touching structure — unlike a whole-JSON rewrite,
// this can't drop fields, rename keys, change the slide count, or corrupt the
// bg/colors. Only the prose changes.
export async function rewriteDeck(opts: {
  json: string;
  instruction: string;
  apiKey: string;
  model: ClaudeModelId;
}): Promise<string> {
  const system = `You revise the on-screen text of an "Iro AI" TikTok slideshow. You are given a JSON array of strings in order. ` +
    `Apply this instruction to EACH string: "${opts.instruction}". Return an array of the SAME length, one-to-one. ` +
    `Keep each line in roughly its role (a short title stays short, a body can breathe). ` +
    `Keep HTML tags (like <strong>, <br/>), #hashtags, @handles, emoji and brand names (e.g. "Iro AI") intact; ` +
    `do not add, drop, reorder or merge entries.`;
  return transformDeckStrings(opts.json, system, opts.apiKey, opts.model);
}
