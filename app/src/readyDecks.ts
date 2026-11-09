// Ready decks: finished posts committed to the repo's top-level decks/
// folder, listed in the sidebar so one tap loads a deck with every photo.
//
// Folder layout, one deck per slug:
//   decks/<slug>.json              the deck (same JSON as the editor box,
//                                  plus optional "title" and "caption")
//   decks/<slug>.cover.<jpg|png|webp>  optional cover photo, used as the hook
//                                  background when the hook has no bg
// A slide's "bg" may also point at a file in the folder ("./name.jpg").
//
// App.tsx gathers the files with Vite's import.meta.glob and hands the raw
// JSON text + bundled image URLs to buildReadyDecks. Pure + tested.

export type ReadyDeck = {
  slug: string;
  name: string;
  preset: string;
  platform: string;
  caption: string;
  json: string; // pretty JSON for the editor box, title/caption removed
  slideCount: number;
  photoCount: number;
  hasCover: boolean;
};

const IMAGE_EXT = /\.(jpe?g|png|webp)$/i;

function baseName(path: string): string {
  return path.split('/').pop() || path;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// Every slide-like object the engine gives a background: hook, cta, and the
// items of any array whose entries are objects.
function slideObjects(deck: Record<string, unknown>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  if (deck.hook && typeof deck.hook === 'object') out.push(deck.hook as Record<string, unknown>);
  for (const [k, v] of Object.entries(deck)) {
    if (k === 'hook' || k === 'cta' || !Array.isArray(v)) continue;
    for (const item of v) if (item && typeof item === 'object' && !Array.isArray(item)) out.push(item as Record<string, unknown>);
  }
  if (deck.cta && typeof deck.cta === 'object') out.push(deck.cta as Record<string, unknown>);
  return out;
}

export function buildReadyDecks(
  jsonFiles: Record<string, string>,
  imageFiles: Record<string, string>,
): ReadyDeck[] {
  // Bundled image URL by file name, e.g. "my-deck.cover.jpg" -> "/assets/...".
  const images: Record<string, string> = {};
  for (const [path, url] of Object.entries(imageFiles)) {
    if (IMAGE_EXT.test(path) && typeof url === 'string') images[baseName(path)] = url;
  }

  const decks: ReadyDeck[] = [];
  for (const [path, raw] of Object.entries(jsonFiles)) {
    const file = baseName(path);
    if (!file.endsWith('.json')) continue;
    const slug = file.slice(0, -'.json'.length);
    let deck: Record<string, unknown>;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      deck = parsed as Record<string, unknown>;
    } catch {
      continue; // a broken file shouldn't take the whole list down
    }

    const slides = slideObjects(deck);
    // Resolve "./file.jpg" backgrounds to their bundled URLs.
    for (const s of slides) {
      if (typeof s.bg === 'string' && s.bg.startsWith('./')) {
        const url = images[s.bg.slice(2)];
        if (url) s.bg = url; else delete s.bg;
      }
    }
    // The cover file fills the hook background unless the deck set one.
    const coverFile = Object.keys(images).find((n) => n.startsWith(`${slug}.cover.`));
    const hook = deck.hook && typeof deck.hook === 'object' ? (deck.hook as Record<string, unknown>) : null;
    if (coverFile && hook && !hook.bg) hook.bg = images[coverFile];

    const title = typeof deck.title === 'string' ? deck.title.trim() : '';
    const headline = hook && typeof hook.headline === 'string' ? stripTags(hook.headline) : '';
    const caption = typeof deck.caption === 'string' ? deck.caption : '';
    const editorDeck: Record<string, unknown> = { ...deck };
    delete editorDeck.title;
    delete editorDeck.caption;

    decks.push({
      slug,
      name: title || headline || slug,
      preset: typeof deck.preset === 'string' ? deck.preset : '',
      platform: typeof deck.platform === 'string' ? deck.platform : '',
      caption,
      json: JSON.stringify(editorDeck, null, 2),
      slideCount: slides.length,
      photoCount: slides.filter((s) => typeof s.bg === 'string' && s.bg).length,
      hasCover: !!(hook && typeof hook.bg === 'string' && hook.bg),
    });
  }
  // Dated slugs sort newest first.
  return decks.sort((a, b) => b.slug.localeCompare(a.slug));
}
