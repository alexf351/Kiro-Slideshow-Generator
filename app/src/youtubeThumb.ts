// YouTube thumbnail resolver for the skill_list ("10/10 skills") format.
//
// A deck only has to carry each tutorial's YouTube link; this turns the link
// into the sharpest thumbnail that exists (maxresdefault, then sddefault,
// then hqdefault, since older or low-res uploads have no maxres version) and
// returns it as a data URL. Data URLs are same-origin inside the engine
// iframe, so html2canvas can export the slide without CORS trouble.
//
// Each size is tried directly first (YouTube's image CDN usually allows it),
// then through /api/proxy-image (on Vercel). Results are cached per video so
// re-renders don't refetch. Returns null when nothing could be fetched; the
// engine then falls back to the plain hqdefault URL for the preview.

import { blobToDataUrl } from './mediaBank';

const SIZES = ['maxresdefault', 'sddefault', 'hqdefault'] as const;

// YouTube serves a 120x90 grey placeholder for sizes it doesn't have (with a
// 404, but be defensive in case a proxy turns that into a 200).
const MIN_BYTES = 2500;

const cache = new Map<string, Promise<string | null>>();

export function youTubeId(v: unknown): string {
  if (typeof v !== 'string') return '';
  const s = v.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  const m = s.match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/|\/live\/|\/v\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : '';
}

async function fetchImage(url: string): Promise<Blob | null> {
  const attempts = [url, `/api/proxy-image?url=${encodeURIComponent(url)}`];
  for (const target of attempts) {
    try {
      const res = await fetch(target, target === url ? { mode: 'cors' } : undefined);
      if (!res.ok) {
        // A 404 from YouTube itself means this size doesn't exist; the proxy
        // would only repeat it.
        if (target === url && res.status === 404) return null;
        continue;
      }
      const type = res.headers.get('content-type') || '';
      if (!type.startsWith('image/')) continue; // e.g. dev server SPA fallback
      const blob = await res.blob();
      if (blob.size < MIN_BYTES) return null;
      return blob;
    } catch {
      // CORS refusal or network error: try the next route.
    }
  }
  return null;
}

async function resolve(video: Record<string, unknown>): Promise<string | null> {
  const explicit = typeof video.thumbnail === 'string' ? video.thumbnail.trim() : '';
  if (explicit.startsWith('data:')) return explicit;
  if (explicit) {
    const b = await fetchImage(explicit);
    return b ? blobToDataUrl(b) : null;
  }
  const id = youTubeId(video.youtube) || youTubeId(video.url) || youTubeId(video.id);
  if (!id) return null;
  for (const size of SIZES) {
    const b = await fetchImage(`https://i.ytimg.com/vi/${id}/${size}.jpg`);
    if (b) return blobToDataUrl(b);
  }
  return null;
}

export function resolveYouTubeThumb(video: Record<string, unknown>): Promise<string | null> {
  const key = String(video.thumbnail || '') || `yt:${youTubeId(video.youtube) || youTubeId(video.url) || youTubeId(video.id)}`;
  if (key === 'yt:') return Promise.resolve(null);
  let p = cache.get(key);
  if (!p) {
    p = resolve(video).catch(() => null);
    cache.set(key, p);
    // Don't pin failures: a later render (e.g. once online) can retry.
    p.then((v) => { if (!v) cache.delete(key); });
  }
  return p;
}
