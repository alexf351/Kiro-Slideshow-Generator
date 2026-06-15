// Named drafts — a creator's library of in-progress / reusable posts (a full
// snapshot of the editable content: JSON, caption, preset, per-slide media +
// crops, handle settings, AND the on-slide overlays = snipped photos / text).
// Distinct from "posts" (published/archived with analytics).
//
// Stored in IndexedDB (not localStorage) because overlays embed image data
// URLs — a few image-heavy templates blow localStorage's ~5MB budget, which
// silently dropped saves. IndexedDB has hundreds of MB, so the burner-template
// workflow (save a post, duplicate it, tweak, repost) is now reliable.
// Existing localStorage drafts are migrated in on first access.

export type DraftState = {
  jsonText: string;
  caption: string;
  preset: string;
  slideBgs: Record<string, unknown>;
  slideBgAdjust: Record<string, unknown>;
  attribution: string;
  attrPresets: Record<string, boolean>;
  // On-slide text/image overlays, keyed by slide index (optional).
  overlays?: Record<string, unknown>;
  // Free-text reminder of which trending sound to add at post time (optional).
  audioNote?: string;
};

export type Draft = { id: string; name: string; savedAt: number; state: DraftState; scheduledFor?: number; posted?: boolean; thumb?: string };

const DB_NAME = 'kiro_drafts_db';
const DB_VERSION = 1;
const STORE = 'drafts';
const LEGACY_KEY = 'kiro_drafts'; // old localStorage location, migrated in once
const MAX = 300;

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return 'd' + crypto.randomUUID();
  return 'd' + Date.now() + Math.random().toString(36).slice(2, 6);
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(t: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

// Posting plan order: posted sink to the bottom; otherwise scheduled first
// (soonest date), then the rest by most-recently-saved.
export function sortDrafts(arr: Draft[]): Draft[] {
  return [...arr].sort((a, b) => {
    if (!!a.posted !== !!b.posted) return a.posted ? 1 : -1;
    if (a.scheduledFor && b.scheduledFor) return a.scheduledFor - b.scheduledFor;
    if (a.scheduledFor) return -1;
    if (b.scheduledFor) return 1;
    return b.savedAt - a.savedAt;
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;
function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

// One-time import of the old localStorage drafts into IndexedDB. Runs once per
// page load, only copies when the store is empty (so it can't clobber newer
// IDB data), and removes the legacy key afterward.
let migrated: Promise<void> | null = null;
function ensureMigrated(db: IDBDatabase): Promise<void> {
  if (migrated) return migrated;
  migrated = (async () => {
    let raw: string | null = null;
    try { raw = localStorage.getItem(LEGACY_KEY); } catch { /* no storage */ }
    if (!raw) return;
    try {
      const arr = JSON.parse(raw);
      const count = await reqToPromise(db.transaction([STORE], 'readonly').objectStore(STORE).count());
      if (count === 0 && Array.isArray(arr) && arr.length) {
        const t = db.transaction([STORE], 'readwrite');
        const store = t.objectStore(STORE);
        for (const d of arr) if (d && typeof d.id === 'string') store.put(d);
        await txDone(t);
      }
    } catch { /* malformed legacy data — skip */ }
    try { localStorage.removeItem(LEGACY_KEY); } catch { /* ignore */ }
  })();
  return migrated;
}

async function ready(): Promise<IDBDatabase> {
  const db = await openDb();
  await ensureMigrated(db);
  return db;
}

async function getAll(): Promise<Draft[]> {
  const db = await ready();
  const all = (await reqToPromise(db.transaction([STORE], 'readonly').objectStore(STORE).getAll())) as Draft[];
  return sortDrafts(all);
}

// Trim to the newest MAX drafts (by savedAt) so the store can't grow forever.
async function trim(db: IDBDatabase): Promise<void> {
  const all = (await reqToPromise(db.transaction([STORE], 'readonly').objectStore(STORE).getAll())) as Draft[];
  if (all.length <= MAX) return;
  const drop = all.sort((a, b) => a.savedAt - b.savedAt).slice(0, all.length - MAX);
  const t = db.transaction([STORE], 'readwrite');
  for (const d of drop) t.objectStore(STORE).delete(d.id);
  await txDone(t);
}

export async function listDrafts(): Promise<Draft[]> {
  try { return await getAll(); } catch { return []; }
}

// Save a new draft, or overwrite one with the same (case-insensitive) name.
// Never throws — on a write failure the returned list simply won't contain the
// new draft, which the caller treats as "couldn't save".
export async function saveDraft(name: string, state: DraftState, thumb?: string): Promise<Draft[]> {
  try {
    const db = await ready();
    const all = await getAll();
    const clean = name.trim() || `Draft ${new Date().toLocaleString()}`;
    const existing = all.find((d) => d.name.toLowerCase() === clean.toLowerCase());
    // A new cover replaces the old; if none was captured this save, keep the
    // previous cover rather than blanking it.
    const cover = thumb ?? existing?.thumb;
    const draft: Draft = existing
      ? { ...existing, state, savedAt: Date.now(), thumb: cover }
      : { id: newId(), name: clean, savedAt: Date.now(), state, thumb: cover };
    const t = db.transaction([STORE], 'readwrite');
    t.objectStore(STORE).put(draft);
    await txDone(t);
    await trim(db);
    return getAll();
  } catch {
    return listDrafts();
  }
}

export async function deleteDraft(id: string): Promise<Draft[]> {
  try {
    const db = await ready();
    const t = db.transaction([STORE], 'readwrite');
    t.objectStore(STORE).delete(id);
    await txDone(t);
  } catch { /* ignore */ }
  return getAll();
}

export async function renameDraft(id: string, name: string): Promise<Draft[]> {
  return patch(id, (d) => { d.name = name.trim() || d.name; });
}

export async function setDraftSchedule(id: string, ts: number | null): Promise<Draft[]> {
  return patch(id, (d) => { if (ts) d.scheduledFor = ts; else delete d.scheduledFor; });
}

export async function setDraftPosted(id: string, posted: boolean): Promise<Draft[]> {
  return patch(id, (d) => { if (posted) d.posted = true; else delete d.posted; });
}

export async function clearPostedDrafts(): Promise<Draft[]> {
  try {
    const db = await ready();
    const all = await getAll();
    const t = db.transaction([STORE], 'readwrite');
    for (const d of all) if (d.posted) t.objectStore(STORE).delete(d.id);
    await txDone(t);
  } catch { /* ignore */ }
  return getAll();
}

// A "(copy)" name that doesn't collide with an existing draft — "(copy)",
// then "(copy 2)", "(copy 3)"… Pure + exported so the numbering is testable.
export function uniqueCopyName(base: string, existing: string[]): string {
  const taken = new Set(existing.map((n) => n.toLowerCase()));
  const first = `${base} (copy)`;
  if (!taken.has(first.toLowerCase())) return first;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base} (copy ${i})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} (copy ${Date.now()})`;
}

// Fork a draft (its full content + overlays) under a fresh "(copy)" name,
// reset to a clean unscheduled, not-yet-posted draft.
export async function duplicateDraft(id: string): Promise<Draft[]> {
  try {
    const db = await ready();
    const all = await getAll();
    const src = all.find((d) => d.id === id);
    if (!src) return all;
    const copy: Draft = {
      id: newId(),
      name: uniqueCopyName(src.name, all.map((d) => d.name)),
      savedAt: Date.now(),
      // Deep-clone so the copy never shares the original's state object.
      state: JSON.parse(JSON.stringify(src.state)) as DraftState,
      thumb: src.thumb,
    };
    const t = db.transaction([STORE], 'readwrite');
    t.objectStore(STORE).put(copy);
    await txDone(t);
    await trim(db);
    return getAll();
  } catch {
    return listDrafts();
  }
}

async function patch(id: string, mutate: (d: Draft) => void): Promise<Draft[]> {
  try {
    const db = await ready();
    // Read in its own transaction first — awaiting between get and put on a
    // single transaction would let it auto-commit and the put would throw.
    const existing = (await reqToPromise(db.transaction([STORE], 'readonly').objectStore(STORE).get(id))) as Draft | undefined;
    if (existing) {
      mutate(existing);
      const t = db.transaction([STORE], 'readwrite');
      t.objectStore(STORE).put(existing);
      await txDone(t);
    }
  } catch { /* ignore */ }
  return getAll();
}

// ---- backup interop ----
// Read every draft (for export) and bulk-merge drafts from a backup (import,
// existing ids win so a re-import is idempotent).
export async function getAllDrafts(): Promise<Draft[]> {
  return listDrafts();
}

export async function importDrafts(incoming: Draft[]): Promise<number> {
  if (!Array.isArray(incoming) || incoming.length === 0) return 0;
  try {
    const db = await ready();
    const existing = new Set((await getAll()).map((d) => d.id));
    const t = db.transaction([STORE], 'readwrite');
    let n = 0;
    for (const d of incoming) {
      if (!d || typeof d.id !== 'string' || existing.has(d.id)) continue;
      t.objectStore(STORE).put(d);
      n++;
    }
    await txDone(t);
    await trim(db);
    return n;
  } catch {
    return 0;
  }
}
