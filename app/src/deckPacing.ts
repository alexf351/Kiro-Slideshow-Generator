// Deck-length pacing. The deck-balance analyzer flags one lopsided slide;
// this looks at the OTHER axis — the total number of slides. Carousel
// completion (how many viewers swipe to the end) is a strong TikTok ranking
// signal, and it falls off on very long decks while very short ones leave
// reach on the table. So we nudge toward the sweet spot without being
// preachy: only the genuine extremes get a tip.
//
// Pure (slide count in, verdict out), so it's deterministic and testable.

export type LengthTier = 'short' | 'ideal' | 'long';

export type LengthVerdict = {
  tier: LengthTier;
  tip: string | null; // null when the length is fine (no nag)
};

// `slideCount` includes the hook + CTA slides (the whole deck). Tuned to the
// rough TikTok-carousel sweet spot of ~3–11 slides.
export function deckLengthVerdict(slideCount: number): LengthVerdict {
  if (slideCount <= 0) return { tier: 'short', tip: null }; // nothing to judge yet
  if (slideCount < 3) {
    return { tier: 'short', tip: 'A bit short — 3+ slides is worth swiping, and 6–10 tends to hold attention best.' };
  }
  if (slideCount <= 11) {
    return { tier: 'ideal', tip: null };
  }
  if (slideCount <= 15) {
    return { tier: 'long', tip: `${slideCount} slides — completion tends to drop past ~10–12. Consider trimming a few.` };
  }
  return { tier: 'long', tip: `${slideCount} slides is a lot — strong risk viewers won’t reach the end. Aim for ~10.` };
}
