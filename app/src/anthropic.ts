// Thin Anthropic Messages API client for the Iro slideshow cloner.
// Runs in the browser via the `anthropic-dangerous-direct-browser-access`
// header — this is fine for a BYOK app where the API key is the user's
// own and lives in localStorage.

export const CLAUDE_MODELS = [
  // Newest/best — Opus 4.7 is highest-quality but the slowest and
  // priciest. Sonnet 4.6 is the sweet spot for structured JSON output
  // with creative rewrites. Haiku 4.5 is cheapest, blander.
  { id: 'claude-opus-4-7', label: 'Opus 4.7 — best quality, $$$' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6 — balanced (recommended)' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5 — fastest, cheapest' },
] as const;

export type ClaudeModelId = (typeof CLAUDE_MODELS)[number]['id'];

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

// Block accepted by the Messages API for prompt caching. Marking the
// large IRO spec system block as ephemeral cached saves ~80% of input
// tokens on every clone after the first.
type SystemBlock = { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } };

type Tool = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

// Content blocks we send up in a user/assistant message. Text is the
// common case; image blocks (base64) power the "read my own post" vision
// flow where Claude reads the on-screen text off each slide photo.
export type RequestContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

type CallOptions = {
  apiKey: string;
  model: ClaudeModelId;
  system: SystemBlock[];
  messages: Array<{
    role: 'user' | 'assistant';
    content: string | RequestContentBlock[];
  }>;
  tools?: Tool[];
  toolChoice?: { type: 'tool'; name: string } | { type: 'auto' };
  maxTokens?: number;
};

export type ClaudeContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };

export type ClaudeResponse = {
  id: string;
  model: string;
  role: 'assistant';
  content: ClaudeContentBlock[];
  stop_reason: string;
  usage: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
};

export class AnthropicError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'AnthropicError';
  }
}

export async function callClaude(opts: CallOptions): Promise<ClaudeResponse> {
  if (!opts.apiKey) throw new AnthropicError('Missing Anthropic API key. Add one in Settings.');
  const body: Record<string, unknown> = {
    model: opts.model,
    max_tokens: opts.maxTokens ?? 4096,
    system: opts.system,
    messages: opts.messages,
  };
  if (opts.tools && opts.tools.length > 0) body.tools = opts.tools;
  if (opts.toolChoice) body.tool_choice = opts.toolChoice;

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'x-api-key': opts.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let detail = '';
    try {
      const j = (await res.json()) as { error?: { message?: string } };
      detail = j?.error?.message || '';
    } catch {}
    throw new AnthropicError(
      detail || `Anthropic API returned ${res.status}. Check your key, model name, and credit balance.`,
      res.status,
    );
  }

  return (await res.json()) as ClaudeResponse;
}

// Pulls the first tool_use block out of the response. Used by callers
// that asked Claude to emit structured JSON via a forced tool call.
export function extractToolUse<T = Record<string, unknown>>(
  response: ClaudeResponse,
  toolName: string,
): T {
  const block = response.content.find(
    (b): b is { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } =>
      b.type === 'tool_use' && b.name === toolName,
  );
  if (!block) {
    const text = response.content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    throw new AnthropicError(
      `Claude did not call the expected tool (${toolName}). Response text: ${text.slice(0, 400)}`,
    );
  }
  return block.input as T;
}
