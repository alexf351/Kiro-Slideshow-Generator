// "Fill from topic" — type a topic and Claude populates the CURRENT template's
// JSON, matching its exact structure. Distinct from Propose (which is a
// strategy engine that picks what to post next from your history); this just
// rewrites the chosen format's content about a topic you give it. Uses the
// existing BYOK Anthropic key + callClaude.

import { callClaude, extractToolUse, type ClaudeModelId } from './anthropic';

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
  const raw = (out && out.json) ? out.json.trim() : '';
  if (!raw) throw new Error('Claude returned no JSON.');
  // Validate + pretty-print so it drops cleanly into the editor.
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Sometimes the model wraps it in a code fence — strip and retry.
    const stripped = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    parsed = JSON.parse(stripped);
  }
  return JSON.stringify(parsed, null, 2);
}
