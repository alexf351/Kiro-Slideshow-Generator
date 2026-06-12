// Deck pacing analyzer. A carousel reads best when the slides are evenly
// weighted — one wall-of-text slide in an otherwise punchy deck overflows the
// 1080×1920 frame and is where viewers bounce. Rather than guess an absolute
// "too long" threshold (which differs wildly by format), we measure each
// slide RELATIVE to the rest of the deck and flag a genuine outlier. That
// keeps it quiet for formats that are text-heavy by nature and only speaks
// up when one slide is lopsided against its own siblings.
//
// Pure: takes the parsed content items, returns a small report. No DOM.

// Field names whose values are NOT on-screen prose — backgrounds, asset
// URLs, colors, status flags. Counting these (a bg dataURL is enormous)
// would wreck the measurement, so they're excluded from the text tally.
const NON_TEXT_KEY = /^(bg|background|image|img|url|src|icon|color|accent|status|from|me|rank|pron)$/i;

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// Visible-text length of one content item: a string is itself; an object is
// the concatenation of its display string fields (one level deep). Returns
// the plain-text character count.
export function slideTextLength(item: unknown): number {
  if (item == null) return 0;
  if (typeof item === 'string') return stripHtml(item).length;
  if (typeof item !== 'object') return String(item).length;
  let text = '';
  for (const [key, val] of Object.entries(item as Record<string, unknown>)) {
    if (NON_TEXT_KEY.test(key)) continue;
    if (typeof val === 'string') text += ' ' + val;
    else if (Array.isArray(val)) text += ' ' + val.filter((v) => typeof v === 'string').join(' ');
  }
  return stripHtml(text).length;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export type DeckBalance = {
  counts: number[];          // text length per item, in order
  median: number;
  // Index of the single densest outlier (relative to the deck), or -1.
  densestIndex: number;
  balanced: boolean;         // true when there's no lopsided slide
  tip: string | null;        // human note when unbalanced, else null
};

// Thresholds: a slide must be both meaningfully bigger than the deck's median
// AND past a floor of real text before we call it dense — so a deck of short
// slides where one has a few extra words doesn't trip it.
const RATIO = 2.2;
const FLOOR = 140;        // chars
const MIN_SLIDES = 3;     // need a few slides to have a meaningful "rest of deck"

export function analyzeDeck(items: unknown[]): DeckBalance {
  const counts = items.map(slideTextLength);
  const med = median(counts);
  let densestIndex = -1;

  if (items.length >= MIN_SLIDES && med > 0) {
    let worst = 0;
    for (let i = 0; i < counts.length; i++) {
      if (counts[i] >= FLOOR && counts[i] > med * RATIO && counts[i] > worst) {
        worst = counts[i];
        densestIndex = i;
      }
    }
  }

  const balanced = densestIndex === -1;
  const tip = balanced
    ? null
    : `Slide ${densestIndex + 1} has ~${Math.round(counts[densestIndex] / Math.max(1, med))}× the text of your other slides — trim it so it doesn't overflow the frame.`;

  return { counts, median: med, densestIndex, balanced, tip };
}
