// Turn a slide's on-screen text into a short stock-photo search query. Used
// by the per-slide "auto background" action: instead of making the creator
// think up a search term, we pull the most evocative few words straight out
// of the slide. Pure (text in, query out) so it's deterministic + testable;
// the actual Openverse search + assignment happens in App with the existing
// tested stock-photo helpers.

const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'so', 'to', 'of', 'in', 'on',
  'for', 'with', 'at', 'by', 'from', 'as', 'is', 'are', 'was', 'were', 'be',
  'been', 'this', 'that', 'these', 'those', 'it', 'its', 'you', 'your', 'youre',
  'i', 'me', 'my', 'we', 'our', 'they', 'them', 'their', 'he', 'she', 'his',
  'her', 'how', 'why', 'what', 'when', 'where', 'who', 'which', 'do', 'does',
  'did', 'will', 'wont', 'can', 'cant', 'should', 'would', 'could', 'not',
  'no', 'yes', 'just', 'really', 'very', 'more', 'most', 'every', 'all', 'any',
  'some', 'about', 'into', 'than', 'then', 'now', 'here', 'there', 'out', 'up',
  // brand / app-store / UI filler that shouldn't drive an image search
  'iro', 'app', 'store', 'search', 'tiktok', 'pov', 'save', 'swipe', 'link',
  'bio', 'hook', 'cta', 'panel', 'feature', 'item', 'slide',
]);

// Strip the decorative bits the slide-meta labels carry ("Hook — ", "3. ",
// " · icon") so only the real slide text feeds the query.
export function cleanLabelForQuery(label: string): string {
  return (label || '')
    .replace(/^hook\s*[—-]\s*/i, '')
    .replace(/^(panel|feature)\s*\d+\s*[—-]\s*/i, '')
    .replace(/^\d+\.\s*/, '')
    .replace(/\s*·\s*(icon|logo|card)$/i, '')
    .replace(/…$/, '')
    .trim();
}

// Up to `max` of the most evocative words from `text`, returned as a
// space-joined query (or '' when nothing useful is left). "Evocative" is
// approximated by word length — longer words tend to be the concrete nouns
// that make a good photo search — while the chosen words keep their original
// order so the phrase still reads naturally.
export function extractStockQuery(text: string, max = 3): string {
  const plain = (text || '').replace(/<[^>]+>/g, ' ').toLowerCase();
  const tokens = plain.match(/[\p{L}][\p{L}0-9'']*/gu) || [];
  const seen = new Set<string>();
  const words: { w: string; i: number }[] = [];
  tokens.forEach((raw, i) => {
    const w = raw.replace(/['']/g, '');
    if (w.length < 3) return;
    if (STOP.has(w)) return;
    if (seen.has(w)) return;
    seen.add(w);
    words.push({ w, i });
  });
  if (words.length === 0) return '';
  const chosen = words
    .slice()
    .sort((a, b) => b.w.length - a.w.length) // most specific first
    .slice(0, max)
    .sort((a, b) => a.i - b.i)               // back to reading order
    .map((x) => x.w);
  return chosen.join(' ');
}
