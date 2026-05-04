// IndexedDB-backed media bank. Stores uploaded image blobs and named "sets"
// (libraries) the user can group them into. We keep the actual image bytes here
// rather than localStorage because slides are 1080×1920 photos and localStorage
// caps at ~5 MB across the whole origin.

const DB_NAME = 'kiro_media_bank';
const DB_VERSION = 2;
const ITEMS_STORE = 'items';
const SETS_STORE = 'sets';
const POSTS_STORE = 'posts';

export type MediaItemSource = {
  provider: 'pexels' | 'unsplash' | 'upload';
  // Where to credit the photo (only set for stock results). Pexels
  // doesn't require attribution but we keep the link anyway so the
  // Library can show it on hover / tap.
  photographer?: string;
  photographerUrl?: string;
  photoUrl?: string;
};

export type MediaItem = {
  id: string;
  blob: Blob;
  mimeType: string;
  name: string;
  addedAt: number;
  setIds: string[];
  // Optional — older items predate this field and stay valid.
  source?: MediaItemSource;
};

export type MediaSet = {
  id: string;
  name: string;
  createdAt: number;
};

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(ITEMS_STORE)) {
        db.createObjectStore(ITEMS_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(SETS_STORE)) {
        db.createObjectStore(SETS_STORE, { keyPath: 'id' });
      }
      // posts store added in v2 — kept here so both modules agree on the
      // schema regardless of which one opens the DB first.
      if (!db.objectStoreNames.contains(POSTS_STORE)) {
        db.createObjectStore(POSTS_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(db: IDBDatabase, stores: string[], mode: IDBTransactionMode): IDBTransaction {
  return db.transaction(stores, mode);
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'id_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export async function addItems(files: File[]): Promise<MediaItem[]> {
  const db = await openDb();
  const t = tx(db, [ITEMS_STORE], 'readwrite');
  const store = t.objectStore(ITEMS_STORE);
  const now = Date.now();
  const items: MediaItem[] = files.map((f) => ({
    id: newId(),
    blob: f,
    mimeType: f.type || 'image/jpeg',
    name: f.name || 'untitled',
    addedAt: now,
    setIds: [],
    source: { provider: 'upload' },
  }));
  for (const item of items) store.put(item);
  await new Promise<void>((res, rej) => {
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
  return items;
}

// Like addItems but for a stock-photo blob with attribution metadata
// already known. Used by the stock search panel.
export async function addStockItem(input: {
  blob: Blob;
  mimeType: string;
  name: string;
  source: MediaItemSource;
  setIds?: string[];
}): Promise<MediaItem> {
  const db = await openDb();
  const t = tx(db, [ITEMS_STORE], 'readwrite');
  const item: MediaItem = {
    id: newId(),
    blob: input.blob,
    mimeType: input.mimeType || 'image/jpeg',
    name: input.name,
    addedAt: Date.now(),
    setIds: input.setIds ?? [],
    source: input.source,
  };
  t.objectStore(ITEMS_STORE).put(item);
  await new Promise<void>((res, rej) => {
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
  return item;
}

export async function listItems(filter?: { setId?: string }): Promise<MediaItem[]> {
  const db = await openDb();
  const all = await reqToPromise(tx(db, [ITEMS_STORE], 'readonly').objectStore(ITEMS_STORE).getAll());
  const items = all as MediaItem[];
  items.sort((a, b) => b.addedAt - a.addedAt);
  if (!filter || !filter.setId) return items;
  return items.filter((i) => i.setIds.includes(filter.setId!));
}

export async function getItem(id: string): Promise<MediaItem | null> {
  const db = await openDb();
  const item = await reqToPromise(tx(db, [ITEMS_STORE], 'readonly').objectStore(ITEMS_STORE).get(id));
  return (item as MediaItem) || null;
}

export async function deleteItem(id: string): Promise<void> {
  const db = await openDb();
  const t = tx(db, [ITEMS_STORE], 'readwrite');
  t.objectStore(ITEMS_STORE).delete(id);
  await new Promise<void>((res, rej) => {
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
}

export async function setItemSetMembership(
  itemIds: string[],
  setId: string,
  member: boolean,
): Promise<void> {
  const db = await openDb();
  const t = tx(db, [ITEMS_STORE], 'readwrite');
  const store = t.objectStore(ITEMS_STORE);
  for (const id of itemIds) {
    const item = (await reqToPromise(store.get(id))) as MediaItem | undefined;
    if (!item) continue;
    const has = item.setIds.includes(setId);
    if (member && !has) item.setIds = [...item.setIds, setId];
    if (!member && has) item.setIds = item.setIds.filter((s) => s !== setId);
    store.put(item);
  }
  await new Promise<void>((res, rej) => {
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
}

export async function listSets(): Promise<MediaSet[]> {
  const db = await openDb();
  const all = await reqToPromise(tx(db, [SETS_STORE], 'readonly').objectStore(SETS_STORE).getAll());
  const sets = all as MediaSet[];
  sets.sort((a, b) => a.createdAt - b.createdAt);
  return sets;
}

export async function createSet(name: string): Promise<MediaSet> {
  const db = await openDb();
  const set: MediaSet = { id: newId(), name: name.trim() || 'Untitled library', createdAt: Date.now() };
  const t = tx(db, [SETS_STORE], 'readwrite');
  t.objectStore(SETS_STORE).put(set);
  await new Promise<void>((res, rej) => {
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
  return set;
}

export async function renameSet(id: string, name: string): Promise<void> {
  const db = await openDb();
  const t = tx(db, [SETS_STORE], 'readwrite');
  const store = t.objectStore(SETS_STORE);
  const set = (await reqToPromise(store.get(id))) as MediaSet | undefined;
  if (!set) return;
  set.name = name.trim() || set.name;
  store.put(set);
  await new Promise<void>((res, rej) => {
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
}

// Deletes a set and removes its id from every item's setIds. Items themselves
// are kept (they fall back to "All").
export async function deleteSet(id: string): Promise<void> {
  const db = await openDb();
  const t = tx(db, [SETS_STORE, ITEMS_STORE], 'readwrite');
  t.objectStore(SETS_STORE).delete(id);
  const itemsStore = t.objectStore(ITEMS_STORE);
  const items = (await reqToPromise(itemsStore.getAll())) as MediaItem[];
  for (const item of items) {
    if (item.setIds.includes(id)) {
      item.setIds = item.setIds.filter((s) => s !== id);
      itemsStore.put(item);
    }
  }
  await new Promise<void>((res, rej) => {
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function blobToObjectUrl(blob: Blob): string {
  return URL.createObjectURL(blob);
}
