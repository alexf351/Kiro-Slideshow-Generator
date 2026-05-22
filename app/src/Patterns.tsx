// Patterns view: shows every past post that carries a CloneAnalysis
// snapshot. This is the article's "library of patterns proven in your
// niche" — each row is a structural fingerprint you can re-run or use
// as inspiration. The Propose panel reads from the same data behind
// the scenes.

import { useEffect, useMemo, useState } from 'react';
import { listPosts, type Post } from './posts';
import { blobToObjectUrl } from './mediaBank';

type Props = {
  // "Clone this URL again" action — App.tsx wires this to the
  // CloneFromTikTok panel so the user can re-clone with the same
  // source.
  onCloneAgain: (sourceUrl: string) => void;
};

const ALL_NICHE = '__all__';

export default function Patterns({ onCloneAgain }: Props) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [activeNiche, setActiveNiche] = useState<string>(ALL_NICHE);

  async function refresh() {
    const all = await listPosts();
    setPosts(all);
  }

  useEffect(() => {
    refresh();
  }, []);

  // Only posts with a structural snapshot count as "patterns".
  // Manual saves without clone analysis live in Analytics instead.
  const patterns = useMemo(() => posts.filter((p) => p.cloneAnalysis), [posts]);

  const niches = useMemo(() => {
    const set = new Set<string>();
    patterns.forEach((p) => {
      if (p.niche && p.niche.trim()) set.add(p.niche.trim());
    });
    return Array.from(set).sort();
  }, [patterns]);

  const visible = useMemo(() => {
    if (activeNiche === ALL_NICHE) return patterns;
    return patterns.filter((p) => (p.niche || '').trim() === activeNiche);
  }, [patterns, activeNiche]);

  // Object URLs for thumbnails. Revoked on unmount / reload to avoid
  // leaks across refreshes.
  const thumbs = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of patterns) {
      if (p.thumbnailBlob) map.set(p.id, blobToObjectUrl(p.thumbnailBlob));
    }
    return map;
  }, [patterns]);
  useEffect(() => {
    return () => {
      for (const u of thumbs.values()) URL.revokeObjectURL(u);
    };
  }, [thumbs]);

  const nicheChip = (key: string, label: string) => {
    const active = activeNiche === key;
    return (
      <button
        key={key}
        type="button"
        onClick={() => setActiveNiche(key)}
        className={
          'shrink-0 px-3 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-[0.14em] transition-colors ' +
          (active
            ? 'bg-[#00E5FF] text-[#0a0e1a]'
            : 'bg-white/[0.04] text-gray-400 hover:bg-white/[0.08] hover:text-gray-200')
        }
      >
        {label}
      </button>
    );
  };

  return (
    <div className="h-full flex flex-col bg-[#070a14]">
      <header className="shrink-0 px-5 md:px-8 pt-5 md:pt-7 pb-4 border-b border-white/[0.06]">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xl md:text-2xl font-black tracking-tight text-white">Patterns</h2>
          <span className="text-[10px] uppercase tracking-[0.16em] text-gray-600">
            {patterns.length} pattern{patterns.length === 1 ? '' : 's'}
          </span>
        </div>
        <p className="text-xs text-gray-500 leading-relaxed mb-3">
          Every clone + proposal you've saved. Each row is a structural fingerprint —
          re-run it on a new topic, or use it as inspiration for a fresh angle.
        </p>
        {niches.length > 0 && (
          <div className="flex gap-2 overflow-x-auto custom-scrollbar pb-1">
            {nicheChip(ALL_NICHE, 'All')}
            {niches.map((n) => nicheChip(n, n))}
          </div>
        )}
      </header>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 md:p-6">
        {patterns.length === 0 && (
          <div className="text-center text-gray-500 text-sm mt-12 leading-relaxed max-w-md mx-auto">
            <div className="text-base font-bold uppercase tracking-[0.16em] text-gray-300 mb-2">
              No patterns yet
            </div>
            Clone a TikTok or run Propose to start building your library. Every saved post
            with a structural fingerprint shows up here.
          </div>
        )}

        {visible.length > 0 && (
          <div className="flex flex-col gap-3">
            {visible.map((p) => {
              const thumb = thumbs.get(p.id);
              const ago = relativeAge(p.postedAt);
              const a = p.cloneAnalysis;
              return (
                <div
                  key={p.id}
                  className="rounded-xl border border-white/[0.08] bg-gradient-to-br from-[#0b1224] to-[#070b18] p-4 flex gap-4 hover:border-[#00E5FF]/30 transition-colors"
                >
                  <div className="shrink-0 w-20 aspect-[9/16] rounded-md overflow-hidden border border-white/[0.08] bg-black">
                    {thumb ? (
                      <img src={thumb} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[9px] uppercase tracking-[0.16em] text-gray-700">
                        no thumb
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1 flex flex-col gap-1.5">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#00E5FF]">
                        {p.preset || 'unknown'}
                      </span>
                      {p.niche && (
                        <span className="text-[10px] uppercase tracking-[0.14em] text-gray-500">
                          · {p.niche}
                        </span>
                      )}
                      <span className="ml-auto text-[10px] uppercase tracking-[0.14em] text-gray-600">
                        {ago}
                        {p.origin && p.origin !== 'manual' && (
                          <span className="ml-2 px-1.5 py-0.5 rounded bg-white/[0.04] text-gray-400">
                            {p.origin}
                          </span>
                        )}
                      </span>
                    </div>

                    {a && (
                      <div className="text-[12px] text-gray-200 leading-relaxed">
                        {a.structuralFingerprint}
                      </div>
                    )}
                    {a && (
                      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-gray-500 leading-relaxed">
                        <span><strong className="text-gray-400">Hook:</strong> {a.hookStyle}</span>
                        <span><strong className="text-gray-400">CTA:</strong> {a.ctaShape}</span>
                        <span><strong className="text-gray-400">Density:</strong> {a.density}</span>
                        <span><strong className="text-gray-400">Voice:</strong> {a.voiceTone}</span>
                      </div>
                    )}

                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {p.sourceTikTokUrl && (
                        <>
                          <button
                            type="button"
                            onClick={() => onCloneAgain(p.sourceTikTokUrl!)}
                            className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] rounded-md
                                       bg-[#00E5FF]/15 text-[#00E5FF] hover:bg-[#00E5FF]/25"
                          >
                            Clone again
                          </button>
                          <a
                            href={p.sourceTikTokUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] rounded-md
                                       bg-white/[0.04] text-gray-300 hover:bg-white/[0.08] border border-white/10"
                          >
                            Open source ↗
                          </a>
                        </>
                      )}
                      {p.tiktokUrl && (
                        <a
                          href={p.tiktokUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] rounded-md
                                     bg-white/[0.04] text-gray-300 hover:bg-white/[0.08] border border-white/10"
                        >
                          Your post ↗
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {patterns.length > 0 && visible.length === 0 && (
          <div className="text-center text-xs text-gray-500 mt-12">
            No patterns match the <strong className="text-gray-300">{activeNiche}</strong> niche filter.
          </div>
        )}
      </div>
    </div>
  );
}

function relativeAge(ts: number): string {
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return '1d ago';
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}
