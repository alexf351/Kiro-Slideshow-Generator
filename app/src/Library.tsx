import { useEffect, useMemo, useRef, useState } from 'react';
import {
  addItems,
  blobToObjectUrl,
  createSet,
  deleteItem,
  deleteSet,
  listItems,
  listSets,
  renameSet,
  setItemSetMembership,
  type MediaItem,
  type MediaSet,
} from './mediaBank';
import StockSearch from './StockSearch';
import { useUI } from './ui';

type Props = {
  // When set, the Library is in "pick a background" mode. Tapping any item
  // resolves with that item id; tapping Cancel resolves with null.
  pickMode: { slideLabel: string; resolve: (itemId: string | null) => void } | null;
  // BYOK keys for the stock-photo Search Stock tab. Empty strings are
  // valid; the StockSearch panel surfaces a "no key" warning itself.
  pexelsKey: string;
  unsplashKey: string;
};

type LibraryView = 'library' | 'stock';

const ALL_FILTER = '__all__';

export default function Library({ pickMode, pexelsKey, unsplashKey }: Props) {
  const ui = useUI();
  const [items, setItems] = useState<MediaItem[]>([]);
  const [sets, setSets] = useState<MediaSet[]>([]);
  const [activeSet, setActiveSet] = useState<string>(ALL_FILTER);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  // 'library' = the user's media bank. 'stock' = Pexels / Unsplash search
  // panel. Pick mode forces 'library' since you can't pick a slide bg
  // from a search result that hasn't been imported yet.
  const [view, setView] = useState<LibraryView>('library');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Object URLs for thumbnails. Revoked when the item list changes so we
  // don't leak memory across reloads.
  const thumbs = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items) map.set(item.id, blobToObjectUrl(item.blob));
    return map;
  }, [items]);
  useEffect(() => {
    return () => {
      for (const url of thumbs.values()) URL.revokeObjectURL(url);
    };
  }, [thumbs]);

  async function refresh() {
    const [is, ss] = await Promise.all([listItems(), listSets()]);
    setItems(is);
    setSets(ss);
  }

  useEffect(() => {
    refresh();
  }, []);

  const visibleItems = useMemo(() => {
    if (activeSet === ALL_FILTER) return items;
    return items.filter((i) => i.setIds.includes(activeSet));
  }, [items, activeSet]);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const accepted = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (accepted.length === 0) return;
    setBusy(`Uploading ${accepted.length}…`);
    try {
      const added = await addItems(accepted);
      // If the user is browsing inside a specific set, drop the new items into it
      // so they're visible without switching tabs.
      if (activeSet !== ALL_FILTER) {
        await setItemSetMembership(
          added.map((i) => i.id),
          activeSet,
          true,
        );
      }
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function handleNewSet() {
    const name = await ui.prompt({ title: 'New library', message: 'Name your library', placeholder: 'e.g. Coding screenshots', confirmLabel: 'Create' });
    if (name === null) return;
    const set = await createSet(name);
    await refresh();
    setActiveSet(set.id);
  }

  async function handleRenameSet(id: string) {
    const current = sets.find((s) => s.id === id);
    if (!current) return;
    const name = await ui.prompt({ title: 'Rename library', message: 'New name', defaultValue: current.name, confirmLabel: 'Rename' });
    if (name === null) return;
    await renameSet(id, name);
    await refresh();
  }

  async function handleDeleteSet(id: string) {
    const current = sets.find((s) => s.id === id);
    if (!current) return;
    if (!(await ui.confirm({ message: `Delete library "${current.name}"? Photos inside it will stay in your media bank.`, confirmLabel: 'Delete', danger: true }))) return;
    await deleteSet(id);
    if (activeSet === id) setActiveSet(ALL_FILTER);
    await refresh();
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function bulkDelete() {
    if (selectedIds.size === 0) return;
    if (!(await ui.confirm({ message: `Delete ${selectedIds.size} photo${selectedIds.size === 1 ? '' : 's'}?`, confirmLabel: 'Delete', danger: true }))) return;
    setBusy('Deleting…');
    try {
      for (const id of selectedIds) await deleteItem(id);
      setSelectedIds(new Set());
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function bulkAddToSet(setId: string, member: boolean) {
    if (selectedIds.size === 0) return;
    setBusy(member ? 'Adding to library…' : 'Removing from library…');
    try {
      await setItemSetMembership(Array.from(selectedIds), setId, member);
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  const setChip = (id: string, label: string) => {
    const active = activeSet === id;
    return (
      <button
        key={id}
        type="button"
        onClick={() => setActiveSet(id)}
        className={
          'shrink-0 px-4 py-2 rounded-full text-xs font-bold uppercase tracking-[0.14em] transition-colors ' +
          (active
            ? 'bg-[#00E5FF] text-[#0a0e1a]'
            : 'bg-white/[0.04] text-gray-400 hover:bg-white/[0.08] hover:text-gray-200')
        }
      >
        {label}
      </button>
    );
  };

  // Library/Search top-level tab pill. Disabled in pick mode so the user
  // can't side-track to the search panel mid-pick.
  const tabBtn = (kind: LibraryView, label: string) => {
    const active = view === kind;
    return (
      <button
        key={kind}
        type="button"
        onClick={() => setView(kind)}
        disabled={!!pickMode}
        className={
          'relative px-4 py-2 rounded-full text-[11px] font-bold uppercase tracking-[0.18em] transition-all ' +
          (active
            ? 'bg-[#00E5FF] text-[#0a0e1a] shadow-[0_4px_18px_-4px_rgba(0,229,255,0.55)]'
            : 'bg-white/[0.04] text-gray-400 hover:bg-white/[0.09] hover:text-gray-100') +
          ' disabled:opacity-40 disabled:cursor-not-allowed'
        }
      >
        {label}
      </button>
    );
  };

  const selectionMode = selectedIds.size > 0;

  // Pick mode forces the Library tab — searching stock makes no sense
  // mid-pick because the user is choosing from existing items.
  const effectiveView: LibraryView = pickMode ? 'library' : view;

  if (effectiveView === 'stock') {
    return (
      <div className="h-full flex flex-col bg-[#070a14]">
        <header className="shrink-0 px-5 md:px-8 pt-5 md:pt-7 pb-3 border-b border-white/[0.06]">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xl md:text-2xl font-black tracking-tight text-white">Media Bank</h2>
          </div>
          <div className="flex gap-2">
            {tabBtn('library', 'My Library')}
            {tabBtn('stock', 'Search Stock')}
          </div>
        </header>
        <div className="flex-1 min-h-0">
          <StockSearch pexelsKey={pexelsKey} unsplashKey={unsplashKey} onImported={refresh} />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[#070a14]">
      {pickMode && (
        <div className="shrink-0 px-5 md:px-8 py-3 bg-[#0e2b3a] border-b border-[#00E5FF]/30 flex items-center justify-between">
          <div className="text-sm text-[#00E5FF]">
            Pick a background for <strong>{pickMode.slideLabel}</strong>
          </div>
          <button
            type="button"
            onClick={() => pickMode.resolve(null)}
            className="text-xs font-bold uppercase tracking-[0.16em] text-gray-300 hover:text-white"
          >
            Cancel
          </button>
        </div>
      )}

      <header className="shrink-0 px-5 md:px-8 pt-5 md:pt-7 pb-4 border-b border-white/[0.06]">
        <div className="flex items-center justify-between">
          <h2 className="text-xl md:text-2xl font-black tracking-tight text-white">Media Bank</h2>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="px-4 py-2 rounded-lg text-sm font-bold tracking-wide
                       bg-gradient-to-r from-[#00E5FF] to-[#00A5D9] text-[#0a0e1a]
                       hover:-translate-y-0.5 transition-all"
          >
            Upload
          </button>
        </div>
        <div className="mt-3 flex gap-2">
          {tabBtn('library', 'My Library')}
          {tabBtn('stock', 'Search Stock')}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <div className="mt-4 flex gap-2 overflow-x-auto custom-scrollbar pb-1">
          {setChip(ALL_FILTER, 'All')}
          {sets.map((s) => setChip(s.id, s.name))}
          <button
            type="button"
            onClick={handleNewSet}
            className="shrink-0 px-4 py-2 rounded-full text-xs font-bold uppercase tracking-[0.14em]
                       border border-dashed border-white/20 text-gray-400 hover:border-[#00E5FF]/60 hover:text-[#00E5FF]"
          >
            + New library
          </button>
        </div>
        {activeSet !== ALL_FILTER && (
          <div className="mt-3 flex items-center gap-3 text-xs text-gray-500">
            <button onClick={() => handleRenameSet(activeSet)} className="hover:text-gray-200">Rename</button>
            <span>·</span>
            <button onClick={() => handleDeleteSet(activeSet)} className="hover:text-red-400">Delete library</button>
          </div>
        )}
      </header>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 md:p-6">
        {busy && <div className="mb-3 text-xs text-[#00E5FF]">{busy}</div>}
        {visibleItems.length === 0 && (
          <label
            htmlFor="library-drop-input"
            className="block w-full py-16 rounded-2xl border-2 border-dashed border-white/10 text-center text-gray-500 cursor-pointer hover:border-[#00E5FF]/40 hover:bg-[#0c1424]/60 transition-all group"
          >
            <div className="mx-auto mb-3 w-12 h-12 rounded-full bg-white/[0.04] border border-white/10 flex items-center justify-center text-2xl text-gray-500 group-hover:text-[#00E5FF] group-hover:border-[#00E5FF]/40 transition-colors">
              +
            </div>
            <div className="text-sm font-bold uppercase tracking-[0.18em] mb-1 text-gray-300 group-hover:text-white">
              No photos yet
            </div>
            <div className="text-xs text-gray-500">
              Tap to upload, drop files here, or switch to Search Stock
            </div>
          </label>
        )}
        <input
          id="library-drop-input"
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
        {visibleItems.length > 0 && (
          <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 md:gap-3">
            {visibleItems.map((item) => {
              const url = thumbs.get(item.id);
              const selected = selectedIds.has(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    if (pickMode) {
                      pickMode.resolve(item.id);
                      return;
                    }
                    toggleSelect(item.id);
                  }}
                  className={
                    'relative aspect-[9/16] rounded-lg overflow-hidden border transition-all ' +
                    (selected
                      ? 'border-[#00E5FF] shadow-[0_0_0_2px_rgba(0,229,255,0.4)]'
                      : 'border-white/10 hover:border-white/30')
                  }
                >
                  {url && <img src={url} alt={item.name} className="w-full h-full object-cover" loading="lazy" />}
                  {selected && (
                    <div className="absolute inset-0 bg-[#00E5FF]/20 flex items-center justify-center">
                      <span className="w-7 h-7 rounded-full bg-[#00E5FF] text-[#0a0e1a] text-sm font-black flex items-center justify-center">✓</span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {selectionMode && !pickMode && (
        <div className="shrink-0 border-t border-white/[0.06] bg-[#0a0e1a] px-4 md:px-6 py-3 flex flex-wrap items-center gap-2">
          <span className="text-sm text-gray-300 mr-2">{selectedIds.size} selected</span>
          {sets.length > 0 && (
            <select
              className="bg-[#070b18] border border-white/10 rounded-md text-xs text-gray-200 px-2 py-1.5"
              defaultValue=""
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                const [op, id] = v.split(':');
                bulkAddToSet(id, op === 'add');
                e.target.value = '';
              }}
            >
              <option value="" disabled>Add / remove from library…</option>
              {sets.map((s) => (
                <option key={s.id} value={`add:${s.id}`}>Add to “{s.name}”</option>
              ))}
              {sets.map((s) => (
                <option key={'r' + s.id} value={`remove:${s.id}`}>Remove from “{s.name}”</option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={bulkDelete}
            className="ml-auto px-3 py-1.5 rounded-md text-xs font-bold uppercase tracking-[0.14em] bg-red-500/20 text-red-300 border border-red-500/40 hover:bg-red-500/30"
          >
            Delete
          </button>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="px-3 py-1.5 rounded-md text-xs font-bold uppercase tracking-[0.14em] text-gray-400 hover:text-gray-200"
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
}
