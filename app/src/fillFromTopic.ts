// "Fill from topic" — type a topic and Claude populates the CURRENT template's
// JSON, matching its exact structure. Distinct from Propose (which is a
// strategy engine that picks what to post next from your history); this just
// rewrites the chosen format's content about a topic you give it. Uses the
// existing BYOK Anthropic key + callClaude.

import { callClaude, extractToolUse, type ClaudeModelId } from './anthropic';

// Pick the best-fitting format for a topic. `formats` is the list of
// { key, label, pitch } the model can choose from. Returns a key (or '').
export async function pickFormat(opts: {
  topic: string;
  formats: { key: string; label: string; pitch: string }[];
  apiKey: string;
  model: ClaudeModelId;
  prefer?: string[]; // formats the user has pinned — bias toward these on a tie
}): Promise<string> {
  const list = opts.formats.map((f) => `- ${f.key}: ${f.pitch}`).join('\n');
  const preferLine = opts.prefer && opts.prefer.length
    ? ` When two or more formats fit the topic about equally well, prefer the ones the creator favors: ${opts.prefer.join(', ')}.`
    : '';
  const system = `You pick the single best TikTok slideshow format for a topic. Choose the one whose structure fits the topic most naturally and would perform best.${preferLine} Return only the key via the tool.`;
  const res = await callClaude({
    apiKey: opts.apiKey,
    model: opts.model,
    maxTokens: 200,
    system: [{ type: 'text', text: system }],
    messages: [{ role: 'user', content: `TOPIC: ${opts.topic}\n\nFORMATS:\n${list}\n\nPick the best key.` }],
    tools: [{
      name: 'format',
      description: 'Return the chosen format key.',
      input_schema: { type: 'object', properties: { key: { type: 'string', enum: opts.formats.map((f) => f.key) } }, required: ['key'] },
    }],
    toolChoice: { type: 'tool', name: 'format' },
  });
  const out = extractToolUse<{ key: string }>(res, 'format');
  return (out && out.key) ? out.key : '';
}

export async function generateFromTopic(opts: {
  topic: string;
  preset: string;
  exampleJson: string; // the preset's example JSON — used as the schema/shape
  apiKey: string;
  model: ClaudeModelId;
}): Promise<string> {
  const system = `You fill content templates for "Iro AI" TikTok slideshows (Iro is an app that teaches people to actually build with AI).
You receive an EXAMPLE JSON for the chosen format and a TOPIC. Return a NEW JSON object that:
- uses the EXACT same structure, field names, and nesting as the example
- keeps a similar number of items/slides
- replaces all the content so it's about the TOPIC, written in a punchy, native, lowercase-leaning TikTok voice
- keeps inline <strong> tags for emphasis in hooks/headlines/cta where the example uses them
- keeps the cta pointing to searchTerm "Iro AI" on the App Store
- leaves "attribution" as an empty string
Return ONLY the JSON via the tool — no commentary.`;

  const res = await callClaude({
    apiKey: opts.apiKey,
    model: opts.model,
    maxTokens: 2000,
    system: [{ type: 'text', text: system }],
    messages: [{
      role: 'user',
      content: `FORMAT: ${opts.preset}\n\nEXAMPLE JSON (match this shape exactly):\n${opts.exampleJson}\n\nTOPIC: ${opts.topic}\n\nReturn the filled JSON.`,
    }],
    tools: [{
      name: 'slides',
      description: 'Return the filled slideshow JSON as a string.',
      input_schema: {
        type: 'object',
        properties: { json: { type: 'string', description: 'The complete slides JSON, matching the example structure.' } },
        required: ['json'],
      },
    }],
    toolChoice: { type: 'tool', name: 'slides' },
  });

  const out = extractToolUse<{ json: string }>(res, 'slides');
  return prettyModelJson((out && out.json) ? out.json.trim() : '');
}

// Validate + pretty-print a JSON string the model returned (tolerating a
// stray ```json code fence).
function prettyModelJson(raw: string): string {
  if (!raw) throw new Error('Claude returned no JSON.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const stripped = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    parsed = JSON.parse(stripped);
  }
  return JSON.stringify(parsed, null, 2);
}

// Brainstorm post-topic ideas for a niche — feeds the batch generator.
export async function generateIdeas(opts: {
  niche: string;
  count: number;
  apiKey: string;
  model: ClaudeModelId;
}): Promise<string[]> {
  const system = `You brainstorm TikTok slideshow post ideas for "Iro AI" (an app that teaches people to actually build with AI). Given a NICHE/theme, return ${opts.count} short, specific, scroll-stopping post topics — one line each, ~4-9 words, no numbering. Vary the angles across the set (listicle, myth-busting, storytime, hot take, tutorial, before/after, tier list). Make them feel native to TikTok, not corporate.`;
  const res = await callClaude({
    apiKey: opts.apiKey,
    model: opts.model,
    maxTokens: 700,
    system: [{ type: 'text', text: system }],
    messages: [{ role: 'user', content: `NICHE: ${opts.niche}\n\nGive me the ideas.` }],
    tools: [{
      name: 'ideas',
      description: 'Return the list of post topic ideas.',
      input_schema: {
        type: 'object',
        properties: { topics: { type: 'array', items: { type: 'string' }, description: 'Each a short post topic.' } },
        required: ['topics'],
      },
    }],
    toolChoice: { type: 'tool', name: 'ideas' },
  });
  const out = extractToolUse<{ topics: string[] }>(res, 'ideas');
  return (out && Array.isArray(out.topics) ? out.topics : []).map((t) => String(t).replace(/^[\s\d.)-]+/, '').trim()).filter(Boolean);
}

// Rewrite a single slide/item's content (keeping its keys). Powers the
// per-slide ✨ button in Quick edit.
export async function rewriteItem(opts: {
  itemJson: string;
  preset: string;
  apiKey: string;
  model: ClaudeModelId;
}): Promise<string> {
  const system = `You revise ONE slide of an "Iro AI" TikTok slideshow (format: ${opts.preset}). You receive a single JSON object for that slide. Return a NEW object with the SAME keys, rewriting the values to be punchier, clearer and more scroll-stopping. Keep inline <strong> tags where present. Return ONLY the object via the tool.`;
  const res = await callClaude({
    apiKey: opts.apiKey,
    model: opts.model,
    maxTokens: 900,
    system: [{ type: 'text', text: system }],
    messages: [{ role: 'user', content: opts.itemJson }],
    tools: [{
      name: 'slides',
      description: 'Return the revised slide object as a JSON string.',
      input_schema: { type: 'object', properties: { json: { type: 'string' } }, required: ['json'] },
    }],
    toolChoice: { type: 'tool', name: 'slides' },
  });
  const out = extractToolUse<{ json: string }>(res, 'slides');
  return prettyModelJson((out && out.json) ? out.json.trim() : '');
}

// Rewrite the current post's content per an instruction (e.g. "make it
// punchier"), keeping the exact JSON structure. Distinct from
// generateFromTopic, which fills a blank format from a topic.
export async function improvePost(opts: {
  json: string;
  instruction: string;
  apiKey: string;
  model: ClaudeModelId;
}): Promise<string> {
  const system = `You revise content for "Iro AI" TikTok slideshows. You receive a slideshow JSON and an INSTRUCTION. Return a NEW JSON that:
- keeps the EXACT same structure, field names, nesting, and (unless the instruction says otherwise) the same number of items
- applies the instruction to the wording/content only
- keeps inline <strong> tags where present, keeps the cta pointing to searchTerm "Iro AI", leaves "attribution" empty
Return ONLY the JSON via the tool.`;
  const res = await callClaude({
    apiKey: opts.apiKey,
    model: opts.model,
    maxTokens: 2000,
    system: [{ type: 'text', text: system }],
    messages: [{ role: 'user', content: `INSTRUCTION: ${opts.instruction}\n\nCURRENT JSON:\n${opts.json}\n\nReturn the revised JSON.` }],
    tools: [{
      name: 'slides',
      description: 'Return the revised slideshow JSON as a string.',
      input_schema: { type: 'object', properties: { json: { type: 'string' } }, required: ['json'] },
    }],
    toolChoice: { type: 'tool', name: 'slides' },
  });
  const out = extractToolUse<{ json: string }>(res, 'slides');
  return prettyModelJson((out && out.json) ? out.json.trim() : '');
}
