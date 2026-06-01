// ⌘K command palette — fast, fuzzy-searchable access to every common
// action (render, save, switch format, jump tabs, set aspect ratio, …).
// App builds the command list from its own handlers and passes it in; this
// component owns only the search + keyboard navigation UI.

import { useEffect, useMemo, useRef, useState } from 'react';

export type Command = {
  id: string;
  label: string;
  hint?: string;        // right-aligned shortcut / context
  section: string;      // group header
  keywords?: string;    // extra search terms
  run: () => void;
};

type Props = {
  open: boolean;
  commands: Command[];
  onClose: () => void;
};

// Lightweight subsequence fuzzy match + score (lower = better).
function fuzzy(query: string, text: string): number | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 0;
  let ti = 0;
  let score = 0;
  let lastMatch = -1;
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi];
    const found = t.indexOf(c, ti);
    if (found === -1) return null;
    if (lastMatch !== -1) score += found - lastMatch; // reward adjacency
    lastMatch = found;
    ti = found + 1;
  }
  return score + found_bonus(t, q);
}
function found_bonus(t: string, q: string): number {
  return t.startsWith(q) ? -5 : 0;
}

export default function CommandPalette({ open, commands, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      // focus after paint
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const results = useMemo(() => {
    const scored = commands
      .map((c) => ({ c, s: fuzzy(query, c.label + ' ' + (c.keywords || '') + ' ' + c.section) }))
      .filter((x): x is { c: Command; s: number } => x.s !== null)
      .sort((a, b) => a.s - b.s);
    return scored.map((x) => x.c);
  }, [commands, query]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  // Keep the active row in view.
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  function choose(cmd: Command | undefined) {
    if (!cmd) return;
    onClose();
    // Defer so the palette unmounts before the action (some actions focus
    // other inputs or open modals).
    setTimeout(() => cmd.run(), 0);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(results[active]);
    }
  }

  // Group consecutive results by section for headers.
  let lastSection = '';

  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center pt-[12vh] px-4">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative w-full max-w-lg rounded-2xl border border-white/10 bg-[#0b1020]/95 shadow-[0_30px_80px_-12px_rgba(0,0,0,0.85)] overflow-hidden animate-[dialogIn_140ms_ease-out]"
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.07]">
          <span className="text-gray-500 text-sm">⌘</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command — render, format, aspect, jump…"
            className="flex-1 bg-transparent text-[15px] text-gray-100 placeholder:text-gray-600 focus:outline-none"
          />
          <kbd className="text-[10px] text-gray-600 font-mono">esc</kbd>
        </div>
        <div ref={listRef} className="max-h-[52vh] overflow-y-auto custom-scrollbar py-1.5">
          {results.length === 0 && (
            <div className="px-4 py-6 text-center text-[13px] text-gray-500">No matching commands.</div>
          )}
          {results.map((c, i) => {
            const showHeader = c.section !== lastSection;
            lastSection = c.section;
            const isActive = i === active;
            return (
              <div key={c.id}>
                {showHeader && (
                  <div className="px-4 pt-2 pb-1 text-[9px] font-bold uppercase tracking-[0.18em] text-gray-600">
                    {c.section}
                  </div>
                )}
                <button
                  type="button"
                  data-idx={i}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(c)}
                  className={
                    'w-full flex items-center justify-between gap-3 px-4 py-2 text-left transition-colors ' +
                    (isActive ? 'bg-[#00E5FF]/10' : 'hover:bg-white/[0.03]')
                  }
                >
                  <span className={'text-[13px] ' + (isActive ? 'text-[#00E5FF]' : 'text-gray-200')}>{c.label}</span>
                  {c.hint && <span className="text-[10px] text-gray-600 font-mono shrink-0">{c.hint}</span>}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
