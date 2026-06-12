// AI caption writer. Feeds the current slideshow's text content to Claude and
// gets back a punchy TikTok caption + hashtags. Uses the existing BYOK
// Anthropic key (Settings) and the same callClaude helper as Clone/Propose.

import { callClaude, extractToolUse, type ClaudeModelId } from './anthropic';

// Pull the human-readable text out of the slide JSON so the model writes
// about what's actually on the slides (not the layout fields).
function summariseSlides(json: string): string {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(json.replace(/^\s*(const\s+SLIDES\s*=\s*)?/, '').replace(/;\s*$/, ''));
  } catch {
    return json.slice(0, 2000);
  }
  const out: string[] = [];
  const strip = (s: unknown) => String(s ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  const walk = (v: unknown) => {
    if (!v) return;
    if (typeof v === 'string') { const t = strip(v); if (t) out.push(t); return; }
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (typeof v === 'object') {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (['bg', 'background', 'iconUrl', 'logoUrl', 'cardUrl', 'layout', 'preset', 'platform', 'mascot', 'bgAdjust'].includes(k)) continue;
        walk(val);
      }
    }
  };
  walk(parsed);
  return out.join('\n').slice(0, 3000);
}

// Optional voice for the AI caption.
const TONE_GUIDE: Record<string, string> = {
  Funny: 'Lean into humor — a joke, a bit, or a self-aware punchline.',
  Educational: 'Clear and value-dense; make the reader feel they learned something.',
  Aesthetic: 'Soft, lowercase, dreamy/minimal — that "quiet aesthetic" creator vibe.',
  Hype: 'High-energy and bold; create urgency and FOMO (no caps-lock spam).',
  Relatable: 'Open with a "POV/me when" relatable confession the audience sees themselves in.',
};

export async function generateCaption(opts: {
  json: string;
  preset: string;
  apiKey: string;
  model: ClaudeModelId;
  examples?: string[]; // a few of the user's past captions, for voice
  tone?: string;       // optional tone label (see TONE_GUIDE)
}): Promise<{ caption: string; hashtags: string[] }> {
  const content = summariseSlides(opts.json);
  const voice = opts.examples && opts.examples.length
    ? `\n\nMatch the voice of these past captions:\n${opts.examples.slice(0, 4).map((c) => `- ${c.slice(0, 200)}`).join('\n')}`
    : '';
  const toneLine = opts.tone && TONE_GUIDE[opts.tone] ? `\n- Tone: ${TONE_GUIDE[opts.tone]}` : '';

  const system = `You write TikTok captions for short educational/AI slideshow posts (the brand is "Iro AI", an app that teaches people to actually build with AI).
Rules:
- 1-3 short lines, lowercase-leaning, native and casual — NOT corporate.
- Lead with a hook or a relatable line. No "In this post we will".
- End with a soft nudge to search "Iro AI" on the App Store ONLY if it fits naturally.
- Then 4-7 relevant lowercase hashtags (mix of broad + niche). Include #aitok where it fits.
- No emojis spam (0-2 max). No hashtag walls inside the body.${toneLine}${voice}`;

  const res = await callClaude({
    apiKey: opts.apiKey,
    model: opts.model,
    maxTokens: 700,
    system: [{ type: 'text', text: system }],
    messages: [{
      role: 'user',
      content: `Format: ${opts.preset}\n\nSlide content:\n${content}\n\nWrite the caption.`,
    }],
    tools: [{
      name: 'caption',
      description: 'Return the finished TikTok caption and hashtags.',
      input_schema: {
        type: 'object',
        properties: {
          caption: { type: 'string', description: 'The caption body (no hashtags here).' },
          hashtags: { type: 'array', items: { type: 'string' }, description: 'Hashtags WITHOUT the # prefix.' },
        },
        required: ['caption', 'hashtags'],
      },
    }],
    toolChoice: { type: 'tool', name: 'caption' },
  });

  const out = extractToolUse<{ caption: string; hashtags: string[] }>(res, 'caption');
  if (!out) throw new Error('Claude did not return a caption.');
  const tags = (out.hashtags || []).map((t) => t.replace(/^#/, '').trim()).filter(Boolean);
  return { caption: out.caption.trim(), hashtags: tags };
}

// Generate several alternative opening hooks (first lines) for the current
// post so the creator can A/B test the single highest-leverage line. Fed the
// slide content + the current hook for relevance; returns distinct, punchy
// candidates that each use a different angle (question / number / curiosity /
// stakes). The hook-strength meter then scores whichever the user picks.
export async function generateHookVariations(opts: {
  json: string;
  currentHook: string;
  preset: string;
  apiKey: string;
  model: ClaudeModelId;
  n?: number;
}): Promise<string[]> {
  const n = Math.max(3, Math.min(8, opts.n ?? 5));
  const content = summariseSlides(opts.json);
  const system = `You write scroll-stopping opening lines (hooks) for TikTok photo carousels about "Iro AI" (an app that teaches people to actually build with AI).
A hook is the FIRST line of the caption / the first slide — it decides whether anyone swipes.
Rules:
- Each hook is ONE short line (ideally 3-12 words), lowercase-leaning, native and casual.
- Make the ${n} hooks genuinely DIFFERENT from each other in angle: a question, a specific number, a curiosity gap, a bold/contrarian claim, a relatable confession.
- No hashtags, no emojis, no quotes around them. Just the lines.
- Ground them in the actual slide content; don't invent unrelated claims.`;
  const res = await callClaude({
    apiKey: opts.apiKey,
    model: opts.model,
    maxTokens: 600,
    system: [{ type: 'text', text: system }],
    messages: [{
      role: 'user',
      content: `Format: ${opts.preset}\n\nCurrent hook:\n${opts.currentHook || '(none yet)'}\n\nSlide content:\n${content}\n\nGive me ${n} alternative hooks.`,
    }],
    tools: [{
      name: 'hooks',
      description: 'Return the alternative opening hooks.',
      input_schema: {
        type: 'object',
        properties: {
          hooks: { type: 'array', items: { type: 'string' }, description: `${n} distinct one-line hooks, no hashtags or emojis.` },
        },
        required: ['hooks'],
      },
    }],
    toolChoice: { type: 'tool', name: 'hooks' },
  });
  const out = extractToolUse<{ hooks: string[] }>(res, 'hooks');
  if (!out || !Array.isArray(out.hooks)) throw new Error('Claude did not return hooks.');
  // Clean: strip stray quotes/leading bullets, drop blanks + dupes.
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const raw of out.hooks) {
    const h = String(raw ?? '').replace(/^[\s\-*•\d.)]+/, '').replace(/^["“']|["”']$/g, '').trim();
    const key = h.toLowerCase();
    if (h && !seen.has(key)) { seen.add(key); cleaned.push(h); }
  }
  if (cleaned.length === 0) throw new Error('No usable hooks returned.');
  return cleaned;
}

// Split a caption into its body and the trailing hashtag block, for the
// common TikTok tactic of keeping the caption clean and dropping the
// hashtags into the first comment (the algorithm reads a wall of in-caption
// tags as spam). Only the CONTIGUOUS run of hashtags at the very END is
// moved — inline tags inside the body are left alone. Pure + exported so the
// split is unit-testable.
export function splitForFirstComment(caption: string): { body: string; hashtags: string } {
  const m = caption.match(/(\s*(?:#[\p{L}0-9_]+\s*)+)$/u);
  if (!m) return { body: caption, hashtags: '' };
  const tags = m[0].match(/#[\p{L}0-9_]+/gu) || [];
  if (tags.length === 0) return { body: caption, hashtags: '' };
  const body = caption.slice(0, m.index).replace(/\s+$/, '');
  return { body, hashtags: tags.join(' ') };
}

// Build the "posting.txt" that ships inside the slide-image ZIP — a one-stop
// cheat sheet for actually posting the carousel: the caption to paste, the
// hashtags split out for the first comment (the reach tactic), and a short
// checklist. Pure + exported so it's unit-testable. `slideCount` is the
// number of slide images in the pack.
export function buildPostingNotes(caption: string, formatLabel: string, slideCount: number, audioNote = ''): string {
  const { body, hashtags } = splitForFirstComment(caption);
  const sound = (audioNote || '').trim();
  const lines: string[] = [];
  lines.push('=== IRO POST PACK ===');
  lines.push(`Format: ${formatLabel}`);
  lines.push(`Slides: ${slideCount}  (slide-01 … slide-${String(slideCount).padStart(2, '0')})`);
  if (sound) lines.push(`Sound: 🎵 ${sound}`);
  lines.push('');
  lines.push('--- CAPTION (paste as the post caption) ---');
  lines.push(body || '(no caption)');
  lines.push('');
  if (hashtags) {
    lines.push('--- FIRST COMMENT (paste as comment #1 for cleaner reach) ---');
    lines.push(hashtags);
    lines.push('');
  }
  lines.push('--- CHECKLIST ---');
  lines.push(sound ? `[ ] Add the sound: ${sound}` : '[ ] Add a trending sound');
  lines.push('[ ] Cover = slide 1 (your hook)');
  lines.push('[ ] Upload slides in order (slide-01 first)');
  if (hashtags) lines.push('[ ] Post, then immediately drop the first comment');
  return lines.join('\n') + '\n';
}

// Replace just the first (hook) line of a caption, preserving the rest of the
// body and any trailing hashtags. Pure + exported so the apply step is
// unit-testable. If the caption is empty, the new hook becomes the caption.
export function replaceFirstLine(caption: string, newHook: string): string {
  if (!caption.trim()) return newHook;
  const lines = caption.split('\n');
  // Find the first non-empty line (the hook) and swap it in place.
  const idx = lines.findIndex((l) => l.trim().length > 0);
  if (idx === -1) return newHook;
  lines[idx] = newHook;
  return lines.join('\n');
}

// Translate a caption into another language for reaching a different
// audience, keeping it native (not a stiff literal translation) and leaving
// #hashtags and @handles intact.
// Rewrite the user's OWN caption to be punchier/more scroll-stopping, keeping
// its meaning, hashtags and handles. Distinct from generateCaption (writes a
// new caption from the slides).
export async function punchUpCaption(opts: {
  caption: string;
  apiKey: string;
  model: ClaudeModelId;
}): Promise<string> {
  const system = `You sharpen TikTok captions. Rewrite the given caption to be punchier and more scroll-stopping while keeping its core meaning. Keep it short, lowercase-leaning, native and casual (not corporate). Keep any #hashtags and @handles exactly as-is. Keep emoji count reasonable. Return only the rewritten caption.`;
  const res = await callClaude({
    apiKey: opts.apiKey,
    model: opts.model,
    maxTokens: 700,
    system: [{ type: 'text', text: system }],
    messages: [{ role: 'user', content: opts.caption }],
  });
  const text = res.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  if (!text) throw new Error('No caption returned.');
  return text;
}

export async function translateCaption(opts: {
  caption: string;
  language: string;
  apiKey: string;
  model: ClaudeModelId;
}): Promise<string> {
  const system = `You localize short TikTok captions. Translate the caption into ${opts.language}, written the way a native creator on that side of TikTok would actually phrase it (casual, punchy — not a stiff literal translation). Keep any #hashtags and @handles exactly as-is (do not translate them). Keep emoji. Return only the translated caption.`;
  const res = await callClaude({
    apiKey: opts.apiKey,
    model: opts.model,
    maxTokens: 700,
    system: [{ type: 'text', text: system }],
    messages: [{ role: 'user', content: opts.caption }],
  });
  const text = res.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  if (!text) throw new Error('No translation returned.');
  return text;
}

// Join the caption body + hashtag line the way the textarea expects.
// Generate fresh, relevant hashtags from the slide content WITHOUT touching
// the caption body — for when you wrote your own caption and just want tags.
export async function generateHashtagsAI(opts: {
  json: string;
  preset: string;
  apiKey: string;
  model: ClaudeModelId;
  count?: number;
}): Promise<string[]> {
  const n = opts.count || 7;
  const content = summariseSlides(opts.json);
  const system = `You pick TikTok hashtags for short AI/education posts (brand: "Iro AI"). Return ${n} relevant, mostly-lowercase hashtags as a good mix of broad reach + specific niche tags. Include #aitok where it fits. No spaces in a tag, no duplicates, no # walls of generic spam.`;
  const res = await callClaude({
    apiKey: opts.apiKey,
    model: opts.model,
    maxTokens: 300,
    system: [{ type: 'text', text: system }],
    messages: [{ role: 'user', content: `Format: ${opts.preset}\n\nSlide content:\n${content}\n\nGive me the hashtags.` }],
    tools: [{
      name: 'hashtags',
      description: 'Return the hashtag list (WITHOUT the # prefix).',
      input_schema: { type: 'object', properties: { hashtags: { type: 'array', items: { type: 'string' } } }, required: ['hashtags'] },
    }],
    toolChoice: { type: 'tool', name: 'hashtags' },
  });
  const out = extractToolUse<{ hashtags: string[] }>(res, 'hashtags');
  return (out && Array.isArray(out.hashtags) ? out.hashtags : []).map((t) => t.replace(/^#/, '').trim()).filter(Boolean);
}

export function composeCaption(caption: string, hashtags: string[]): string {
  if (!hashtags.length) return caption;
  return `${caption}\n\n${hashtags.map((t) => `#${t}`).join(' ')}`;
}
