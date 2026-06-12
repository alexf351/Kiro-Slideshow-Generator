// Share a single post as a portable code. Encodes just the text content
// (format + slide JSON + caption) — no media blobs — so the code stays small
// and paste-friendly. A friend pastes it to load the exact post setup.

export type SharedPost = { preset: string; json: string; caption: string };

const PREFIX = 'IRO1:';

// UTF-8-safe base64 (captions contain emoji).
function b64encode(s: string): string {
  return btoa(unescape(encodeURIComponent(s)));
}
function b64decode(s: string): string {
  return decodeURIComponent(escape(atob(s)));
}

export function encodePost(p: SharedPost): string {
  return PREFIX + b64encode(JSON.stringify({ v: 1, preset: p.preset, json: p.json, caption: p.caption }));
}

export function decodePost(code: string): SharedPost | null {
  const trimmed = code.trim();
  const body = trimmed.startsWith(PREFIX) ? trimmed.slice(PREFIX.length) : trimmed;
  try {
    const obj = JSON.parse(b64decode(body)) as { preset?: unknown; json?: unknown; caption?: unknown };
    if (typeof obj.json !== 'string') return null;
    return {
      preset: typeof obj.preset === 'string' ? obj.preset : '',
      json: obj.json,
      caption: typeof obj.caption === 'string' ? obj.caption : '',
    };
  } catch {
    return null;
  }
}
