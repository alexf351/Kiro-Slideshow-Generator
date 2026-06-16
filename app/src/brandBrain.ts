// "Brand brain" — a creator profile (niche, audience, voice, product) set once
// and threaded into every AI generation so output is on-brand without
// re-typing context each time. Inspired by SlideSmith's per-project "Brain".
//
// Tiny text → localStorage. The prompt block is self-instructing so it can be
// prepended to any AI user message and take precedence over default framing.

export type BrandBrain = {
  niche: string;     // what the account is about
  audience: string;  // who it's for
  voice: string;     // tone / style
  product: string;   // what you promote + the CTA
  notes: string;     // freeform do/don't
};

export const EMPTY_BRAIN: BrandBrain = { niche: '', audience: '', voice: '', product: '', notes: '' };

const KEY = 'kiro_brand_brain';

export function loadBrain(): BrandBrain {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY_BRAIN };
    const v = JSON.parse(raw) as Partial<BrandBrain>;
    return { ...EMPTY_BRAIN, ...v };
  } catch {
    return { ...EMPTY_BRAIN };
  }
}

export function saveBrain(b: BrandBrain): void {
  try { localStorage.setItem(KEY, JSON.stringify(b)); } catch { /* quota — non-fatal */ }
}

export function brainHasContent(b: BrandBrain): boolean {
  return !!(b.niche || b.audience || b.voice || b.product || b.notes).trim();
}

// A prompt block to prepend to an AI user message. Empty string when nothing
// is set, so callers can `${brainPrompt(b)}${rest}` unconditionally.
export function brainPrompt(b: BrandBrain): string {
  const lines: string[] = [];
  if (b.niche.trim()) lines.push(`Niche: ${b.niche.trim()}`);
  if (b.audience.trim()) lines.push(`Audience: ${b.audience.trim()}`);
  if (b.voice.trim()) lines.push(`Voice & tone: ${b.voice.trim()}`);
  if (b.product.trim()) lines.push(`Promoting / CTA: ${b.product.trim()}`);
  if (b.notes.trim()) lines.push(`Notes: ${b.notes.trim()}`);
  if (lines.length === 0) return '';
  return (
    'BRAND CONTEXT — write everything to fit THIS creator. This takes ' +
    'precedence over any default brand/product framing in the instructions:\n' +
    lines.join('\n') +
    '\n\n'
  );
}
