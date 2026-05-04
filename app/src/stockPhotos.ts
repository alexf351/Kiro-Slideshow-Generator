// Provider-agnostic stock photo search. Both Pexels and Unsplash support
// browser CORS for the search endpoints and the CDN image URLs, so the
// whole flow runs client-side: search the API, fetch the chosen image's
// bytes, hand the blob to the media bank.
//
// API keys are BYOK and live in localStorage (see App.tsx Settings
// section). Free signup for either:
//   Pexels:   https://www.pexels.com/api/
//   Unsplash: https://unsplash.com/developers

export type StockProvider = 'pexels' | 'unsplash';

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

export class StockApiError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'StockApiError';
  }
}

const PEXELS_SEARCH = 'https://api.pexels.com/v1/search';
const UNSPLASH_SEARCH = 'https://api.unsplash.com/search/photos';

export async function searchStock(
  provider: StockProvider,
  query: string,
  apiKey: string,
  perPage = 24,
): Promise<StockPhoto[]> {
  if (!apiKey) throw new StockApiError(`Add a ${provider} API key in Settings first.`);
  const trimmed = query.trim();
  if (!trimmed) return [];

  if (provider === 'pexels') {
    const url = `${PEXELS_SEARCH}?query=${encodeURIComponent(trimmed)}&per_page=${perPage}&orientation=portrait`;
    const res = await fetch(url, { headers: { Authorization: apiKey } });
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
  const res = await fetch(url, { headers: { Authorization: `Client-ID ${apiKey}` } });
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

// Fetch the chosen image as a blob ready for IndexedDB. CDN URLs from
// both providers send CORS headers so this works browser-side.
export async function fetchStockBlob(photo: StockPhoto): Promise<Blob> {
  const res = await fetch(photo.fullUrl);
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
