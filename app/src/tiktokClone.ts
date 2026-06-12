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
import { callClaude, extractToolUse, type ClaudeModelId, type RequestContentBlock } from './anthropic';
import { addStockItem, blobToDataUrl, type MediaItem } from './mediaBank';
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
          'Preset-specific JSON with a cta pointing to "Iro AI" on the App Store. Leave attribution as an empty string unless the source clearly shows a creator handle. Follow the schema in the system prompt exactly — do not invent fields.',
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
    let diagnostics: Array<{
      ua: string;
      status: number;
      hasBlob: boolean;
      scopeKeys: string[];
      resolvedTo: string;
      finalUrl?: string;
      followedCanonical?: boolean;
    }> = [];
    try {
      const j = (await res.json()) as { error?: string; diagnostics?: typeof diagnostics };
      detail = j?.error || '';
      if (Array.isArray(j?.diagnostics)) diagnostics = j.diagnostics;
    } catch {}
    // Compact each UA attempt onto its own line so the diagnostic is
    // readable in the UI. Includes the final landed URL so we can
    // see if a TikTok redirect dumped us somewhere unexpected.
    const diagSummary = diagnostics
      .map((d) => {
        const parts = [
          `[${d.ua}]`,
          `status=${d.status}`,
          `blob=${d.hasBlob}`,
          d.followedCanonical ? 'follow=yes' : '',
          `scopes=${d.scopeKeys.join(',') || 'none'}`,
          d.finalUrl ? `→ ${d.finalUrl}` : '',
        ].filter(Boolean);
        return parts.join(' ');
      })
      .join('\n');
    throw new Error(
      (detail || `Scrape failed (${res.status})`) + (diagSummary ? `\n\n${diagSummary}` : ''),
    );
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
    lines.push('(No slide images extracted — likely a video post. Use the caption to infer structure.)');
  } else {
    lines.push(`The ${source.slides.length} actual slide images are ATTACHED below, in order. Study them.`);
  }
  lines.push('');
  lines.push('# Your task');
  lines.push(
    'LOOK at the attached slides, then emit a PARALLEL slideshow that matches their VISUAL STYLE, ' +
      'per-slide structure, density and voice (see the cloning instructions in the system prompt). ' +
      'Keep the source\'s content GENRE — only swap the specifics toward Iro AI (the "Duolingo for ' +
      'AI" app), woven in naturally and lightly. If the source is one short overlay phrase per ' +
      'aesthetic photo, your clone is one short overlay phrase per photo. Do NOT default to a ' +
      'numbered "AI prompts" pack unless the source itself is a numbered prompt/list post.',
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
      '## Preset choice\nPick the preset whose RENDERED look matches the source photos (see the ' +
        'look-based guide in the system prompt). For photo-driven posts with native overlay text ' +
        '(dark-academia / BookTok / aesthetic), use pain_story or aspirational — NOT handwritten_pack.',
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
  'You are inside the Iro Slideshow Generator\'s "Clone from TikTok" flow. The user pastes a ' +
    'TikTok URL; we scrape it and ATTACH THE ACTUAL SLIDE IMAGES below. LOOK AT THEM. Your job ' +
    'is fidelity to what you SEE — the visual style, the on-screen text, the rhythm — then a ' +
    'light topical swap toward Iro AI.',
  '',
  '### Read the images first',
  'Before writing anything, identify from the attached slides:',
  '- Visual style: full-bleed cinematic/aesthetic photo? notebook/handwritten? plain meme caption? ' +
    'chat/UI screenshots? phone mockups?',
  '- How text sits: native-looking overlay text ON a photo (most aesthetic posts) vs. heavily ' +
    'designed graphic boxes.',
  '- Per-slide structure: e.g. "one habit + a book cover + a short parenthetical aside", or ' +
    '"one numbered prompt in a chat bubble". Copy THAT structure.',
  '- Voice/register: lowercase confessional, punchy all-caps, editorial, deadpan — match it exactly.',
  '- The content GENRE (books/habits/routines/opinions/prompts). Keep the SAME genre; do not turn ' +
    'a "habits / books / ways to learn" post into a generic "AI prompts" list. If the source lists ' +
    'habits, your clone lists habits (that happen to involve Iro). Weave Iro in naturally and ' +
    'lightly — the post should read like the creator\'s, not like an ad.',
  '',
  '### Pick the preset whose RENDERED look matches the source photo',
  '- pain_story — full-bleed moody/aesthetic photo with soft overlay text (use this for dark-' +
    'academia / BookTok / "that girl" aesthetic photo posts).',
  '- aspirational — cinematic luxury photo with a bold bottom-anchored hook.',
  '- meme_pov — image-dominant, short top/bottom caption with thick stroke.',
  '- prompt_pack — numbered items in chat-style bubbles (ONLY when the source actually shows a ' +
    'numbered list / chat UI).',
  '- handwritten_pack — cream paper + handwritten ink (ONLY for genuinely notebook/handwritten ' +
    'aesthetics; NOT for photo posts).',
  '- product_demo — phone mockup + app screenshots. app_stack — "apps I use" carousel. ' +
    'checklist — "if you…" qualifier list.',
  '- receipts — social-proof testimonials, one gold-star review per slide with a quote + ' +
    'reviewer name (ONLY when the source is reviews / testimonials / "what people are saying"). ' +
    'reviews:[{stars:1-5, text, name}].',
  '- tweet — "screenshot of a tweet" cards, one X/Twitter post per slide: avatar, name, ' +
    'verified check, @handle, the tweet text, faux engagement counts (ONLY when the source is ' +
    'tweets / X posts / quote-tweet style content). tweets:[{name, handle, text, verified, ' +
    'replies, retweets, likes}].',
  '- notes — iOS Notes-app screenshot look, one note per slide: yellow "Notes" bar, a date, a ' +
    'bold title, and the body (ONLY for announcement / storytime / confession / list content ' +
    'that suits the "notes app" aesthetic). notes:[{title, body, date}]; body may use <br/>.',
  '- output_vs_hype — one slide per tool/brand, each with a logo and two bars (Output vs Hype) ' +
    'scaled 0–100 (ONLY when the source is a per-item bar-chart comparison, e.g. "X vs Y" rankings).',
  '- curated_list — aesthetic photo + cream heading + a recommendation card per slide ("things I ' +
    'recommend" / book/app/podcast picks).',
  '- tier_list — S/A/B/C/D/F ranking, one colored tier per slide ("I ranked every X").',
  '- myth_fact — red ✗ MYTH card over a green ✓ FACT card per slide (debunking misconceptions).',
  '- hot_take — bold full-bleed opinion per slide on a fiery gradient ("unpopular opinion" / hot takes).',
  '- storytime — iMessage-style chat that reveals one bubble per slide (text-message storytime; ' +
    'items:[{from:"them"|"me", text}] + a top-level "contact").',
  '- stat_drop — one giant glowing statistic + label per slide ("the numbers don\'t lie").',
  '- this_or_that — a prompt + two option panels split by a VS badge ("comment your pick" polls).',
  '- quote_card — centered serif quote + author on a gold gradient (quote/wisdom carousels).',
  '- before_after — a muted BEFORE card → arrow → glowing AFTER card per slide (transformations).',
  '- countdown — ranked listicle counting DOWN to a gold #1 (items:[{title, body}]).',
  '- definition — dictionary-style term cards on cream (items:[{term, pron, def, example}]; AI ' +
    'glossary / "word of the day").',
  '- qa — Instagram-question-sticker bubble + answer per slide (items:[{q, a}]; AMA / FAQ).',
  '- flags — one color-coded flag per slide (items:[{flag, type:"green"|"red"}]; "green flags / ' +
    'red flags of X").',
  '- steps — sequential how-to, one numbered step per slide with a progress bar ' +
    '(items:[{title, body}]; "how to X in N steps" tutorials).',
  'Most of the above (tier_list, myth_fact, hot_take, stat_drop, this_or_that, quote_card, ' +
    'before_after, countdown, definition, qa, flags, steps) use an `items` array — match the ' +
    'example JSON\'s fields exactly.',
  'Prefer a PHOTO-background preset (pain_story / aspirational / meme_pov) whenever the source is ' +
    'photo-driven with native overlay text — that is the most common TikTok aesthetic and the one ' +
    'most clones get wrong by over-designing.',
  '',
  '### When the source uses native overlay text on photos',
  'Keep the cloned text SHORT and overlay-like (a phrase or one line per slide), not dense graphic ' +
    'copy. The source\'s own photos become the slide backgrounds (handled automatically), so write ' +
    'text that reads well laid over a photo.',
  '',
  'Slide counts: lean toward the SOURCE\'s actual slide count over any preset convention — fidelity ' +
    'beats convention.',
].join('\n');

// Strip wrappers from a pasted manual response — markdown fences,
// "Here's the JSON:" preambles, trailing commentary. Also normalizes
// smart quotes that iOS / mobile clients substitute into copied text,
// since JSON.parse silently rejects U+201C/U+201D (curly double
// quotes) and U+2018/U+2019 (curly single quotes when used as
// delimiters). Keeps the outermost {...} block.
function extractJsonObject(text: string): string {
  let t = text.trim();
  t = t.replace(/^```(?:json|javascript|js)?\s*/i, '').replace(/```\s*$/, '').trim();
  // Curly double quotes → ASCII straight double quotes. Required when
  // the user copied from a rich-text source (e.g. the Claude.ai chat
  // bubble on iOS) that auto-substituted them.
  t = t.replace(/[“”]/g, '"');
  // Curly single quotes → ASCII apostrophe. Apostrophes are valid
  // inside JSON strings without escaping, so this is safe even when
  // they appear in content like "they'll" / "what's".
  t = t.replace(/[‘’]/g, "'");
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first === -1 || last === -1 || last < first) return t;
  return t.slice(first, last + 1);
}

// Shared parser for paste-back JSON. Wraps JSON.parse with a more
// useful error message that calls out the most common iOS / mobile
// failure modes (smart quotes already normalized by extractJsonObject,
// truncated paste, prose still wrapped around the object).
function parseManualJson(responseText: string): unknown {
  const jsonText = extractJsonObject(responseText);
  try {
    return JSON.parse(jsonText);
  } catch (e) {
    const msg = (e as Error).message || '';
    const hint =
      jsonText.length < 50
        ? 'Looks like only a snippet got copied. Long-press in Claude.ai → Select All → Copy and try again.'
        : !jsonText.includes('"preset"')
          ? 'No "preset" key found — make sure you copied the entire JSON object Claude.ai returned, not just part of it.'
          : 'Sometimes iOS substitutes other Unicode characters (em dashes, ellipses) into copied text. Try copying again, or paste into a plain-text editor first to strip formatting.';
    throw new Error(`Couldn't parse as JSON: ${msg}\n\n${hint}`);
  }
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

// Anthropic only accepts a few image media types; default unknown to jpeg.
function mediaTypeFromBlob(blob: Blob): string {
  const t = (blob.type || '').toLowerCase();
  if (t === 'image/jpeg' || t === 'image/png' || t === 'image/webp' || t === 'image/gif') return t;
  return 'image/jpeg';
}

// Turn the already-downloaded source slides into base64 vision blocks so
// Claude can SEE the post it's cloning — the actual photos, the native
// on-screen text, the artifacts (book covers, app screenshots). Without
// this it was cloning blind from the caption + slide dimensions alone.
async function buildSourceImageBlocks(mediaItems: Array<MediaItem | null>): Promise<RequestContentBlock[]> {
  const blocks: RequestContentBlock[] = [];
  for (let i = 0; i < mediaItems.length; i++) {
    const item = mediaItems[i];
    if (!item) continue;
    try {
      const dataUrl = await blobToDataUrl(item.blob);
      const base64 = dataUrl.split(',')[1] || '';
      if (base64) {
        blocks.push({ type: 'text', text: `Source slide ${i + 1}:` });
        blocks.push({ type: 'image', source: { type: 'base64', media_type: mediaTypeFromBlob(item.blob), data: base64 } });
      }
    } catch {
      // Skip a slide we couldn't encode; the rest still inform the clone.
    }
  }
  return blocks;
}

export async function cloneFromTikTok(opts: CloneOptions): Promise<CloneResult> {
  const stage = opts.onStage || (() => {});

  stage({ kind: 'scraping' });
  const source = await scrapeTikTok(opts.url);
  stage({ kind: 'scraped', source });

  // Download the slide images FIRST so we can show them to Claude as vision
  // blocks (and reuse the same items as slide backgrounds afterward).
  const mediaItems = await fetchSourceImagesIntoLibrary(source, stage);
  const imageBlocks = await buildSourceImageBlocks(mediaItems);

  stage({ kind: 'reasoning' });
  const userContent: RequestContentBlock[] = [
    { type: 'text', text: buildUserMessage(source, opts) },
    ...imageBlocks,
  ];
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
    messages: [{ role: 'user', content: userContent }],
    tools: [EMIT_CLONE_TOOL],
    toolChoice: { type: 'tool', name: 'emit_clone' },
    maxTokens: 4096,
  });

  const clone = validateClone(extractToolUse<ClaudeCloneOutput>(response, 'emit_clone'));
  stage({ kind: 'analyzed', clone });

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
    '⚠️ IMPORTANT: attach screenshots of the source TikTok slides to this chat before sending, ' +
      'so I can match the visual style. (Take the screenshots, tap the + / paperclip in Claude.ai, ' +
      'add them, then send this prompt.) If you can\'t attach them, work from the caption below.',
    '',
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
    '(The slide screenshots the user attached to this chat ARE the source slides referenced above — ' +
      'study them and match their visual style, structure and voice.)',
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
  const clone = validateClone(parseManualJson(responseText));
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

// ---------- Phase 3 of the article: Propose from library ----------
//
// Reads the user's pattern library (every past post that carried a
// CloneAnalysis) + the last N days of published posts (anti-repeat),
// asks Claude to synthesise a fresh post that USES a proven pattern
// but doesn't repeat recent angles. Output is the same JSON-for-the-
// engine shape as cloning, minus bgAssignments (there's no source
// URL — the user picks bgs from their own library).

export type PatternSnapshot = {
  id: string;
  postedAt: number;
  preset: string;
  niche?: string;
  cloneAnalysis: CloneAnalysis;
  // Short caption excerpt for context, ≤200 chars.
  captionExcerpt: string;
};

export type RecentPostSnapshot = {
  daysAgo: number;
  niche?: string;
  preset: string;
  hookStyle: string;
  captionExcerpt: string;
};

export type ProposeInput = {
  patterns: PatternSnapshot[];
  recentPostings: RecentPostSnapshot[];
};

export type ClaudeProposeOutput = {
  preset: PresetKey;
  slides: Record<string, unknown>;
  caption: string;
  cloneAnalysis: CloneAnalysis;
  // One short image search query per rendered slide in render order
  // (hook → middle → cta). User feeds these into Pexels/Midjourney/
  // Nano Banana/wherever to source the actual bg images.
  imageQueries: string[];
  // Which library pattern (by id) inspired the angle. null when
  // proposing from scratch.
  inspirationPatternId: string | null;
  // One-sentence "why this angle + why now" so the user can sanity-
  // check before publishing.
  rationale: string;
};

export type ProposeStage =
  | { kind: 'reasoning' }
  | { kind: 'done'; proposal: ClaudeProposeOutput };

export type ProposeOptions = {
  apiKey: string;
  model: ClaudeModelId;
  input: ProposeInput;
  guidance?: string;
  preferredPreset?: PresetKey;
  onStage?: (stage: ProposeStage) => void;
};

const EMIT_PROPOSE_TOOL = {
  name: 'emit_propose',
  description:
    'Emit a fresh Iro slideshow proposal. Built from the pattern library, anti-repeated against recent posts.',
  input_schema: {
    type: 'object',
    required: ['preset', 'slides', 'caption', 'cloneAnalysis', 'imageQueries', 'rationale'],
    properties: {
      preset: { type: 'string', enum: PRESET_KEYS },
      slides: { type: 'object', additionalProperties: true, description: 'Preset-specific JSON, IRO spec exactly.' },
      caption: { type: 'string', description: 'TikTok caption. First line is the hook.' },
      cloneAnalysis: {
        type: 'object',
        required: ['structuralFingerprint', 'hookStyle', 'density', 'ctaShape', 'niche', 'voiceTone'],
        properties: {
          structuralFingerprint: { type: 'string' },
          hookStyle: { type: 'string' },
          density: { type: 'string' },
          ctaShape: { type: 'string' },
          niche: { type: 'string' },
          voiceTone: { type: 'string' },
        },
      },
      imageQueries: {
        type: 'array',
        items: { type: 'string' },
        description: 'One short image-search / generation prompt per RENDERED slide (hook → middle → cta).',
      },
      inspirationPatternId: {
        type: ['string', 'null'],
        description: 'The id of the past pattern this proposal riffs on, or null if from scratch.',
      },
      rationale: {
        type: 'string',
        description: 'One sentence: why this angle and why now.',
      },
    },
  },
};

const PROPOSE_INSTRUCTIONS = [
  '## Propose-from-library instructions',
  '',
  'You are being used inside the Iro Slideshow Generator\'s "Propose" flow. The user is ' +
    'NOT giving you a source URL — instead, you have their pattern library (everything ' +
    'they\'ve cloned or proposed in the past, with structural fingerprints) and a list of ' +
    'recently published posts.',
  '',
  'Your job:',
  '1. Pick a strong pattern from the library that the user has had success with.',
  '2. Synthesize a FRESH angle on Iro AI that uses that pattern\'s rhythm and density.',
  '3. Honor the anti-repeat rule: do NOT reuse a hook style, niche, or angle that has ' +
    'appeared in the last 14 days of recent posts.',
  '4. Prefer niches that haven\'t been touched in 30+ days when the library is dense.',
  '5. Always call the emit_propose tool.',
  '',
  'If the library is empty or sparse (<3 patterns), propose a clean post from scratch and ' +
    'set inspirationPatternId to null. The IRO spec above defines every preset\'s schema — ' +
    'follow it exactly.',
].join('\n');

function buildProposeUserMessage(
  input: ProposeInput,
  opts: { guidance?: string; preferredPreset?: PresetKey },
): string {
  const lines: string[] = [];
  lines.push('# Pattern library');
  if (input.patterns.length === 0) {
    lines.push('(empty — no past clones with structural analysis yet. Propose from scratch.)');
  } else {
    input.patterns.forEach((p) => {
      const days = Math.max(0, Math.floor((Date.now() - p.postedAt) / 86400000));
      lines.push(`- [${p.id}] ${days}d ago · preset=${p.preset} · niche=${p.niche || 'unknown'}`);
      lines.push(`  hook: ${p.cloneAnalysis.hookStyle}`);
      lines.push(`  density: ${p.cloneAnalysis.density}`);
      lines.push(`  cta: ${p.cloneAnalysis.ctaShape}`);
      lines.push(`  voice: ${p.cloneAnalysis.voiceTone}`);
      if (p.captionExcerpt) lines.push(`  caption: ${p.captionExcerpt}`);
    });
  }
  lines.push('');
  lines.push('# Last 14 days of published posts (avoid repeating)');
  if (input.recentPostings.length === 0) {
    lines.push('(none yet)');
  } else {
    input.recentPostings.forEach((r) => {
      lines.push(`- ${r.daysAgo}d ago · preset=${r.preset} · niche=${r.niche || 'unknown'} · hook=${r.hookStyle}`);
      if (r.captionExcerpt) lines.push(`  caption: ${r.captionExcerpt}`);
    });
  }
  lines.push('');
  lines.push('# Your task');
  lines.push(
    'Synthesize a fresh Iro AI slideshow proposal. Pick a strong pattern from the library ' +
      '(or propose from scratch if it\'s empty). Respect the anti-repeat rule against the ' +
      'last-14-day list above. Call emit_propose with the result.',
  );
  if (opts.preferredPreset) {
    lines.push('');
    lines.push(`Required preset: \`${opts.preferredPreset}\`. Follow that preset's schema exactly.`);
  }
  if (opts.guidance && opts.guidance.trim()) {
    lines.push('');
    lines.push('## Extra guidance from the user');
    lines.push(opts.guidance.trim());
  }
  return lines.join('\n');
}

export async function proposePost(opts: ProposeOptions): Promise<ClaudeProposeOutput> {
  const stage = opts.onStage || (() => {});
  stage({ kind: 'reasoning' });
  const response = await callClaude({
    apiKey: opts.apiKey,
    model: opts.model,
    system: [
      {
        type: 'text',
        text: ironSpec + '\n\n' + PROPOSE_INSTRUCTIONS,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: buildProposeUserMessage(opts.input, opts) }],
    tools: [EMIT_PROPOSE_TOOL],
    toolChoice: { type: 'tool', name: 'emit_propose' },
    maxTokens: 4096,
  });
  const proposal = validateProposal(extractToolUse<ClaudeProposeOutput>(response, 'emit_propose'));
  stage({ kind: 'done', proposal });
  return proposal;
}

function validateProposal(parsed: unknown): ClaudeProposeOutput {
  if (!parsed || typeof parsed !== 'object') throw new Error('Proposal response is not a JSON object.');
  const p = parsed as Partial<ClaudeProposeOutput>;
  if (!p.preset || !PRESET_KEYS.includes(p.preset as PresetKey)) {
    throw new Error(`Missing or unknown preset (got: ${String(p.preset)}).`);
  }
  if (!p.slides || typeof p.slides !== 'object') throw new Error('Missing "slides" object.');
  return {
    preset: p.preset as PresetKey,
    slides: p.slides as Record<string, unknown>,
    caption: typeof p.caption === 'string' ? p.caption : '',
    cloneAnalysis: (p.cloneAnalysis as CloneAnalysis) || {
      structuralFingerprint: '', hookStyle: '', density: '', ctaShape: '', niche: '', voiceTone: '',
    },
    imageQueries: Array.isArray(p.imageQueries) ? p.imageQueries.map(String) : [],
    inspirationPatternId: typeof p.inspirationPatternId === 'string' ? p.inspirationPatternId : null,
    rationale: typeof p.rationale === 'string' ? p.rationale : '',
  };
}

// Manual-mode propose: build the self-contained prompt for claude.ai.
// Parallel to buildManualPrompt for cloning.
export function buildManualProposePrompt(
  input: ProposeInput,
  opts: { guidance?: string; preferredPreset?: PresetKey },
): string {
  const skeleton = {
    preset: '<one of: ' + PRESET_KEYS.join(' | ') + '>',
    slides: '<preset-specific JSON — match the schema above EXACTLY>',
    caption: '<TikTok caption tailored to Iro. First line is the hook.>',
    cloneAnalysis: {
      structuralFingerprint: '<one sentence>',
      hookStyle: '<...>', density: '<...>', ctaShape: '<...>', niche: '<...>', voiceTone: '<...>',
    },
    imageQueries: '<array of short image search/generation prompts, one per rendered slide in render order>',
    inspirationPatternId: '<id of the past pattern this riffs on, or null>',
    rationale: '<one sentence: why this angle + why now>',
  };
  return [
    '# IRO SLIDESHOW SPEC', '', ironSpec, '',
    '# ' + PROPOSE_INSTRUCTIONS, '',
    '# YOUR INPUT', '',
    buildProposeUserMessage(input, opts), '',
    '# OUTPUT FORMAT', '',
    'Output ONLY a single JSON object matching the shape below. No commentary, no markdown fences.',
    '',
    '```json',
    JSON.stringify(skeleton, null, 2),
    '```',
  ].join('\n');
}

export function applyProposeManualResponse(responseText: string): ClaudeProposeOutput {
  return validateProposal(parseManualJson(responseText));
}
