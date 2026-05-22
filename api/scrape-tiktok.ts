// Vercel serverless function: given a TikTok URL, returns structural data
// about the post (caption, author, per-slide image URLs for photo
// slideshows, video cover for videos). The browser can't fetch
// tiktok.com directly because of CORS, so the React app calls this
// endpoint and we proxy the request server-side.
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

// We try desktop Chrome first because it gets the full SSR'd page
// (including the data blob). Mobile UAs often get served the
// "tap to open in app" interstitial which has little data. iOS Safari
// stays as a fallback for the rare cases when desktop hits a bot
// challenge.
const UA_DESKTOP =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const UA_MOBILE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

function headersFor(ua: string): Record<string, string> {
  return {
    'User-Agent': ua,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    // TikTok's SSR sniffs this — without it desktop UAs sometimes get
    // a stripped page.
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Upgrade-Insecure-Requests': '1',
  };
}

// Hosts and path prefixes that 302 to the canonical /@user/photo/123
// URL. We follow them explicitly so the rest of the pipeline always
// sees a real post URL.
const SHORTLINK_HOSTS = new Set(['vm.tiktok.com', 'vt.tiktok.com', 'm.tiktok.com']);

function isTikTokUrl(u: string): boolean {
  try {
    const parsed = new URL(u);
    return /(^|\.)tiktok\.com$/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

function looksLikeShortlink(parsedUrl: URL): boolean {
  if (SHORTLINK_HOSTS.has(parsedUrl.hostname)) return true;
  // www.tiktok.com/t/<code>/ is the modern share-link format. Same
  // 302 behaviour as vm.tiktok.com.
  if (/^\/t\/[A-Za-z0-9]+\/?$/.test(parsedUrl.pathname)) return true;
  return false;
}

async function resolveTikTokUrl(input: string, ua: string): Promise<string> {
  const parsed = new URL(input);
  if (!looksLikeShortlink(parsed)) return input;
  const res = await fetch(input, {
    method: 'GET',
    redirect: 'follow',
    headers: headersFor(ua),
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

// All scope keys TikTok has used for "this is the post page" data
// across recent refactors. We probe each in order — first hit wins.
const DETAIL_SCOPE_KEYS = [
  'webapp.video-detail',
  'webapp.image-detail',
  'webapp.image-post-detail',
  'webapp.photo-detail',
  'webapp.post-detail',
];

function findItemStruct(blob: unknown): Record<string, unknown> | null {
  if (!blob || typeof blob !== 'object') return null;
  const root = blob as Record<string, unknown>;

  const scope = root['__DEFAULT_SCOPE__'] as Record<string, unknown> | undefined;
  if (scope) {
    for (const key of DETAIL_SCOPE_KEYS) {
      const detail = scope[key] as { itemInfo?: { itemStruct?: Record<string, unknown> } } | undefined;
      if (detail?.itemInfo?.itemStruct) return detail.itemInfo.itemStruct;
    }
  }

  // Legacy SIGI_STATE shape: { ItemModule: { [id]: itemStruct } }
  const itemModule = root['ItemModule'] as Record<string, Record<string, unknown>> | undefined;
  if (itemModule) {
    const ids = Object.keys(itemModule);
    if (ids.length > 0) return itemModule[ids[0]];
  }

  return null;
}

// When the scrape fails, returning what we DID find helps debug
// without needing to fork the function. Surfaces the top-level
// __DEFAULT_SCOPE__ keys so we can see if TikTok renamed something.
function diagnoseBlob(blob: unknown): { scopeKeys: string[]; topKeys: string[] } {
  if (!blob || typeof blob !== 'object') return { scopeKeys: [], topKeys: [] };
  const root = blob as Record<string, unknown>;
  const scope = root['__DEFAULT_SCOPE__'];
  const scopeKeys =
    scope && typeof scope === 'object' ? Object.keys(scope as Record<string, unknown>) : [];
  return { scopeKeys, topKeys: Object.keys(root) };
}

function pickImageUrl(urlList: string[] | undefined): string | null {
  if (!urlList || urlList.length === 0) return null;
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

type FetchAttempt = {
  ua: string;
  uaLabel: string;
  status: number;
  hasBlob: boolean;
  scopeKeys: string[];
  item: Record<string, unknown> | null;
  canonicalUrl: string;
};

// Fetch + parse with one UA. Doesn't throw — returns enough info that
// the caller can decide whether to fall back to the other UA.
async function attemptFetch(rawUrl: string, ua: string, uaLabel: string): Promise<FetchAttempt> {
  const canonicalUrl = await resolveTikTokUrl(rawUrl, ua).catch(() => rawUrl);
  const pageRes = await fetch(canonicalUrl, { headers: headersFor(ua), redirect: 'follow' });
  if (!pageRes.ok) {
    return { ua, uaLabel, status: pageRes.status, hasBlob: false, scopeKeys: [], item: null, canonicalUrl };
  }
  const html = await pageRes.text();
  const blob = extractEmbeddedJson(html);
  if (!blob) {
    return { ua, uaLabel, status: pageRes.status, hasBlob: false, scopeKeys: [], item: null, canonicalUrl };
  }
  const diag = diagnoseBlob(blob);
  const item = findItemStruct(blob);
  return { ua, uaLabel, status: pageRes.status, hasBlob: true, scopeKeys: diag.scopeKeys, item, canonicalUrl };
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
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
    // Try desktop first (full SSR), fall back to mobile if desktop
    // got blocked or returned a stripped page.
    const attempts: FetchAttempt[] = [];
    for (const [ua, label] of [
      [UA_DESKTOP, 'desktop-chrome'] as const,
      [UA_MOBILE, 'ios-safari'] as const,
    ]) {
      const attempt = await attemptFetch(rawUrl, ua, label);
      attempts.push(attempt);
      if (attempt.item) {
        res.status(200).json(buildResult(attempt.canonicalUrl, attempt.item));
        return;
      }
    }

    // Both attempts failed. Surface the diagnostic so we can iterate.
    const last = attempts[attempts.length - 1];
    res.status(404).json({
      error:
        last.status >= 400
          ? `TikTok responded ${last.status} on both desktop + mobile UAs. The post may be private, deleted, age-restricted, or geo-blocked.`
          : last.hasBlob
            ? 'The TikTok page loaded but didn\'t contain a recognizable post object. The URL might point to a profile, hashtag, or live page instead of a single post.'
            : 'TikTok returned a page without an embedded data blob — likely a "tap to open in app" interstitial or a bot challenge. Try a canonical /@user/photo/<id> or /@user/video/<id> URL.',
      diagnostics: attempts.map((a) => ({
        ua: a.uaLabel,
        status: a.status,
        hasBlob: a.hasBlob,
        scopeKeys: a.scopeKeys,
        resolvedTo: a.canonicalUrl,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: `Scrape failed: ${(e as Error).message}` });
  }
}
