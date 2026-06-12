// Provider-agnostic stock photo search. Pexels and Unsplash support
// browser CORS for search + CDN, so they run fully client-side. Openverse
// (keyless, ~700M CC images) and Pixabay support CORS for search, but their
// image bytes come from many upstream hosts without CORS — so we pull those
// through /api/proxy-image before saving (html2canvas needs same-origin
// bytes to export the slide).
//
// API keys are BYOK and live in localStorage (see App.tsx Settings
// section). Free signup:
//   Pexels:   https://www.pexels.com/api/
//   Unsplash: https://unsplash.com/developers
//   Pixabay:  https://pixabay.com/api/docs/
//   Openverse: no key required.

export type StockProvider = 'openverse' | 'pexels' | 'unsplash' | 'pixabay';

// Providers whose image bytes aren't reliably CORS-enabled — fetch those
// through our proxy so the blob is same-origin for canvas export.
const PROXY_BLOB: Record<StockProvider, boolean> = {
  openverse: true,
  pixabay: true,
  pexels: false,
  unsplash: false,
};

// Normalised photo shape — flattens both providers' very different
// response schemas into one thing the UI cares about.
export type StockPhoto = {
  id: string;
  provider: StockProvider;
  thumbUrl: string;        // small image, for the search grid
  fullUrl: string;         // what we actually save to the library
  width: number;
  height: number;
  alt: string;
  photographer: string;
  photographerUrl: string;
  photoUrl: string;        // link back to the photo on the provider's site
  // Unsplash requires that we hit a per-photo `download_location` URL when
  // the user "uses" a photo so they can credit the photographer with a
  // download. Pexels has no equivalent; the field is undefined for it.
  downloadTrackUrl?: string;
};

// Fetch with a couple of retries on transient throttling/overload (429 / 5xx)
// and network blips — free stock tiers rate-limit easily.
async function fetchRetry(url: string, init?: RequestInit): Promise<Response> {
  const maxAttempts = 3;
  let last: Response | null = null;
  for (let a = 0; a < maxAttempts; a++) {
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (e) {
      if (a < maxAttempts - 1) { await new Promise((r) => setTimeout(r, 800 * (a + 1))); continue; }
      throw e;
    }
    if (res.ok) return res;
    if ((res.status === 429 || res.status >= 500) && a < maxAttempts - 1) {
      last = res;
      const ra = Number(res.headers.get('retry-after'));
      await new Promise((r) => setTimeout(r, isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 10000) : 800 * 2 ** a + Math.random() * 200));
      continue;
    }
    return res;
  }
  return last as Response;
}

export class StockApiError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'StockApiError';
  }
}

const PEXELS_SEARCH = 'https://api.pexels.com/v1/search';
const UNSPLASH_SEARCH = 'https://api.unsplash.com/search/photos';
const OPENVERSE_SEARCH = 'https://api.openverse.org/v1/images/';
const PIXABAY_SEARCH = 'https://pixabay.com/api/';

// Openverse needs no key; everyone else does.
export function providerNeedsKey(provider: StockProvider): boolean {
  return provider !== 'openverse';
}

export async function searchStock(
  provider: StockProvider,
  query: string,
  apiKey: string,
  perPage = 24,
): Promise<StockPhoto[]> {
  if (providerNeedsKey(provider) && !apiKey) {
    throw new StockApiError(`Add a ${provider} API key in Settings first.`);
  }
  const trimmed = query.trim();
  if (!trimmed) return [];

  if (provider === 'openverse') {
    // Keyless. aspect_ratio=tall biases toward portrait/9:16-friendly shots.
    const url = `${OPENVERSE_SEARCH}?q=${encodeURIComponent(trimmed)}&page_size=${perPage}&aspect_ratio=tall&mature=false`;
    const res = await fetchRetry(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      throw new StockApiError(`Openverse search failed (${res.status}). Try again in a moment.`, res.status);
    }
    const data = (await res.json()) as {
      results: Array<{
        id: string; title?: string; url: string; thumbnail?: string;
        width?: number; height?: number; creator?: string; creator_url?: string;
        foreign_landing_url?: string;
      }>;
    };
    return (data.results || []).map((p) => ({
      id: `openverse:${p.id}`,
      provider: 'openverse' as const,
      thumbUrl: p.thumbnail || p.url,
      fullUrl: p.url,
      width: p.width || 0,
      height: p.height || 0,
      alt: p.title || trimmed,
      photographer: p.creator || 'Unknown',
      photographerUrl: p.creator_url || '',
      photoUrl: p.foreign_landing_url || '',
    }));
  }

  if (provider === 'pixabay') {
    const url = `${PIXABAY_SEARCH}?key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(trimmed)}` +
      `&image_type=photo&orientation=vertical&per_page=${perPage}&safesearch=true`;
    const res = await fetchRetry(url);
    if (!res.ok) {
      throw new StockApiError(`Pixabay search failed (${res.status}). Check your API key.`, res.status);
    }
    const data = (await res.json()) as {
      hits: Array<{
        id: number; webformatURL: string; largeImageURL: string;
        imageWidth: number; imageHeight: number; tags: string;
        user: string; pageURL: string;
      }>;
    };
    return (data.hits || []).map((p) => ({
      id: `pixabay:${p.id}`,
      provider: 'pixabay' as const,
      thumbUrl: p.webformatURL,
      fullUrl: p.largeImageURL,
      width: p.imageWidth,
      height: p.imageHeight,
      alt: p.tags || trimmed,
      photographer: p.user,
      photographerUrl: `https://pixabay.com/users/${encodeURIComponent(p.user)}/`,
      photoUrl: p.pageURL,
    }));
  }

  if (provider === 'pexels') {
    const url = `${PEXELS_SEARCH}?query=${encodeURIComponent(trimmed)}&per_page=${perPage}&orientation=portrait`;
    const res = await fetchRetry(url, { headers: { Authorization: apiKey } });
    if (!res.ok) {
      throw new StockApiError(`Pexels search failed (${res.status}). Check your API key.`, res.status);
    }
    const data = (await res.json()) as {
      photos: Array<{
        id: number; width: number; height: number;
        url: string; alt?: string;
        photographer: string; photographer_url: string;
        src: { large2x: string; large: string; medium: string; small: string; tiny: string };
      }>;
    };
    return data.photos.map((p) => ({
      id: `pexels:${p.id}`,
      provider: 'pexels' as const,
      thumbUrl: p.src.medium,
      // large2x is ~1920w. Plenty for our 1080×1920 slides; smaller would
      // upscale fuzzy on the fullscreen photo presets.
      fullUrl: p.src.large2x,
      width: p.width,
      height: p.height,
      alt: p.alt || trimmed,
      photographer: p.photographer,
      photographerUrl: p.photographer_url,
      photoUrl: p.url,
    }));
  }

  // Unsplash
  const url = `${UNSPLASH_SEARCH}?query=${encodeURIComponent(trimmed)}&per_page=${perPage}&orientation=portrait`;
  const res = await fetchRetry(url, { headers: { Authorization: `Client-ID ${apiKey}` } });
  if (!res.ok) {
    throw new StockApiError(`Unsplash search failed (${res.status}). Check your API key.`, res.status);
  }
  const data = (await res.json()) as {
    results: Array<{
      id: string; width: number; height: number;
      alt_description?: string; description?: string;
      links: { html: string; download_location: string };
      urls: { full: string; regular: string; small: string; thumb: string };
      user: { name: string; links: { html: string } };
    }>;
  };
  return data.results.map((p) => ({
    id: `unsplash:${p.id}`,
    provider: 'unsplash' as const,
    thumbUrl: p.urls.small,
    fullUrl: p.urls.regular,
    width: p.width,
    height: p.height,
    alt: p.alt_description || p.description || trimmed,
    photographer: p.user.name,
    photographerUrl: p.user.links.html,
    photoUrl: p.links.html,
    downloadTrackUrl: p.links.download_location,
  }));
}

// Fetch the chosen image as a blob ready for IndexedDB. Pexels/Unsplash CDN
// URLs send CORS headers so we fetch them directly; Openverse/Pixabay images
// come from assorted hosts, so we route them through /api/proxy-image to get
// same-origin bytes that html2canvas can later draw to a canvas.
export async function fetchStockBlob(photo: StockPhoto): Promise<Blob> {
  const direct = !PROXY_BLOB[photo.provider];
  const target = direct ? photo.fullUrl : `/api/proxy-image?url=${encodeURIComponent(photo.fullUrl)}`;
  const res = await fetchRetry(target);
  if (!res.ok) throw new StockApiError(`Image download failed (${res.status})`, res.status);
  return await res.blob();
}

// Unsplash guideline: when a photo is "used" (downloaded / saved /
// embedded), GET the per-photo download_location URL with the same
// auth header. This credits the photographer's download count. Pexels
// has no equivalent and Pexels photos return early.
export async function trackStockDownload(photo: StockPhoto, apiKey: string): Promise<void> {
  if (photo.provider !== 'unsplash' || !photo.downloadTrackUrl || !apiKey) return;
  try {
    await fetch(photo.downloadTrackUrl, { headers: { Authorization: `Client-ID ${apiKey}` } });
  } catch {
    // Tracking is best-effort. Not blocking the UX if it 4xx/5xx's.
  }
}
