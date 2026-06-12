// Discover tab — browse the recurring viral-slideshow PATTERNS (the structure
// + hook formula + why it works) and adapt one into the editor in a tap. The
// "look at other viral slideshows and adapt them" surface, built from a
// curated library rather than live scraping.

import { useMemo, useState } from 'react';
import { VIRAL_PATTERNS, VIRAL_MECHANICS, type ViralPattern, type ViralMechanic } from './viralLibrary';
import { PRESETS } from './presets';

export default function Discover({ onAdapt }: { onAdapt: (p: ViralPattern) => void }) {
  const [mechanic, setMechanic] = useState<ViralMechanic | 'All'>('All');
  const [query, setQuery] = useState('');

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return VIRAL_PATTERNS.filter((p) => {
      if (mechanic !== 'All' && p.mechanic !== mechanic) return false;
      if (!q) return true;
      return (`${p.title} ${p.hook} ${p.example} ${p.why} ${PRESETS[p.preset].label}`).toLowerCase().includes(q);
    });
  }, [mechanic, query]);

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 px-5 md:px-8 pt-4 pb-3 border-b border-white/[0.06]">
        <div className="flex items-baseline gap-2.5 mb-1">
          <h2 className="text-lg font-black tracking-tight text-white">Discover</h2>
          <span className="text-[10px] font-bold uppercase tracking-[0.28em] text-[#00E5FF]">viral patterns</span>
        </div>
        <p className="text-[12px] text-gray-500 leading-relaxed mb-3">
          The slideshow shapes that go viral, distilled into reusable starts. Tap <strong className="text-gray-300">Adapt</strong> to
          load one into the editor — then hit <strong className="text-gray-300">Full post</strong> to spin up your own version.
        </p>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${VIRAL_PATTERNS.length} patterns… (e.g. "ranking", "story", "stat")`}
          className="w-full mb-2.5 bg-[#070b18] border border-white/[0.08] rounded-lg px-3 py-2 text-[12px] text-gray-200 placeholder:text-gray-600 focus:border-[#00E5FF]/40 focus:outline-none"
        />
        <div className="flex items-center gap-1.5 flex-wrap">
          {(['All', ...VIRAL_MECHANICS] as const).map((m) => {
            const active = mechanic === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => setMechanic(m)}
                className={
                  'px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-[0.1em] transition-colors ' +
                  (active ? 'bg-[#00E5FF] text-[#0a0e1a]' : 'bg-white/[0.04] text-gray-400 hover:bg-white/[0.08] hover:text-gray-200')
                }
              >
                {m}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 md:p-6">
        {shown.length === 0 ? (
          <div className="text-center text-gray-500 text-xs mt-12">No patterns match that.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {shown.map((p) => {
              const meta = PRESETS[p.preset];
              return (
                <div key={p.id} className="flex flex-col rounded-xl border border-white/[0.08] bg-[#0b1224]/60 p-4">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="text-[13px] font-bold text-gray-100 leading-snug">{p.title}</div>
                    <span className="shrink-0 text-[9px] font-bold uppercase tracking-[0.1em] px-1.5 py-0.5 rounded" style={{ color: meta.accent, backgroundColor: meta.accent + '22' }}>{meta.label}</span>
                  </div>
                  <div className="text-[12px] text-gray-300 leading-snug mb-1.5">“{p.hook}”</div>
                  <div className="text-[11px] text-gray-500 italic leading-snug mb-2">e.g. {p.example}</div>
                  <div className="flex items-start gap-1.5 text-[11px] text-gray-500 leading-snug mb-3">
                    <span className="shrink-0 text-[#00E5FF]">why</span>
                    <span>{p.why}</span>
                  </div>
                  <div className="mt-auto flex items-center justify-between">
                    <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-gray-600">{p.mechanic}</span>
                    <button
                      type="button"
                      onClick={() => onAdapt(p)}
                      className="px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-[0.1em] bg-gradient-to-r from-[#00E5FF] to-[#00A5D9] text-[#0a0e1a] hover:-translate-y-0.5 transition-transform"
                    >
                      Adapt →
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
