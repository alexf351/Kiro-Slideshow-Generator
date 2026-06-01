// IndexedDB-backed history of posted slideshows. Each Post is a snapshot of
// the JSON + mascot/platform that was rendered, plus a small thumbnail we
// capture from the engine and a manual stats block the user fills in after
// they actually post on TikTok.
//
// Lives in the same DB as the media bank (`kiro_media_bank`) — adding the
// `posts` store just requires bumping the DB version and creating it in
// the upgrade callback. Existing items + sets are left alone.

const DB_NAME = 'kiro_media_bank';
const DB_VERSION = 2;
const ITEMS_STORE = 'items';
const SETS_STORE = 'sets';
const POSTS_STORE = 'posts';

export type PostStats = {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  // Photo-carousel only: total photo views (how many photos got swiped
  // through across all viewers). A high ratio vs `views` means the
  // carousel held attention. 0 for video posts / when unknown. Older
  // stored posts predate this field — read it defensively as `|| 0`.
  photoViews: number;
};

// A score the predictor assigned to a post BEFORE it was published, so
// we can later compare the prediction against the actual performance
// score and track how well-calibrated the engine is over time.
export type PostPrediction = {
  score: number;                       // 0-100 predicted performance
  confidence: 'low' | 'medium' | 'high';
  rationale: string;                   // one-paragraph "why this number"
  strengths: string[];                 // what should help it perform
  risks: string[];                     // what might sink it
  suggestions: string[];               // concrete pre-publish tweaks
  predictedAt: number;
  source: 'api' | 'manual' | 'heuristic';
  model?: string;
};

// Claude's vision read of one of the user's OWN published posts: the
// on-screen text it pulled off each slide photo plus a structural read.
// This is what lets the engine "swipe photo by photo and read the text"
// so a self-post can be scored + fed back into the predictor's context.
export type SelfAnalysis = {
  slideTexts: string[];   // on-screen text per slide, in render order
  hookText: string;       // the opening hook (slide 1) text
  hookStyle: string;      // question / stat / confession / POV / ...
  niche: string;
  voiceTone: string;
  contentSummary: string; // one paragraph: what it is + why it might land
  analyzedAt: number;
  source: 'api' | 'manual';
};

// Structural fingerprint Claude extracted when the post was generated
// (clone or propose). Persisted on the Post so the Patterns view can
// re-show what worked + the Propose flow can read it back as context
// for fresh angles.
export type CloneAnalysisSnapshot = {
  structuralFingerprint: string;
  hookStyle: string;
  density: string;
  ctaShape: string;
  niche: string;
  voiceTone: string;
};

export type Post = {
  id: string;
  postedAt: number;
  caption: string;
  tiktokUrl: string;
  jsonSnapshot: string;
  mascot: string;
  platform: string;
  thumbnailBlob: Blob | null;
  stats: PostStats;
  // Added in patterns-library milestone — all optional, so existing
  // posts from before the schema change keep loading cleanly.
  preset?: string;
  sourceTikTokUrl?: string;  // for clones: the URL we cloned. for proposals/manual: ''
  cloneAnalysis?: CloneAnalysisSnapshot | null;
  niche?: string;             // duplicated from cloneAnalysis.niche for cheap filtering
  // 'self' = one of the user's own published posts, imported + vision-read
  // for scoring. The other origins describe how a draft was authored.
  origin?: 'manual' | 'clone' | 'propose' | 'self';
  // Added in the prediction-engine milestone — all optional so posts
  // saved before the schema change keep loading cleanly.
  prediction?: PostPrediction | null;   // what the engine guessed pre-publish
  selfAnalysis?: SelfAnalysis | null;    // vision read of an imported self-post
};

export const ZERO_STATS: PostStats = { views: 0, likes: 0, comments: 0, shares: 0, saves: 0, photoViews: 0 };

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // Re-create the existing stores defensively so a fresh install at v2
      // still works. The mediaBank module also calls open() — the first
      // caller wins; either path creates everything.
      if (!db.objectStoreNames.contains(ITEMS_STORE)) db.createObjectStore(ITEMS_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(SETS_STORE)) db.createObjectStore(SETS_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(POSTS_STORE)) db.createObjectStore(POSTS_STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
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

export async function addPost(input: Omit<Post, 'id' | 'postedAt' | 'stats'> & { stats?: PostStats }): Promise<Post> {
  const db = await openDb();
  const post: Post = {
    id: newId(),
    postedAt: Date.now(),
    caption: input.caption,
    tiktokUrl: input.tiktokUrl ?? '',
    jsonSnapshot: input.jsonSnapshot,
    mascot: input.mascot,
    platform: input.platform,
    thumbnailBlob: input.thumbnailBlob,
    stats: input.stats ?? { ...ZERO_STATS },
    preset: input.preset,
    sourceTikTokUrl: input.sourceTikTokUrl,
    cloneAnalysis: input.cloneAnalysis ?? null,
    niche: input.niche ?? input.cloneAnalysis?.niche,
    origin: input.origin ?? 'manual',
    prediction: input.prediction ?? null,
    selfAnalysis: input.selfAnalysis ?? null,
  };
  const t = db.transaction([POSTS_STORE], 'readwrite');
  t.objectStore(POSTS_STORE).put(post);
  await new Promise<void>((res, rej) => {
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
  return post;
}

export async function listPosts(): Promise<Post[]> {
  const db = await openDb();
  const all = (await reqToPromise(db.transaction([POSTS_STORE], 'readonly').objectStore(POSTS_STORE).getAll())) as Post[];
  // Newest first.
  all.sort((a, b) => b.postedAt - a.postedAt);
  return all;
}

export async function updatePost(id: string, patch: Partial<Omit<Post, 'id'>>): Promise<void> {
  const db = await openDb();
  const t = db.transaction([POSTS_STORE], 'readwrite');
  const store = t.objectStore(POSTS_STORE);
  const existing = (await reqToPromise(store.get(id))) as Post | undefined;
  if (!existing) return;
  const merged: Post = {
    ...existing,
    ...patch,
    stats: patch.stats ? { ...existing.stats, ...patch.stats } : existing.stats,
  };
  store.put(merged);
  await new Promise<void>((res, rej) => {
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
}

export async function deletePost(id: string): Promise<void> {
  const db = await openDb();
  const t = db.transaction([POSTS_STORE], 'readwrite');
  t.objectStore(POSTS_STORE).delete(id);
  await new Promise<void>((res, rej) => {
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
}

// Bulk-restore posts from a backup, preserving their original ids (so a
// re-import is idempotent rather than duplicating). Existing posts with
// the same id are overwritten. Returns how many were written.
export async function importPosts(posts: Post[]): Promise<number> {
  const db = await openDb();
  const t = db.transaction([POSTS_STORE], 'readwrite');
  const store = t.objectStore(POSTS_STORE);
  let n = 0;
  for (const p of posts) {
    if (!p || typeof p.id !== 'string') continue;
    store.put(p);
    n++;
  }
  await new Promise<void>((res, rej) => {
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
  return n;
}

export function sumStats(posts: Post[]): PostStats {
  return posts.reduce(
    (acc, p) => ({
      views: acc.views + (p.stats.views || 0),
      likes: acc.likes + (p.stats.likes || 0),
      comments: acc.comments + (p.stats.comments || 0),
      shares: acc.shares + (p.stats.shares || 0),
      saves: acc.saves + (p.stats.saves || 0),
      photoViews: acc.photoViews + (p.stats.photoViews || 0),
    }),
    { ...ZERO_STATS },
  );
}
