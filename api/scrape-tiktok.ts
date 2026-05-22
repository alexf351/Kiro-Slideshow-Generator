// Vercel serverless function: given a TikTok URL, returns structural data
// about the post (caption, author, per-slide image URLs for photo
// slideshows, video cover for videos). The browser can't fetch
// tiktok.com directly because of CORS, so the React app calls this
// endpoint and we proxy the request server-side with a desktop
// User-Agent.
//
// Response shape — see ScrapeResult below. Image URLs returned here are
// raw TikTok CDN URLs; the client should fetch them through
// /api/proxy-tiktok-image to avoid hotlink protection.

import type { VercelRequest, VercelResponse } from '@vercel/node';

type SourceSlide = {
  index: number;
  imageUrl: string;
  width?: number;
  height?: number;
};

type ScrapeResult = {
  url: string;
  kind: 'photo_slideshow' | 'video' | 'unknown';
  caption: string;
  hashtags: string[];
  author: {
    uniqueId: string;
    nickname: string;
  };
  slides: SourceSlide[];
  coverImage: string | null;
  durationSeconds: number | null;
  createdAt: number | null;
  rawTitle: string | null;
};

// Tested in the wild: an iOS Safari UA gets the page HTML with the
// embedded data blob intact. Desktop Chrome UAs sometimes get bot-
// challenged on slideshow URLs and return a stripped page.
const SCRAPE_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 ' +
    '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  'Accept':
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
};

const SHORTLINK_HOSTS = new Set(['vm.tiktok.com', 'vt.tiktok.com', 'm.tiktok.com']);

function isTikTokUrl(u: string): boolean {
  try {
    const parsed = new URL(u);
    return /(^|\.)tiktok\.com$/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

// vm.tiktok.com / vt.tiktok.com redirect to the canonical
// www.tiktok.com/@user/photo/123 (or /video/123) page; follow once.
async function resolveTikTokUrl(input: string): Promise<string> {
  const parsed = new URL(input);
  if (!SHORTLINK_HOSTS.has(parsed.hostname)) return input;

  const res = await fetch(input, {
    method: 'GET',
    redirect: 'follow',
    headers: SCRAPE_HEADERS,
  });
  return res.url || input;
}

// TikTok embeds page state inside a <script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"
// type="application/json">…</script>. Cheap regex extraction beats pulling in
// a full HTML parser for a function bundle. Falls back to the legacy
// SIGI_STATE blob for older / cached pages.
function extractEmbeddedJson(html: string): unknown | null {
  const universal = html.match(
    /<script[^>]+id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/,
  );
  if (universal && universal[1]) {
    try {
      return JSON.parse(universal[1]);
    } catch {}
  }
  const sigi = html.match(/<script[^>]+id="SIGI_STATE"[^>]*>([\s\S]*?)<\/script>/);
  if (sigi && sigi[1]) {
    try {
      return JSON.parse(sigi[1]);
    } catch {}
  }
  return null;
}

// Pull the itemStruct out of the rehydration JSON. The keypath has
// shifted across TikTok refactors; try the modern path first, then a
// couple of older fallbacks.
function findItemStruct(blob: unknown): Record<string, unknown> | null {
  if (!blob || typeof blob !== 'object') return null;
  const root = blob as Record<string, unknown>;

  const scope = root['__DEFAULT_SCOPE__'] as Record<string, unknown> | undefined;
  if (scope) {
    const detail = scope['webapp.video-detail'] as { itemInfo?: { itemStruct?: Record<string, unknown> } } | undefined;
    if (detail?.itemInfo?.itemStruct) return detail.itemInfo.itemStruct;
  }

  // Legacy SIGI_STATE shape: { ItemModule: { [id]: itemStruct } }
  const itemModule = root['ItemModule'] as Record<string, Record<string, unknown>> | undefined;
  if (itemModule) {
    const ids = Object.keys(itemModule);
    if (ids.length > 0) return itemModule[ids[0]];
  }

  return null;
}

function pickImageUrl(urlList: string[] | undefined): string | null {
  if (!urlList || urlList.length === 0) return null;
  // TikTok returns multiple CDN mirrors; the last is usually the
  // highest-quality WebP. Prefer it; fall back to the first.
  return urlList[urlList.length - 1] || urlList[0];
}

function parseHashtags(caption: string): string[] {
  const out: string[] = [];
  const re = /#([\p{L}0-9_]+)/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(caption)) !== null) {
    out.push(m[1]);
  }
  return out;
}

function buildResult(canonicalUrl: string, item: Record<string, unknown>): ScrapeResult {
  const caption = typeof item.desc === 'string' ? item.desc : '';
  const author = (item.author || {}) as Record<string, unknown>;
  const imagePost = item.imagePost as
    | { images?: Array<{ imageURL?: { urlList?: string[] }; imageWidth?: number; imageHeight?: number }> }
    | undefined;
  const video = item.video as { cover?: { urlList?: string[] }; duration?: number } | undefined;

  const slides: SourceSlide[] = [];
  let kind: ScrapeResult['kind'] = 'unknown';

  if (imagePost && Array.isArray(imagePost.images) && imagePost.images.length > 0) {
    kind = 'photo_slideshow';
    imagePost.images.forEach((img, i) => {
      const url = pickImageUrl(img?.imageURL?.urlList);
      if (url) {
        slides.push({
          index: i,
          imageUrl: url,
          width: img.imageWidth,
          height: img.imageHeight,
        });
      }
    });
  } else if (video) {
    kind = 'video';
  }

  return {
    url: canonicalUrl,
    kind,
    caption,
    hashtags: parseHashtags(caption),
    author: {
      uniqueId: typeof author.uniqueId === 'string' ? author.uniqueId : '',
      nickname: typeof author.nickname === 'string' ? author.nickname : '',
    },
    slides,
    coverImage: pickImageUrl(video?.cover?.urlList) || (slides[0]?.imageUrl ?? null),
    durationSeconds: typeof video?.duration === 'number' ? video.duration : null,
    createdAt: typeof item.createTime === 'string' || typeof item.createTime === 'number'
      ? Number(item.createTime) * 1000
      : null,
    rawTitle: caption.split('\n')[0] || null,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // Cache hits should be rare (each clone hits a different URL) but
  // still help when the user re-runs the same source while iterating.
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Use GET ?url=<tiktok url>' });
    return;
  }

  const rawUrl = (req.query.url || '').toString().trim();
  if (!rawUrl) {
    res.status(400).json({ error: 'Missing ?url=' });
    return;
  }
  if (!isTikTokUrl(rawUrl)) {
    res.status(400).json({ error: 'Only tiktok.com URLs are supported.' });
    return;
  }

  try {
    const canonicalUrl = await resolveTikTokUrl(rawUrl);
    const pageRes = await fetch(canonicalUrl, { headers: SCRAPE_HEADERS, redirect: 'follow' });
    if (!pageRes.ok) {
      res.status(502).json({
        error: `TikTok responded ${pageRes.status} for ${canonicalUrl}. The post may be private, deleted, or geo-restricted.`,
      });
      return;
    }
    const html = await pageRes.text();
    const blob = extractEmbeddedJson(html);
    if (!blob) {
      res.status(502).json({
        error:
          'Could not find the TikTok data blob in the page. TikTok may have changed their HTML or blocked our scraper.',
      });
      return;
    }
    const item = findItemStruct(blob);
    if (!item) {
      res.status(404).json({ error: 'No post data found at that URL.' });
      return;
    }
    const result = buildResult(canonicalUrl, item);
    res.status(200).json(result);
  } catch (e) {
    res.status(500).json({ error: `Scrape failed: ${(e as Error).message}` });
  }
}
