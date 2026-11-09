// Per-slide photo darkening carried in the deck JSON itself.
//
// Any slide object in a deck (hook, cta, or an item in a content array like
// prompts[]) can set its own `bg` photo URL and a `darken` value (0..0.85).
// The engine darkens a photo through SLIDES.bgAdjust, keyed by the photo's
// URL, which the app normally builds from the sidebar's Adjust panel. This
// adds an entry for every slide whose JSON asks for a darken, so a pasted
// deck renders with readable white text without touching the sidebar.
//
// A darken the creator set in the Adjust panel for the same photo wins, so
// the sidebar can still override the deck. Pure + tested.

export type BgAdjustEntry = { pos: string; zoom: number; ar?: number; darken?: number };

const MAX_DARKEN = 0.85;

function addOne(item: unknown, out: Record<string, BgAdjustEntry>) {
  if (!item || typeof item !== 'object') return;
  const it = item as { bg?: unknown; darken?: unknown };
  if (typeof it.bg !== 'string' || !it.bg) return;
  const d = Number(it.darken);
  if (!isFinite(d) || d <= 0) return;
  if (out[it.bg]) return; // the Adjust panel already set this photo
  out[it.bg] = { pos: '50% 50%', zoom: 1, darken: Math.min(MAX_DARKEN, d) };
}

export function applyDeckDarken(
  slides: Record<string, unknown>,
  arrayFields: string[],
  existing: Record<string, BgAdjustEntry>,
): Record<string, BgAdjustEntry> {
  const out: Record<string, BgAdjustEntry> = { ...existing };
  addOne(slides.hook, out);
  addOne(slides.cta, out);
  for (const field of arrayFields) {
    const arr = slides[field];
    if (Array.isArray(arr)) arr.forEach((item) => addOne(item, out));
  }
  return out;
}
