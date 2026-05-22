// End-to-end "paste TikTok URL → cloned-for-Iro slideshow" pipeline.
//
// Stage 1: hit /api/scrape-tiktok to pull the source post's caption,
//          author and per-slide image URLs.
// Stage 2: ask Claude to read the structure and emit a parallel
//          slideshow tailored for Iro AI, using the same preset
//          schemas the engine already knows.
// Stage 3: download the source images through /api/proxy-tiktok-image
//          (CORS-friendly proxy) into the existing IndexedDB media
//          bank so they can be assigned as per-slide backgrounds.
//
// The orchestration is "clone, don't template" — the source images
// become the actual slide backgrounds (the Iro mascot + text overlay
// renders on top), not stock photos. See Adrià Martinez's writeup for
// the conversion theory behind that choice.

import ironSpec from '../../IRO_SLIDESHOW_JSON_SPEC.md?raw';
import { callClaude, extractToolUse, type ClaudeModelId } from './anthropic';
import { addStockItem, type MediaItem } from './mediaBank';
import { PRESET_KEYS, type PresetKey } from './presets';

export type SourceSlide = {
  index: number;
  imageUrl: string;
  width?: number;
  height?: number;
};

export type ScrapeResult = {
  url: string;
  kind: 'photo_slideshow' | 'video' | 'unknown';
  caption: string;
  hashtags: string[];
  author: { uniqueId: string; nickname: string };
  slides: SourceSlide[];
  coverImage: string | null;
  durationSeconds: number | null;
  createdAt: number | null;
  rawTitle: string | null;
};

export type CloneAnalysis = {
  structuralFingerprint: string;
  hookStyle: string;
  density: string;
  ctaShape: string;
  niche: string;
  voiceTone: string;
};

// What Claude returns via the forced tool call. Shape mirrors the
// emit_clone tool's input_schema below.
export type ClaudeCloneOutput = {
  preset: PresetKey;
  // Preset-specific JSON. We validate the preset key but leave the
  // payload to the engine to render — easier to evolve than mirroring
  // every preset's TypeScript shape here.
  slides: Record<string, unknown>;
  caption: string;
  cloneAnalysis: CloneAnalysis;
  // Per-rendered-slide hint about which source slide image (by index)
  // to use as the bg. null = leave default. Length should match the
  // rendered slide count in render order (hook, content[0..N], cta).
  // If Claude returns more/fewer, we truncate or pad with null.
  bgAssignments: Array<number | null>;
};

export type CloneOptions = {
  apiKey: string;
  model: ClaudeModelId;
  url: string;
  // Optional extra context the user typed in (e.g. "make this for
  // gen-z designers" or "use the diamond mascot"). Concatenated into
  // the user message.
  guidance?: string;
  // Preset hint. If set, we strongly instruct Claude to emit this
  // preset rather than picking one. If undefined, Claude picks based
  // on the source post's shape.
  preferredPreset?: PresetKey;
  onStage?: (stage: CloneStage) => void;
};

export type CloneStage =
  | { kind: 'scraping' }
  | { kind: 'scraped'; source: ScrapeResult }
  | { kind: 'reasoning' }
  | { kind: 'analyzed'; clone: ClaudeCloneOutput }
  | { kind: 'fetching_images'; done: number; total: number }
  | { kind: 'done'; result: CloneResult };

export type CloneResult = {
  source: ScrapeResult;
  clone: ClaudeCloneOutput;
  // mediaItems[i] is the media-bank item for source slide i, or null
  // if the download failed or there was no image for that index.
  mediaItems: Array<MediaItem | null>;
};

const EMIT_CLONE_TOOL = {
  name: 'emit_clone',
  description:
    'Emit the cloned Iro slideshow. The slides field MUST follow the schema for the chosen preset (defined in the system prompt).',
  input_schema: {
    type: 'object',
    required: ['preset', 'slides', 'caption', 'cloneAnalysis', 'bgAssignments'],
    properties: {
      preset: {
        type: 'string',
        enum: PRESET_KEYS,
        description: 'Which Iro engine preset to render the clone with.',
      },
      slides: {
        type: 'object',
        description:
          'Preset-specific JSON. Must include attribution "@tryiro" and a cta pointing to "Iro AI" on the App Store. Follow the schema in the system prompt exactly — do not invent fields.',
        additionalProperties: true,
      },
      caption: {
        type: 'string',
        description:
          'TikTok caption tailored to Iro. First line is the hook. End with 4-6 niche hashtags. Match the source caption\'s length and rhythm.',
      },
      cloneAnalysis: {
        type: 'object',
        required: ['structuralFingerprint', 'hookStyle', 'density', 'ctaShape', 'niche', 'voiceTone'],
        properties: {
          structuralFingerprint: { type: 'string', description: 'One sentence: the post\'s shape (hook → N proof beats → CTA, etc.).' },
          hookStyle: { type: 'string', description: 'What the hook does (question, stat, confession, POV, list teaser, etc.).' },
          density: { type: 'string', description: 'Text density per slide (e.g. "1 line per slide, ≤8 words").' },
          ctaShape: { type: 'string', description: 'How the CTA lands (hard sell, soft pivot, app screenshot, etc.).' },
          niche: { type: 'string', description: 'Niche of the source (e.g. "productivity / AI tools").' },
          voiceTone: { type: 'string', description: 'Lowercase confessional, all-caps caps-lock, deadpan, etc.' },
        },
      },
      bgAssignments: {
        type: 'array',
        items: { type: ['integer', 'null'] },
        description:
          'For each rendered slide in render order (hook → middle slides → cta), the 0-based index of the SOURCE slide image to use as the background, or null to leave default. Aim for a 1:1 mapping when slide counts align; otherwise reuse images that match the slide\'s topic.',
      },
    },
  },
};

const PROXY_ENDPOINT = '/api/proxy-tiktok-image';
const SCRAPE_ENDPOINT = '/api/scrape-tiktok';

export async function scrapeTikTok(url: string): Promise<ScrapeResult> {
  const res = await fetch(`${SCRAPE_ENDPOINT}?url=${encodeURIComponent(url)}`);
  if (!res.ok) {
    let detail = '';
    try {
      const j = (await res.json()) as { error?: string };
      detail = j?.error || '';
    } catch {}
    throw new Error(detail || `Scrape failed (${res.status})`);
  }
  return (await res.json()) as ScrapeResult;
}

export async function fetchProxiedImage(url: string): Promise<Blob> {
  const res = await fetch(`${PROXY_ENDPOINT}?url=${encodeURIComponent(url)}`);
  if (!res.ok) throw new Error(`Image proxy failed (${res.status})`);
  return await res.blob();
}

// Build the user-side message: a structural dump of what we scraped
// from the source post. Claude reads this and emits the parallel
// slideshow.
function buildUserMessage(source: ScrapeResult, opts: { guidance?: string; preferredPreset?: PresetKey }): string {
  const lines: string[] = [];
  lines.push('# Source TikTok post');
  lines.push(`URL: ${source.url}`);
  lines.push(`Kind: ${source.kind}`);
  lines.push(`Author: @${source.author.uniqueId}${source.author.nickname ? ` (${source.author.nickname})` : ''}`);
  if (source.durationSeconds) lines.push(`Duration: ${source.durationSeconds}s`);
  lines.push('');
  lines.push('## Caption');
  lines.push(source.caption || '(no caption)');
  if (source.hashtags.length > 0) {
    lines.push('');
    lines.push(`Hashtags found: ${source.hashtags.map((h) => '#' + h).join(' ')}`);
  }
  lines.push('');
  lines.push(`## Slides (${source.slides.length} image${source.slides.length === 1 ? '' : 's'})`);
  if (source.slides.length === 0) {
    lines.push('(No slide images extracted — likely a video post. Use the caption + duration to infer structure.)');
  } else {
    source.slides.forEach((s) => {
      lines.push(`- Slide ${s.index} (${s.width || '?'}×${s.height || '?'})`);
    });
  }
  lines.push('');
  lines.push('# Your task');
  lines.push(
    'Read the source post above. Identify its structural fingerprint — hook style, ' +
      'how text density flows across slides, how the CTA lands. Then emit a PARALLEL ' +
      'slideshow tailored for Iro AI (the "Duolingo for AI" mobile app — see system prompt). ' +
      'The clone should preserve the source\'s rhythm: if the source uses short verdict ' +
      'labels per slide, your clone uses short verdict labels. If the source is one ' +
      'emotional hook on slide 1, your clone is one emotional hook on slide 1. ' +
      'Don\'t get clever — copy what already works, then swap the topic to Iro.',
  );
  lines.push('');
  lines.push(
    'For bgAssignments, map each rendered slide to the best-matching source slide ' +
      'index — e.g. if the source has 1 hook image + 3 step images + 1 CTA image and ' +
      'your clone has the same shape, return [0,1,2,3,4]. If the clone has fewer or ' +
      'different slides, pick the most topically relevant source slide for each.',
  );
  if (opts.preferredPreset) {
    lines.push('');
    lines.push(`## Required preset`);
    lines.push(`Render as the \`${opts.preferredPreset}\` preset. Follow that preset's schema exactly.`);
  } else {
    lines.push('');
    lines.push(
      '## Preset choice\nPick the preset that best matches the source post\'s shape. ' +
        'Available: prompt_pack (numbered list), pain_story (lowercase confession), ' +
        'aspirational (bold cinematic), meme_pov (top/bottom captions), product_demo ' +
        '(feature walkthrough), checklist (qualifier "if you…"), handwritten_pack ' +
        '(notebook aesthetic prompt list).',
    );
  }
  if (opts.guidance && opts.guidance.trim()) {
    lines.push('');
    lines.push('## Extra guidance from the user');
    lines.push(opts.guidance.trim());
  }
  lines.push('');
  lines.push('Call the emit_clone tool with your result. Do not include any text outside the tool call.');
  return lines.join('\n');
}

const CLONING_INSTRUCTIONS = [
  '## Cloning-specific instructions',
  '',
  'You are being used inside the Iro Slideshow Generator\'s "Clone from TikTok" flow. ' +
    'The user pastes a TikTok URL; we scrape it and feed you the structure plus caption. ' +
    'Your job is fidelity: match the source post\'s rhythm and density, then swap the ' +
    'topic to Iro AI.',
  '',
  'Slide counts to aim for, by preset (matches the IRO_SLIDESHOW_JSON_SPEC above): ' +
    'prompt_pack 1+3-7+1 (hook+prompts+cta), pain_story 1+3-5+1, aspirational 1+3-5+1, ' +
    'meme_pov 1-3 (CTA optional), product_demo 1+3-4+1, checklist 1+5-7+1, ' +
    'handwritten_pack 1+3-7+1.',
  '',
  'If the source post has a different slide count than the preset\'s typical range, ' +
    'lean toward the source count — fidelity beats convention.',
].join('\n');

// Strip wrappers from a pasted manual response — markdown fences,
// "Here's the JSON:" preambles, trailing commentary. Keeps the
// outermost {...} block.
function extractJsonObject(text: string): string {
  let t = text.trim();
  t = t.replace(/^```(?:json|javascript|js)?\s*/i, '').replace(/```\s*$/, '').trim();
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first === -1 || last === -1 || last < first) return t;
  return t.slice(first, last + 1);
}

// Same shape Claude returns via tool_use. Used by both the API path
// (auto-parsed from the tool input) and the manual path (parsed from
// pasted text).
function validateClone(parsed: unknown): ClaudeCloneOutput {
  if (!parsed || typeof parsed !== 'object') throw new Error('Response is not a JSON object.');
  const p = parsed as Partial<ClaudeCloneOutput>;
  if (!p.preset || !PRESET_KEYS.includes(p.preset as PresetKey)) {
    throw new Error(`Missing or unknown preset (got: ${String(p.preset)}).`);
  }
  if (!p.slides || typeof p.slides !== 'object') {
    throw new Error('Missing "slides" object in response.');
  }
  return {
    preset: p.preset as PresetKey,
    slides: p.slides as Record<string, unknown>,
    caption: typeof p.caption === 'string' ? p.caption : '',
    cloneAnalysis: (p.cloneAnalysis as CloneAnalysis) || {
      structuralFingerprint: '', hookStyle: '', density: '', ctaShape: '', niche: '', voiceTone: '',
    },
    bgAssignments: Array.isArray(p.bgAssignments) ? p.bgAssignments : [],
  };
}

// Stage 3 of either pipeline: pull every source slide image through
// the CORS-friendly proxy and stash it in the media bank.
async function fetchSourceImagesIntoLibrary(
  source: ScrapeResult,
  onStage?: (stage: CloneStage) => void,
): Promise<Array<MediaItem | null>> {
  const mediaItems: Array<MediaItem | null> = new Array(source.slides.length).fill(null);
  let done = 0;
  onStage?.({ kind: 'fetching_images', done, total: source.slides.length });
  await Promise.all(
    source.slides.map(async (slide, i) => {
      try {
        const blob = await fetchProxiedImage(slide.imageUrl);
        const item = await addStockItem({
          blob,
          mimeType: blob.type || 'image/jpeg',
          name: `tiktok-@${source.author.uniqueId || 'unknown'}-slide-${i + 1}`,
          source: {
            provider: 'upload',
            photographer: source.author.nickname || source.author.uniqueId,
            photographerUrl: `https://www.tiktok.com/@${source.author.uniqueId}`,
            photoUrl: source.url,
          },
        });
        mediaItems[i] = item;
      } catch {
        // Single-image failure shouldn't abort the whole clone. The
        // corresponding slide just gets no auto-bg and the user can
        // pick one manually from the Library.
      } finally {
        done++;
        onStage?.({ kind: 'fetching_images', done, total: source.slides.length });
      }
    }),
  );
  return mediaItems;
}

export async function cloneFromTikTok(opts: CloneOptions): Promise<CloneResult> {
  const stage = opts.onStage || (() => {});

  stage({ kind: 'scraping' });
  const source = await scrapeTikTok(opts.url);
  stage({ kind: 'scraped', source });

  stage({ kind: 'reasoning' });
  const response = await callClaude({
    apiKey: opts.apiKey,
    model: opts.model,
    // Cache-marked system block — IRO spec is ~5k tokens, gets reused
    // verbatim across clones, so ephemeral caching pays back fast.
    system: [
      {
        type: 'text',
        text: ironSpec + '\n\n' + CLONING_INSTRUCTIONS + '\n\nAlways call the emit_clone tool.',
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: buildUserMessage(source, opts) }],
    tools: [EMIT_CLONE_TOOL],
    toolChoice: { type: 'tool', name: 'emit_clone' },
    maxTokens: 4096,
  });

  const clone = validateClone(extractToolUse<ClaudeCloneOutput>(response, 'emit_clone'));
  stage({ kind: 'analyzed', clone });

  const mediaItems = await fetchSourceImagesIntoLibrary(source, stage);
  const result: CloneResult = { source, clone, mediaItems };
  stage({ kind: 'done', result });
  return result;
}

// Manual-mode path: scrape the URL and return both the source and a
// self-contained prompt the user can paste into claude.ai. We don't
// call any API here — only the scrape + image proxy endpoints, which
// run on Vercel and don't bill per token.
export async function prepareManualClone(opts: {
  url: string;
  guidance?: string;
  preferredPreset?: PresetKey;
}): Promise<{ source: ScrapeResult; prompt: string }> {
  const source = await scrapeTikTok(opts.url);
  return { source, prompt: buildManualPrompt(source, opts) };
}

// Builds the single self-contained prompt the user pastes into
// claude.ai. Bundles the IRO spec + cloning instructions + the
// scraped source + an explicit JSON schema (since claude.ai can't
// receive our tool definition).
export function buildManualPrompt(
  source: ScrapeResult,
  opts: { guidance?: string; preferredPreset?: PresetKey },
): string {
  const skeleton = {
    preset: '<one of: ' + PRESET_KEYS.join(' | ') + '>',
    slides: '<preset-specific JSON — must match the schema above EXACTLY for the chosen preset>',
    caption: '<TikTok caption tailored to Iro. First line is the hook. End with 4-6 niche hashtags.>',
    cloneAnalysis: {
      structuralFingerprint: '<one sentence: the post\'s shape>',
      hookStyle: '<question / stat / confession / POV / list teaser / ...>',
      density: '<text density per slide>',
      ctaShape: '<how the CTA lands>',
      niche: '<niche of the source>',
      voiceTone: '<voice register>',
    },
    bgAssignments: '<array of source-slide indexes (0-based) or null, one per RENDERED slide in render order (hook → middle → cta)>',
  };

  return [
    '# IRO SLIDESHOW SPEC',
    '',
    ironSpec,
    '',
    '# ' + CLONING_INSTRUCTIONS,
    '',
    '# SOURCE POST DATA',
    '',
    buildUserMessage(source, opts),
    '',
    '# OUTPUT FORMAT',
    '',
    'Output ONLY a single JSON object matching the shape below. No commentary, no markdown ' +
      'fences, nothing before or after. The user is going to copy your message verbatim and ' +
      'paste it back into a JSON parser.',
    '',
    '```json',
    JSON.stringify(skeleton, null, 2),
    '```',
  ].join('\n');
}

// Manual-mode finish: takes the user's paste-back of the Claude.ai
// reply, parses it, validates it, and runs Stage 3 (image fetch). The
// `source` argument is whatever prepareManualClone returned earlier
// — we need it to know which images to download.
export async function applyManualResponse(
  responseText: string,
  source: ScrapeResult,
  onStage?: (stage: CloneStage) => void,
): Promise<CloneResult> {
  const jsonText = extractJsonObject(responseText);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    throw new Error(
      'That doesn\'t parse as JSON. Make sure you copied Claude.ai\'s full response — only the JSON object, no extra text.',
    );
  }
  const clone = validateClone(parsed);
  onStage?.({ kind: 'analyzed', clone });
  const mediaItems = await fetchSourceImagesIntoLibrary(source, onStage);
  const result: CloneResult = { source, clone, mediaItems };
  onStage?.({ kind: 'done', result });
  return result;
}

// Given a cloned slideshow's parsed JSON, derive the same "render
// order" key list the bg picker uses (hook, content[i], cta). This
// has to mirror extractSlideMeta in App.tsx so the bgAssignments
// indices line up with the right slot keys.
//
// Returns an array of { key, label } in render order.
export function renderOrderKeys(slides: Record<string, unknown>): Array<{ key: string }> {
  const keys: Array<{ key: string }> = [];
  if (slides.hook) keys.push({ key: 'hook' });
  const contentArrays: Array<[string, string]> = [
    ['prompts', 'prompt'],
    ['beats', 'beat'],
    ['panels', 'panel'],
    ['features', 'feature'],
    ['items', 'item'],
  ];
  for (const [field, prefix] of contentArrays) {
    const arr = slides[field];
    if (Array.isArray(arr)) {
      arr.forEach((_, i) => keys.push({ key: `${prefix}:${i}` }));
    }
  }
  if (slides.cta) keys.push({ key: 'cta' });
  return keys;
}
