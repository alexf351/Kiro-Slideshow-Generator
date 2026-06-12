// Comment-bait detector. Comments are the single heaviest ranking signal on
// TikTok — a caption that invites a reply gets more of them, which gets more
// reach. The hook meter grades the opener and the hashtag linter grades the
// tags; this fills the third gap: does the caption actually ask the viewer to
// do something? It feeds a pre-publish check ("Caption invites a comment"),
// so it's a boolean with a short reason, not a score.
//
// Pure string analysis, no API. Deliberately conservative: it should fire on
// genuine prompts ("which would you pick?", "comment your go-to") and stay
// quiet on plain statements, so a green check actually means something.

// Phrases that explicitly ask for a reply / save / share / follow. Matched
// case-insensitively as substrings (these are multi-word enough not to
// false-positive). Lowercase, apostrophe-normalized before matching.
const CTA_PHRASES = [
  'comment', 'reply', 'let me know', 'tell me', 'tag a', 'tag someone',
  'tag your', 'which one', 'which would', 'which is', 'agree?', 'agree or',
  'thoughts?', 'what do you think', 'who else', 'drop a', 'drop your',
  'save this', 'save it', 'share this', 'send this to', 'follow for',
  'would you', 'do you', 'have you', 'what would you', "what's your",
  'your go-to', 'your favorite', 'your favourite', 'vote', 'am i wrong',
  'change my mind', 'hot take', 'unpopular opinion',
];

// Curiosity/opinion openers that, combined with a question mark, read as a
// genuine prompt rather than a rhetorical aside.
const QUESTION_WORDS = ['what', 'which', 'who', 'how', 'why', 'when', 'where', 'do', 'are', 'is', 'would', 'should', 'could', 'have', 'did'];

export type EngagementCheck = {
  invites: boolean;
  reason: string; // short, for a tooltip
};

function normalize(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[’‘]/g, "'") // curly → straight apostrophes
    .replace(/\s+/g, ' ')
    .trim();
}

// In-feed, TikTok collapses a caption after roughly the first line / ~140
// characters and shows a "…more" link; anything past that point is hidden
// until tapped. So the hook has to land BEFORE the fold. This returns the
// visible portion + whether it's truncated, for a literal preview. Pure.
const FOLD_CHARS = 140;
export function captionFold(caption: string): { visible: string; folded: boolean } {
  const text = caption || '';
  const nl = text.indexOf('\n');
  const lineCut = nl >= 0 ? nl : text.length;
  const cut = Math.min(lineCut, FOLD_CHARS);
  return { visible: text.slice(0, cut).trimEnd(), folded: text.length > cut };
}

// True when the caption contains a genuine prompt for the viewer to respond.
export function checkEngagement(caption: string): EngagementCheck {
  const norm = normalize(caption);
  if (!norm) return { invites: false, reason: 'Empty caption — add a question or “comment below”.' };

  // 1) An explicit CTA phrase.
  const phrase = CTA_PHRASES.find((p) => norm.includes(p));
  if (phrase) return { invites: true, reason: `Asks the viewer to respond (“${phrase}”).` };

  // 2) A real question: a '?' whose sentence starts with a question word.
  //    Splitting on sentence enders keeps "3 tips. ready?" working.
  if (norm.includes('?')) {
    const sentences = norm.split(/[.!?\n]+/).map((s) => s.trim()).filter(Boolean);
    const hasRealQuestion =
      // the caption literally has a '?' and at least one clause opens like a question
      sentences.some((s) => QUESTION_WORDS.includes(s.split(' ')[0])) ||
      // or it's short and ends in a question mark (a punchy direct ask)
      caption.trim().endsWith('?');
    if (hasRealQuestion) return { invites: true, reason: 'Ends on a question the viewer can answer.' };
  }

  return {
    invites: false,
    reason: 'No prompt to respond. Ask a question or add “comment your…” — comments drive reach.',
  };
}
