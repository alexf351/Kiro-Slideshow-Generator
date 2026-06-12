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

export async function generateCaption(opts: {
  json: string;
  preset: string;
  apiKey: string;
  model: ClaudeModelId;
  examples?: string[]; // a few of the user's past captions, for voice
}): Promise<{ caption: string; hashtags: string[] }> {
  const content = summariseSlides(opts.json);
  const voice = opts.examples && opts.examples.length
    ? `\n\nMatch the voice of these past captions:\n${opts.examples.slice(0, 4).map((c) => `- ${c.slice(0, 200)}`).join('\n')}`
    : '';

  const system = `You write TikTok captions for short educational/AI slideshow posts (the brand is "Iro AI", an app that teaches people to actually build with AI).
Rules:
- 1-3 short lines, lowercase-leaning, native and casual — NOT corporate.
- Lead with a hook or a relatable line. No "In this post we will".
- End with a soft nudge to search "Iro AI" on the App Store ONLY if it fits naturally.
- Then 4-7 relevant lowercase hashtags (mix of broad + niche). Include #aitok where it fits.
- No emojis spam (0-2 max). No hashtag walls inside the body.${voice}`;

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

// Join the caption body + hashtag line the way the textarea expects.
export function composeCaption(caption: string, hashtags: string[]): string {
  if (!hashtags.length) return caption;
  return `${caption}\n\n${hashtags.map((t) => `#${t}`).join(' ')}`;
}
