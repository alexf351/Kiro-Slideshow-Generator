// Optional OpenAI image-edit client. Used by the "AI-edit source
// images" opt-in in the TikTok clone flow: takes a source TikTok
// slide image + a tailored Iro prompt, returns a new image that
// drops Iro branding/composition into the original frame.
//
// BYOK with an OpenAI Platform API key (separate from a ChatGPT
// subscription — there is no OAuth that lets a third-party app
// charge against your ChatGPT Plus account). Pay-per-image, roughly
// $0.04-0.19 depending on quality.

const ENDPOINT = 'https://api.openai.com/v1/images/edits';

export type OpenAIImageQuality = 'low' | 'medium' | 'high';

export type EditOptions = {
  apiKey: string;
  sourceImage: Blob;
  prompt: string;
  // 1024x1536 = portrait, closest to the 9:16 1080×1920 slide canvas.
  size?: '1024x1024' | '1024x1536' | '1536x1024';
  quality?: OpenAIImageQuality;
};

export class OpenAIImageError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'OpenAIImageError';
  }
}

export async function editImage(opts: EditOptions): Promise<Blob> {
  if (!opts.apiKey) throw new OpenAIImageError('Missing OpenAI API key. Add one in Settings.');

  const form = new FormData();
  form.append('model', 'gpt-image-1');
  form.append('image', opts.sourceImage, 'source.png');
  form.append('prompt', opts.prompt);
  form.append('n', '1');
  form.append('size', opts.size || '1024x1536');
  form.append('quality', opts.quality || 'medium');

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${opts.apiKey}` },
    body: form,
  });

  if (!res.ok) {
    let detail = '';
    try {
      const j = (await res.json()) as { error?: { message?: string } };
      detail = j?.error?.message || '';
    } catch {}
    throw new OpenAIImageError(
      detail || `OpenAI image API returned ${res.status}.`,
      res.status,
    );
  }

  const json = (await res.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
  const first = json.data && json.data[0];
  if (!first) throw new OpenAIImageError('OpenAI returned no image data.');

  if (first.b64_json) {
    const bin = atob(first.b64_json);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return new Blob([buf], { type: 'image/png' });
  }
  if (first.url) {
    const dl = await fetch(first.url);
    if (!dl.ok) throw new OpenAIImageError(`Failed to download generated image (${dl.status})`);
    return await dl.blob();
  }
  throw new OpenAIImageError('OpenAI response had neither b64_json nor url.');
}

// Default prompt template used when AI-editing a cloned TikTok slide.
// Keeps the source composition and lighting, drops in Iro brand cues
// instead of whatever product/topic the source was selling.
export function buildIroEditPrompt(opts: { slideRoleLabel: string; sourceCaption: string }): string {
  return [
    'Edit this image to fit a slide for the Iro AI mobile app (a "Duolingo for AI" learning app).',
    'KEEP: the original composition, lighting direction, color grade, framing, and photographic style.',
    `CHANGE: any visible product / logo / brand / label in the frame should be subtly removed or replaced with Iro app cues (clean cyan accent, app-icon vibe). Slide role: ${opts.slideRoleLabel}.`,
    'Do not add any text overlay — the slide will get its own text rendered on top.',
    'Output must read as if the original photographer shot the scene for Iro.',
    'Avoid generating any human faces if none were in the source. If a face is in the source, keep it.',
    `Source post context (for tone, not literal content): ${opts.sourceCaption.slice(0, 280)}`,
  ].join(' ');
}
