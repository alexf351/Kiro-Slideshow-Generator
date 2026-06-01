// Hook Library tab inside Performance. Shows every hook you've used,
// ranked by the post's actual score, filterable by style + niche. Tap a
// winner to drop it straight into the editor's caption, or copy it.

import { useMemo, useState } from 'react';
import { distinctValues, extractHooks, type HookEntry } from './hooks';
import { SCORE_LABEL_COLOR, SCORE_LABEL_TEXT } from './scoring';
import type { Post } from './posts';

type Props = {
  posts: Post[];
  // Drops the hook into the editor (prepended to the caption) and jumps
  // to the Edit tab. Wired up in App.
  onUseHook: (hook: string) => void;
};

const ALL = '__all__';

export default function HookLibrary({ posts, onUseHook }: Props) {
  const [style, setStyle] = useState<string>(ALL);
  const [niche, setNiche] = useState<string>(ALL);
  const [query, setQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const all = useMemo(() => extractHooks(posts), [posts]);
  const styles = useMemo(() => distinctValues(all, 'hookStyle'), [all]);
  const niches = useMemo(() => distinctValues(all, 'niche'), [all]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((e) => {
      if (style !== ALL && e.hookStyle !== style) return false;
      if (niche !== ALL && e.niche !== niche) return false;
      if (q && !e.hook.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [all, style, niche, query]);

  function handleCopy(e: HookEntry) {
    navigator.clipboard?.writeText(e.hook).catch(() => {});
    setCopiedId(e.id);
    setTimeout(() => setCopiedId((c) => (c === e.id ? null : c)), 1500);
  }

  if (all.length === 0) {
    return (
      <div className="text-center text-gray-500 text-sm mt-12 leading-relaxed max-w-md mx-auto">
        <div className="text-base font-bold uppercase tracking-[0.16em] text-gray-300 mb-2">No hooks yet</div>
        Import + score a few posts in the Posts tab. Every scored post's opening hook shows up here, ranked by how
        well that post actually did.
      </div>
    );
  }

  const chip = (val: string, label: string, active: boolean, onClick: () => void) => (
    <button
      key={val}
      type="button"
      onClick={onClick}
      className={
        'shrink-0 px-3 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-[0.14em] transition-colors ' +
        (active ? 'bg-[#00E5FF] text-[#0a0e1a]' : 'bg-white/[0.04] text-gray-400 hover:bg-white/[0.08] hover:text-gray-200')
      }
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-4">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search hooks…"
        className="w-full bg-[#070b18] border border-white/[0.10] rounded-lg px-3 py-2.5 text-sm text-gray-200 placeholder:text-gray-700 focus:border-[#00E5FF]/50 focus:outline-none"
      />

      {styles.length > 0 && (
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-gray-600 mb-1.5">Hook style</div>
          <div className="flex gap-2 overflow-x-auto custom-scrollbar pb-1">
            {chip(ALL, 'All', style === ALL, () => setStyle(ALL))}
            {styles.map((s) => chip(s, s, style === s, () => setStyle(s)))}
          </div>
        </div>
      )}
      {niches.length > 0 && (
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-gray-600 mb-1.5">Niche</div>
          <div className="flex gap-2 overflow-x-auto custom-scrollbar pb-1">
            {chip(ALL, 'All', niche === ALL, () => setNiche(ALL))}
            {niches.map((n) => chip(n, n, niche === n, () => setNiche(n)))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {visible.map((e) => {
          const color = SCORE_LABEL_COLOR[e.label];
          return (
            <div
              key={e.id}
              className="rounded-xl border border-white/[0.08] bg-gradient-to-br from-[#0b1224] to-[#070b18] p-3.5 flex gap-3"
            >
              <div
                className="shrink-0 w-11 h-11 rounded-full border-2 flex flex-col items-center justify-center"
                style={{ borderColor: color }}
                title={SCORE_LABEL_TEXT[e.label]}
              >
                <span className="text-sm font-black tabular-nums leading-none text-white">{e.score}</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] text-gray-100 leading-snug font-medium">{e.hook}</div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] uppercase tracking-[0.12em] text-gray-500">
                  {e.hookStyle && <span style={{ color }}>{e.hookStyle}</span>}
                  {e.niche && <span>· {e.niche}</span>}
                  {e.preset && <span>· {e.preset}</span>}
                </div>
                <div className="mt-2 flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => onUseHook(e.hook)}
                    className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] rounded-md bg-[#00E5FF]/15 text-[#00E5FF] hover:bg-[#00E5FF]/25"
                  >
                    → Editor
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCopy(e)}
                    className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] rounded-md bg-white/[0.04] text-gray-300 hover:bg-white/[0.08] border border-white/10"
                  >
                    {copiedId === e.id ? 'Copied ✓' : 'Copy'}
                  </button>
                  {e.tiktokUrl && (
                    <a
                      href={e.tiktokUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] rounded-md bg-white/[0.04] text-gray-300 hover:bg-white/[0.08] border border-white/10"
                    >
                      Post ↗
                    </a>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {visible.length === 0 && (
          <div className="text-center text-xs text-gray-500 mt-8">No hooks match those filters.</div>
        )}
      </div>
    </div>
  );
}
