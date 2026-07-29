// App Store icon lookup. The app-list formats (app_stack, app_rating) need a
// real app icon per slide, and hunting one down by hand for every app is the
// slowest part of building those posts. This endpoint takes an app name and
// returns the official App Store artwork via Apple's public iTunes Search API
// (no key required), so the editor can fill icons in one click.
//
// Runs server-side because the iTunes endpoint sends no CORS headers.
// Returns the top few matches so the caller can disambiguate a generic name.

import type { VercelRequest, VercelResponse } from '@vercel/node';

const TIMEOUT_MS = 15000;
const MAX_RESULTS = 5;

type ItunesResult = {
  trackName?: string;
  sellerName?: string;
  artworkUrl512?: string;
  artworkUrl100?: string;
  trackViewUrl?: string;
  bundleId?: string;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Use GET.' }); return; }

  const raw = req.query.q;
  const term = (Array.isArray(raw) ? raw[0] : raw || '').trim();
  if (!term) { res.status(400).json({ error: 'Missing ?q=<app name>.' }); return; }
  if (term.length > 100) { res.status(400).json({ error: 'Query too long.' }); return; }

  // Optional country hint — App Store catalogs differ by storefront.
  const cRaw = req.query.country;
  const country = /^[a-zA-Z]{2}$/.test(String(cRaw || '')) ? String(cRaw).toLowerCase() : 'us';

  const url =
    'https://itunes.apple.com/search?media=software&entity=software' +
    `&limit=${MAX_RESULTS}&country=${country}&term=${encodeURIComponent(term)}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const upstream = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept: 'application/json' },
    });
    if (!upstream.ok) {
      res.status(502).json({ error: `App Store lookup failed (${upstream.status}).` });
      return;
    }
    const body = (await upstream.json()) as { results?: ItunesResult[] };
    const results = (body.results || [])
      .map((r) => ({
        name: r.trackName || '',
        seller: r.sellerName || '',
        // artworkUrl512 is the largest the search API returns; bump the path to
        // 1024 for a crisp full-bleed logo, falling back to whatever we got.
        icon: (r.artworkUrl512 || r.artworkUrl100 || '').replace(/\/512x512bb\./, '/1024x1024bb.'),
        url: r.trackViewUrl || '',
        bundleId: r.bundleId || '',
      }))
      .filter((r) => r.name && r.icon);

    // Apple's relevance ranking is decent but an exact name match should win.
    const lower = term.toLowerCase();
    results.sort((a, b) => {
      const ax = a.name.toLowerCase() === lower ? 0 : a.name.toLowerCase().startsWith(lower) ? 1 : 2;
      const bx = b.name.toLowerCase() === lower ? 0 : b.name.toLowerCase().startsWith(lower) ? 1 : 2;
      return ax - bx;
    });

    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
    res.status(200).json({ query: term, results });
  } catch (err) {
    const aborted = (err as Error)?.name === 'AbortError';
    res.status(aborted ? 504 : 500).json({
      error: aborted ? 'App Store lookup timed out.' : 'App Store lookup failed.',
    });
  } finally {
    clearTimeout(timer);
  }
}
