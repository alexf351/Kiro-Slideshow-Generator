import { useState } from 'react';
import {
  fetchStockBlob,
  providerNeedsKey,
  searchStock,
  StockApiError,
  trackStockDownload,
  type StockPhoto,
  type StockProvider,
} from './stockPhotos';
import { addStockItem } from './mediaBank';

type Props = {
  // Keys live in the App-level Settings panel and are passed in here so the
  // search component is stateless about credentials. Openverse needs none.
  pexelsKey: string;
  unsplashKey: string;
  pixabayKey: string;
  // Fired after we've imported a photo; lets the parent Library refresh
  // its grid without re-querying IDB on its own.
  onImported: () => void;
};

const PROVIDER_LABEL: Record<StockProvider, string> = {
  openverse: 'Openverse',
  pexels: 'Pexels',
  unsplash: 'Unsplash',
  pixabay: 'Pixabay',
};

const PROVIDER_NOTE: Record<StockProvider, string> = {
  openverse: 'keyless · ~700M CC images',
  pexels: 'free · no attribution',
  unsplash: 'free · credit appreciated',
  pixabay: 'free · no attribution',
};

const PROVIDER_ORDER: StockProvider[] = ['openverse', 'pexels', 'unsplash', 'pixabay'];

export default function StockSearch({ pexelsKey, unsplashKey, pixabayKey, onImported }: Props) {
  const [provider, setProvider] = useState<StockProvider>('openverse');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StockPhoto[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Photos currently being saved to the library — used to grey out the
  // tile + show a check after.
  const [importing, setImporting] = useState<Set<string>>(new Set());
  const [imported, setImported] = useState<Set<string>>(new Set());

  const activeKey = provider === 'pexels' ? pexelsKey : provider === 'unsplash' ? unsplashKey : provider === 'pixabay' ? pixabayKey : '';
  const keyMissing = providerNeedsKey(provider) && !activeKey;

  async function handleSearch() {
    if (!query.trim()) return;
    if (keyMissing) {
      setError(`Add a ${PROVIDER_LABEL[provider]} API key in Settings (sidebar) before searching.`);
      return;
    }
    setSearching(true);
    setError(null);
    try {
      const photos = await searchStock(provider, query, activeKey);
      setResults(photos);
      if (photos.length === 0) setError('No matches. Try a different phrase.');
    } catch (e) {
      const msg = e instanceof StockApiError ? e.message : (e as Error).message || 'Search failed.';
      setError(msg);
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  async function handleImport(photo: StockPhoto) {
    if (importing.has(photo.id) || imported.has(photo.id)) return;
    setImporting((prev) => new Set(prev).add(photo.id));
    try {
      const blob = await fetchStockBlob(photo);
      await addStockItem({
        blob,
        mimeType: blob.type || 'image/jpeg',
        name: `${photo.provider}-${photo.alt.slice(0, 40).replace(/\s+/g, '-') || photo.id}`,
        source: {
          provider: photo.provider,
          photographer: photo.photographer,
          photographerUrl: photo.photographerUrl,
          photoUrl: photo.photoUrl,
        },
      });
      // Unsplash: ping their download tracking endpoint per the API
      // guidelines. Best-effort, doesn't block the UX.
      void trackStockDownload(photo, activeKey);
      setImported((prev) => new Set(prev).add(photo.id));
      onImported();
    } catch (e) {
      const msg = e instanceof StockApiError ? e.message : (e as Error).message || 'Import failed.';
      setError(msg);
    } finally {
      setImporting((prev) => {
        const next = new Set(prev);
        next.delete(photo.id);
        return next;
      });
    }
  }

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 px-5 md:px-8 pt-4 pb-3 border-b border-white/[0.06]">
        <div className="flex items-center gap-2 mb-3">
          {PROVIDER_ORDER.map((p) => {
            const active = provider === p;
            return (
              <button
                key={p}
                type="button"
                onClick={() => setProvider(p)}
                className={
                  'px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-[0.14em] transition-colors ' +
                  (active
                    ? 'bg-[#00E5FF] text-[#0a0e1a]'
                    : 'bg-white/[0.04] text-gray-400 hover:bg-white/[0.08] hover:text-gray-200')
                }
              >
                {PROVIDER_LABEL[p]}
              </button>
            );
          })}
          <span className="ml-auto text-[10px] uppercase tracking-[0.14em] text-gray-600">
            {PROVIDER_NOTE[provider]}
          </span>
        </div>
        <div className="flex gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSearch();
            }}
            placeholder={`Search ${PROVIDER_LABEL[provider]}…  (e.g. "moody bedroom")`}
            className="flex-1 bg-[#070b18] border border-white/[0.10] rounded-lg px-3 py-2.5 text-sm text-gray-200 placeholder:text-gray-600 focus:border-[#00E5FF]/50 focus:outline-none"
          />
          <button
            type="button"
            onClick={handleSearch}
            disabled={searching || !query.trim()}
            className="px-4 py-2.5 rounded-lg text-sm font-bold tracking-wide bg-gradient-to-r from-[#00E5FF] to-[#00A5D9] text-[#0a0e1a] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {searching ? '…' : 'Search'}
          </button>
        </div>
        {keyMissing && (
          <div className="mt-2 text-xs text-amber-300/90">
            No {PROVIDER_LABEL[provider]} API key set. Add it under <strong>Settings</strong> in the sidebar.
          </div>
        )}
        {error && !keyMissing && <div className="mt-2 text-xs text-red-400">{error}</div>}
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 md:p-6">
        {results.length === 0 && !searching && !error && (
          <div className="text-center text-gray-500 text-xs mt-12 leading-relaxed px-6">
            Search for portrait photos to drop into your media bank.<br />
            <strong className="text-gray-400">Openverse</strong> needs no API key — just search. All providers bias toward vertical / 9:16 results so they fit slide backgrounds.
          </div>
        )}
        {results.length > 0 && (
          <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 md:gap-3">
            {results.map((photo) => {
              const isImporting = importing.has(photo.id);
              const isImported = imported.has(photo.id);
              return (
                <button
                  key={photo.id}
                  type="button"
                  onClick={() => handleImport(photo)}
                  disabled={isImporting || isImported}
                  className={
                    'relative aspect-[9/16] rounded-lg overflow-hidden border transition-all ' +
                    (isImported
                      ? 'border-[#00E5FF] shadow-[0_0_0_2px_rgba(0,229,255,0.4)]'
                      : 'border-white/10 hover:border-white/40 disabled:opacity-60')
                  }
                  title={`${photo.alt} — ${photo.photographer}`}
                >
                  <img
                    src={photo.thumbUrl}
                    alt={photo.alt}
                    className="w-full h-full object-cover"
                    loading="lazy"
                    decoding="async"
                  />
                  {(isImporting || isImported) && (
                    <div className="absolute inset-0 bg-[#0a0e1a]/60 flex items-center justify-center">
                      <span className={
                        'w-9 h-9 rounded-full flex items-center justify-center text-sm font-black ' +
                        (isImported ? 'bg-[#00E5FF] text-[#0a0e1a]' : 'bg-white/20 text-white animate-pulse')
                      }>
                        {isImported ? '✓' : '…'}
                      </span>
                    </div>
                  )}
                  <div className="absolute bottom-0 left-0 right-0 px-2 py-1 bg-gradient-to-t from-black/85 to-transparent text-[10px] text-white/85 truncate">
                    {photo.photographer}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
