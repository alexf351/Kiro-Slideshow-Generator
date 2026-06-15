// Drafts gallery — a Media-Bank-style visual board of saved posts, each with
// a cover thumbnail (the hook slide, captured on save). Makes the burner-
// template workflow scannable: see your reusable posts at a glance, then
// load / duplicate / schedule / delete. The sidebar Drafts group keeps the
// authoring controls (batch, save, calendar); this is the browse surface.

import { useMemo, useState } from 'react';
import { PRESETS, type PresetKey } from './presets';
import type { Draft } from './drafts';

type Props = {
  drafts: Draft[];
  activeName: string;
  scheduleHour: number;
  onLoad: (d: Draft) => void;
  onDuplicate: (d: Draft) => void;
  onRename: (d: Draft) => void;
  onDelete: (d: Draft) => void;
  onTogglePosted: (d: Draft) => void;
  onSchedule: (d: Draft, ts: number | null) => void;
};

function whenLabel(d: Draft): { text: string; cls: string } {
  if (d.scheduledFor) {
    const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
    const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
    const due = !d.posted && d.scheduledFor <= todayEnd.getTime();
    const overdue = !d.posted && d.scheduledFor < startToday.getTime();
    const date = new Date(d.scheduledFor).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    return { text: `📅 ${date}${overdue ? ' · overdue' : due ? ' · today' : ''}`, cls: due ? 'text-amber-400 font-bold' : 'text-[#34D399]' };
  }
  return { text: new Date(d.savedAt).toLocaleDateString(), cls: 'text-gray-500' };
}

export default function Drafts({ drafts, activeName, scheduleHour, onLoad, onDuplicate, onRename, onDelete, onTogglePosted, onSchedule }: Props) {
  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? drafts.filter((d) => d.name.toLowerCase().includes(q)) : drafts;
  }, [drafts, query]);

  const iconBtn = 'w-7 h-7 rounded-md flex items-center justify-center text-gray-400 hover:text-[#00E5FF] hover:bg-[#00E5FF]/10 transition-colors';

  return (
    <div className="h-full flex flex-col bg-[#070a14]">
      <div className="shrink-0 px-5 md:px-8 pt-5 md:pt-7 pb-3 border-b border-white/[0.06]">
        <div className="flex items-baseline gap-2.5 mb-1">
          <h2 className="text-xl md:text-2xl font-black tracking-tight text-white">Drafts</h2>
          <span className="text-[10px] font-bold uppercase tracking-[0.28em] text-[#34D399]">{drafts.length} saved</span>
        </div>
        <p className="text-[12px] text-gray-500 leading-relaxed mb-3">
          Your saved posts with covers. Tap one to load it; duplicate a template instead of restarting.
        </p>
        {drafts.length > 0 && (
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Filter ${drafts.length} drafts by name…`}
            className="w-full bg-[#070b18] border border-white/[0.08] rounded-lg px-3 py-2 text-[12px] text-gray-200 placeholder:text-gray-600 focus:border-[#34D399]/40 focus:outline-none"
          />
        )}
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 md:p-6">
        {drafts.length === 0 ? (
          <div className="text-center text-gray-500 text-xs mt-12 leading-relaxed px-6">
            No drafts yet. Build a post, then hit <strong className="text-gray-300">Save as draft</strong> or <strong className="text-gray-300">⧉ Copy</strong> in the editor —
            it saves the JSON, backgrounds, and your snipped-on photos.
          </div>
        ) : shown.length === 0 ? (
          <div className="text-center text-gray-500 text-xs mt-12">No drafts match “{query}”.</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
            {shown.map((d) => {
              const meta = PRESETS[d.state?.preset as PresetKey];
              const isoDate = d.scheduledFor ? new Date(d.scheduledFor).toISOString().slice(0, 10) : '';
              const when = whenLabel(d);
              const active = !!activeName && d.name === activeName;
              return (
                <div
                  key={d.id}
                  className={
                    'group flex flex-col rounded-xl border overflow-hidden bg-[#0b1224]/60 transition-all ' +
                    (active ? 'border-[#34D399]/60 shadow-[0_0_0_1px_rgba(52,211,153,0.3)]' : 'border-white/[0.08] hover:border-white/25') +
                    (d.posted ? ' opacity-60' : '')
                  }
                >
                  {/* Cover */}
                  <button
                    type="button"
                    onClick={() => onLoad(d)}
                    title={`Load "${d.name}"`}
                    className="relative aspect-[9/16] w-full bg-[#05070d] overflow-hidden"
                  >
                    {d.thumb ? (
                      <img src={d.thumb} alt={d.name} className="w-full h-full object-cover" loading="lazy" decoding="async" />
                    ) : (
                      <div
                        className="w-full h-full flex flex-col items-center justify-center p-3 text-center"
                        style={{ background: meta ? `linear-gradient(160deg, ${meta.accent}22, #05070d)` : '#0b1018' }}
                      >
                        <span className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: meta?.accent || '#6b7280' }}>{meta?.label || 'Draft'}</span>
                        <span className="mt-1.5 text-[11px] text-gray-400 line-clamp-3">{d.name}</span>
                        <span className="mt-2 text-[9px] text-gray-600">no cover yet · re-save to capture</span>
                      </div>
                    )}
                    {/* status chips */}
                    {d.posted && <span className="absolute top-1.5 left-1.5 text-[8px] font-bold uppercase tracking-[0.1em] px-1.5 py-0.5 rounded bg-[#34D399] text-[#04121a]">Posted</span>}
                    {!d.posted && d.scheduledFor && <span className="absolute top-1.5 left-1.5 text-[8px] font-bold uppercase tracking-[0.1em] px-1.5 py-0.5 rounded bg-black/60 text-[#34D399]">Scheduled</span>}
                    <span className="absolute inset-x-0 bottom-0 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-white bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">↺ Load</span>
                  </button>

                  {/* Meta + actions */}
                  <div className="p-2 flex flex-col gap-1.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className={'text-[11px] font-bold truncate ' + (d.posted ? 'text-gray-400 line-through' : 'text-gray-100')}>{d.name}</span>
                      {meta && <span className="shrink-0 text-[8px] font-bold uppercase tracking-[0.08em] px-1 py-0.5 rounded" style={{ color: meta.accent, backgroundColor: meta.accent + '22' }}>{meta.label}</span>}
                    </div>
                    <div className={'text-[10px] ' + when.cls}>{when.text}</div>
                    <div className="flex items-center gap-0.5 -ml-1">
                      <button type="button" onClick={() => onTogglePosted(d)} className={iconBtn + (d.posted ? ' text-[#34D399]' : '')} title={d.posted ? 'Mark not posted' : 'Mark posted'} aria-label="Toggle posted">✓</button>
                      <label className={iconBtn + ' cursor-pointer relative'} title="Schedule a date">
                        📅
                        <input
                          type="date"
                          value={isoDate}
                          onChange={(e) => {
                            const v = e.target.value;
                            onSchedule(d, v ? new Date(v + `T${String(scheduleHour).padStart(2, '0')}:00:00`).getTime() : null);
                          }}
                          className="absolute inset-0 opacity-0 cursor-pointer [color-scheme:dark]"
                          aria-label={`Schedule ${d.name}`}
                        />
                      </label>
                      <button type="button" onClick={() => onDuplicate(d)} className={iconBtn} title="Duplicate" aria-label="Duplicate">⧉</button>
                      <button type="button" onClick={() => onRename(d)} className={iconBtn} title="Rename" aria-label="Rename">✎</button>
                      <button type="button" onClick={() => onDelete(d)} className="w-7 h-7 rounded-md flex items-center justify-center text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors ml-auto" title="Delete" aria-label="Delete">✕</button>
                    </div>
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
