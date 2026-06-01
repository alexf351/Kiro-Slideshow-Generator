// The prediction engine: score a draft BEFORE it's published, and read
// the user's own published posts with vision so they can be scored and
// fed back as labeled context.
//
// "Learning" here is in-context, not a trained model: every prediction
// ships the user's scored history (content fingerprint → actual score)
// up to Claude, so the more posts they label, the sharper the guess. For
// a no-backend BYOK app this is the pragmatic shape of a learning loop —
// the labels live in IndexedDB, the model reads them fresh each call.
//
// Two LLM surfaces, both mirroring the Clone/Propose split:
//   - predictDraft / buildManualPredictPrompt — rate a draft 0-100
//   - analyzeOwnPost / buildManualSelfAnalysisPrompt — vision-read a self-post
//
// Each has an API path (one tap, BYOK key) and a manual path (free, via
// the user's claude.ai tab). Vision is API-only — claude.ai can't receive
// images through our copy-paste flow — so manual self-analysis falls back
// to caption + any on-screen text the user types in.

import { callClaude, extractToolUse, type ClaudeModelId, type RequestContentBlock } from './anthropic';
import { blobToDataUrl } from './mediaBank';
import { fetchProxiedImage, type ScrapeResult } from './tiktokClone';
import { PRESETS, type PresetKey } from './presets';

// ---------- Shared JSON parsing for manual paste-back ----------

// Strip markdown fences / prose / smart-quotes and keep the outer {...}.
// Same defensive shape tiktokClone uses for its paste-back flows.
function parseLooseJson(text: string): unknown {
  let t = text.trim();
  t = t.replace(/^```(?:json|javascript|js)?\s*/i, '').replace(/```\s*$/, '').trim();
  t = t.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  const slice = first !== -1 && last > first ? t.slice(first, last + 1) : t;
  try {
    return JSON.parse(slice);
  } catch (e) {
    throw new Error(
      `Couldn't parse Claude's reply as JSON: ${(e as Error).message}. ` +
        'Make sure you copied the entire JSON object, with no commentary around it.',
    );
  }
}

// ========================================================================
// Predict a draft's score
// ========================================================================

// One past post boiled down to "what it was" + "how it actually did".
// The predictor reads a list of these as its training context.
export type LabeledExample = {
  score: number;        // 0-100 actual computed performance score
  label: string;        // breakout / strong / solid / soft / flop
  preset: string;
  niche: string;
  hookStyle: string;
  voiceTone: string;
  density: string;
  captionExcerpt: string;
  views: number;
  saveRate: number;     // saves / views
  shareRate: number;    // shares / views
};

// The draft we want a number for. slidesJson is the raw editor JSON; we
// don't re-parse it preset-by-preset — Claude reads the structure itself.
export type PredictDraftInput = {
  preset: PresetKey;
  slidesJson: string;
  caption: string;
  // On-screen text per slide if known (e.g. carried from a clone). Helps
  // when the JSON uses HTML/markup the model would otherwise wade through.
  slideTexts?: string[];
};

export type PredictionResult = {
  predictedScore: number;
  confidence: 'low' | 'medium' | 'high';
  rationale: string;
  strengths: string[];
  risks: string[];
  suggestions: string[];
};

export type PredictOptions = {
  apiKey: string;
  model: ClaudeModelId;
  draft: PredictDraftInput;
  examples: LabeledExample[];
  guidance?: string;
};

const EMIT_PREDICTION_TOOL = {
  name: 'emit_prediction',
  description:
    'Emit a performance prediction for the draft slideshow, calibrated against the ' +
    'user\'s own labeled history.',
  input_schema: {
    type: 'object',
    required: ['predictedScore', 'confidence', 'rationale', 'strengths', 'risks', 'suggestions'],
    properties: {
      predictedScore: {
        type: 'integer',
        minimum: 0,
        maximum: 100,
        description:
          'Predicted performance score 0-100 on the SAME scale as the labeled examples ' +
          '(which blend reach percentile within this account + save/share/engagement quality).',
      },
      confidence: {
        type: 'string',
        enum: ['low', 'medium', 'high'],
        description: 'Lower when history is sparse or the draft is unlike anything labeled.',
      },
      rationale: { type: 'string', description: 'One paragraph: why this number, citing the closest examples.' },
      strengths: { type: 'array', items: { type: 'string' }, description: 'Concrete things that should help it perform.' },
      risks: { type: 'array', items: { type: 'string' }, description: 'Concrete things that might sink it.' },
      suggestions: {
        type: 'array',
        items: { type: 'string' },
        description: 'Specific, actionable pre-publish edits (hook rewrite, density, CTA, caption) to lift the score.',
      },
    },
  },
};

const PREDICT_SYSTEM = [
  'You are the prediction engine inside a TikTok slideshow studio. Your job is to forecast how a ',
  'DRAFT photo-carousel post will perform for ONE specific creator, then suggest edits to lift it.',
  '',
  'You are given the creator\'s own labeled history: past posts reduced to their structure (preset, ',
  'hook style, density, niche, voice) and the ACTUAL performance score each earned (0-100). The score ',
  'blends how the post\'s reach ranked within this account against absolute engagement quality — save ',
  'rate and share rate are the heaviest signals because TikTok rewards them with distribution.',
  '',
  'Predict on that SAME 0-100 scale. Anchor to the closest examples in the history rather than to ',
  'generic "good content" priors — what works for this account is what matters. When history is thin, ',
  'say so via low confidence and lean on save/share-driving fundamentals (curiosity-gap hook, tight ',
  'density, a reason to save). Be honest: most posts are average. Reserve 80+ for drafts that clearly ',
  'echo the account\'s breakouts.',
].join('\n');

function describeDraft(draft: PredictDraftInput): string {
  const lines: string[] = [];
  lines.push(`Preset: ${draft.preset} (${PRESETS[draft.preset]?.label || draft.preset})`);
  lines.push('');
  lines.push('## Caption');
  lines.push(draft.caption.trim() || '(no caption yet)');
  if (draft.slideTexts && draft.slideTexts.length > 0) {
    lines.push('');
    lines.push('## On-screen text, slide by slide');
    draft.slideTexts.forEach((t, i) => lines.push(`${i + 1}. ${t}`));
  }
  lines.push('');
  lines.push('## Raw slides JSON');
  lines.push('```json');
  lines.push(draft.slidesJson.trim());
  lines.push('```');
  return lines.join('\n');
}

function describeHistory(examples: LabeledExample[]): string {
  if (examples.length === 0) {
    return '(No labeled history yet — predict from fundamentals and set confidence to low.)';
  }
  const sorted = [...examples].sort((a, b) => b.score - a.score);
  return sorted
    .map(
      (e) =>
        `- score ${e.score} (${e.label}) · preset=${e.preset} · niche=${e.niche || '?'} · ` +
        `hook=${e.hookStyle || '?'} · density=${e.density || '?'} · voice=${e.voiceTone || '?'} · ` +
        `views=${e.views} saveRate=${(e.saveRate * 100).toFixed(1)}% shareRate=${(e.shareRate * 100).toFixed(1)}%` +
        (e.captionExcerpt ? `\n    caption: ${e.captionExcerpt}` : ''),
    )
    .join('\n');
}

function buildPredictUserMessage(opts: { draft: PredictDraftInput; examples: LabeledExample[]; guidance?: string }): string {
  const lines: string[] = [];
  lines.push('# This account\'s labeled history (actual scores)');
  lines.push(describeHistory(opts.examples));
  lines.push('');
  lines.push('# Draft to score');
  lines.push(describeDraft(opts.draft));
  if (opts.guidance && opts.guidance.trim()) {
    lines.push('');
    lines.push('# Extra context from the creator');
    lines.push(opts.guidance.trim());
  }
  lines.push('');
  lines.push('Call emit_prediction with your forecast. No text outside the tool call.');
  return lines.join('\n');
}

function validatePrediction(parsed: unknown): PredictionResult {
  if (!parsed || typeof parsed !== 'object') throw new Error('Prediction response is not a JSON object.');
  const p = parsed as Partial<PredictionResult> & { predictedScore?: unknown };
  const raw = Number(p.predictedScore);
  const score = Number.isFinite(raw) ? Math.max(0, Math.min(100, Math.round(raw))) : 0;
  const conf = p.confidence === 'high' || p.confidence === 'low' ? p.confidence : 'medium';
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
  return {
    predictedScore: score,
    confidence: conf,
    rationale: typeof p.rationale === 'string' ? p.rationale : '',
    strengths: arr(p.strengths),
    risks: arr(p.risks),
    suggestions: arr(p.suggestions),
  };
}

export async function predictDraft(opts: PredictOptions): Promise<PredictionResult> {
  const response = await callClaude({
    apiKey: opts.apiKey,
    model: opts.model,
    system: [{ type: 'text', text: PREDICT_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [
      {
        role: 'user',
        content: buildPredictUserMessage({ draft: opts.draft, examples: opts.examples, guidance: opts.guidance }),
      },
    ],
    tools: [EMIT_PREDICTION_TOOL],
    toolChoice: { type: 'tool', name: 'emit_prediction' },
    maxTokens: 1500,
  });
  return validatePrediction(extractToolUse<PredictionResult>(response, 'emit_prediction'));
}

const PREDICT_OUTPUT_SKELETON = {
  predictedScore: '<integer 0-100, same scale as the example scores>',
  confidence: '<low | medium | high>',
  rationale: '<one paragraph citing the closest examples>',
  strengths: ['<what should help>'],
  risks: ['<what might sink it>'],
  suggestions: ['<specific pre-publish edit>'],
};

export function buildManualPredictPrompt(opts: { draft: PredictDraftInput; examples: LabeledExample[]; guidance?: string }): string {
  return [
    '# ROLE',
    PREDICT_SYSTEM,
    '',
    '# INPUT',
    buildPredictUserMessage(opts),
    '',
    '# OUTPUT FORMAT',
    'Output ONLY a single JSON object matching the shape below. No commentary, no markdown fences.',
    '',
    '```json',
    JSON.stringify(PREDICT_OUTPUT_SKELETON, null, 2),
    '```',
  ].join('\n');
}

export function applyPredictManualResponse(text: string): PredictionResult {
  return validatePrediction(parseLooseJson(text));
}

// ========================================================================
// Vision: read the user's own published post
// ========================================================================

export type SelfAnalysisResult = {
  slideTexts: string[];
  hookText: string;
  hookStyle: string;
  niche: string;
  voiceTone: string;
  contentSummary: string;
};

export type AnalyzeOwnPostOptions = {
  apiKey: string;
  model: ClaudeModelId;
  source: ScrapeResult;
  onProgress?: (done: number, total: number) => void;
};

const EMIT_SELF_ANALYSIS_TOOL = {
  name: 'emit_self_analysis',
  description: 'Emit the structural read of the creator\'s own post, including the text read off each slide.',
  input_schema: {
    type: 'object',
    required: ['slideTexts', 'hookText', 'hookStyle', 'niche', 'voiceTone', 'contentSummary'],
    properties: {
      slideTexts: {
        type: 'array',
        items: { type: 'string' },
        description: 'The on-screen text transcribed from each slide image, in order. One entry per slide.',
      },
      hookText: { type: 'string', description: 'The opening hook text (slide 1).' },
      hookStyle: { type: 'string', description: 'question / stat / confession / POV / list teaser / ...' },
      niche: { type: 'string', description: 'Topic niche (e.g. "productivity / AI tools").' },
      voiceTone: { type: 'string', description: 'lowercase confessional / all-caps / deadpan / ...' },
      contentSummary: { type: 'string', description: 'One paragraph: what the post is and why it might land or flop.' },
    },
  },
};

const SELF_ANALYSIS_SYSTEM = [
  'You read a creator\'s own TikTok photo-carousel and extract its structure. Transcribe the on-screen ',
  'text off each slide exactly, identify the hook style, niche, and voice, and summarize what the post is ',
  'and why it might perform. Be precise with the transcription — that text is reused downstream to predict ',
  'how similar future posts will do.',
].join('\n');

function mediaTypeFromBlob(blob: Blob): string {
  const t = (blob.type || '').toLowerCase();
  if (t === 'image/jpeg' || t === 'image/png' || t === 'image/webp' || t === 'image/gif') return t;
  return 'image/jpeg';
}

// Fetch each slide image through the CORS proxy and turn it into a
// base64 image block. Failures are skipped (the slide just won't be
// transcribed) rather than aborting the whole read.
async function buildImageBlocks(
  source: ScrapeResult,
  onProgress?: (done: number, total: number) => void,
): Promise<RequestContentBlock[]> {
  const blocks: RequestContentBlock[] = [];
  let done = 0;
  const total = source.slides.length;
  onProgress?.(done, total);
  for (const slide of source.slides) {
    try {
      const blob = await fetchProxiedImage(slide.imageUrl);
      const dataUrl = await blobToDataUrl(blob);
      const base64 = dataUrl.split(',')[1] || '';
      if (base64) {
        blocks.push({ type: 'text', text: `Slide ${slide.index + 1}:` });
        blocks.push({ type: 'image', source: { type: 'base64', media_type: mediaTypeFromBlob(blob), data: base64 } });
      }
    } catch {
      // Single-image failure shouldn't abort the read.
    } finally {
      done++;
      onProgress?.(done, total);
    }
  }
  return blocks;
}

function selfAnalysisTaskText(source: ScrapeResult): string {
  return [
    '# Source post (the creator\'s OWN published post)',
    `Author: @${source.author.uniqueId}`,
    '',
    '## Caption',
    source.caption || '(no caption)',
    '',
    `The ${source.slides.length} slide image${source.slides.length === 1 ? '' : 's'} are attached above, in order. ` +
      'Transcribe the on-screen text off each one and call emit_self_analysis. No text outside the tool call.',
  ].join('\n');
}

function validateSelfAnalysis(parsed: unknown): SelfAnalysisResult {
  if (!parsed || typeof parsed !== 'object') throw new Error('Self-analysis response is not a JSON object.');
  const p = parsed as Partial<SelfAnalysisResult>;
  return {
    slideTexts: Array.isArray(p.slideTexts) ? p.slideTexts.map(String) : [],
    hookText: typeof p.hookText === 'string' ? p.hookText : '',
    hookStyle: typeof p.hookStyle === 'string' ? p.hookStyle : '',
    niche: typeof p.niche === 'string' ? p.niche : '',
    voiceTone: typeof p.voiceTone === 'string' ? p.voiceTone : '',
    contentSummary: typeof p.contentSummary === 'string' ? p.contentSummary : '',
  };
}

export async function analyzeOwnPost(opts: AnalyzeOwnPostOptions): Promise<SelfAnalysisResult> {
  const imageBlocks = await buildImageBlocks(opts.source, opts.onProgress);
  const content: RequestContentBlock[] = [
    { type: 'text', text: selfAnalysisTaskText(opts.source) },
    ...imageBlocks,
  ];
  const response = await callClaude({
    apiKey: opts.apiKey,
    model: opts.model,
    system: [{ type: 'text', text: SELF_ANALYSIS_SYSTEM }],
    messages: [{ role: 'user', content }],
    tools: [EMIT_SELF_ANALYSIS_TOOL],
    toolChoice: { type: 'tool', name: 'emit_self_analysis' },
    maxTokens: 1500,
  });
  return validateSelfAnalysis(extractToolUse<SelfAnalysisResult>(response, 'emit_self_analysis'));
}

const SELF_ANALYSIS_SKELETON = {
  slideTexts: ['<text on slide 1>', '<text on slide 2>'],
  hookText: '<slide 1 hook>',
  hookStyle: '<question | stat | confession | POV | ...>',
  niche: '<topic niche>',
  voiceTone: '<voice register>',
  contentSummary: '<one paragraph>',
};

// Manual path can't send images, so the creator pastes the on-screen text
// of each slide (one per line) and Claude.ai works from that + the caption.
export function buildManualSelfAnalysisPrompt(source: ScrapeResult, typedSlideTexts: string[]): string {
  const slideBlock =
    typedSlideTexts.filter((t) => t.trim()).length > 0
      ? typedSlideTexts.map((t, i) => `Slide ${i + 1}: ${t}`).join('\n')
      : '(The creator did not type the slide text. Infer structure from the caption alone and leave slideTexts as an empty array.)';
  return [
    '# ROLE',
    SELF_ANALYSIS_SYSTEM,
    '',
    '# SOURCE POST (the creator\'s own)',
    `Author: @${source.author.uniqueId}`,
    '',
    '## Caption',
    source.caption || '(no caption)',
    '',
    '## On-screen text the creator typed in, per slide',
    slideBlock,
    '',
    '# OUTPUT FORMAT',
    'Output ONLY a single JSON object matching the shape below. No commentary, no markdown fences.',
    '',
    '```json',
    JSON.stringify(SELF_ANALYSIS_SKELETON, null, 2),
    '```',
  ].join('\n');
}

export function applySelfAnalysisManualResponse(text: string): SelfAnalysisResult {
  return validateSelfAnalysis(parseLooseJson(text));
}
