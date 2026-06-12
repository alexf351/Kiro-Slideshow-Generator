// Backup / restore + CSV export. With no backend, a creator's whole
// learning history (posts, scores, predictions, vision reads) and brand
// settings live in this one browser — one cleared cache from gone. This
// module serializes that to a portable JSON file and restores it.
//
// Scope: settings (minus API keys, which shouldn't travel in a plaintext
// file) + the post history (thumbnails inlined as data URLs). The media
// bank is intentionally excluded — those blobs are large and re-uploadable,
// whereas the post analytics are irreplaceable.

import { listPosts, importPosts, type Post } from './posts';
import { scorePost, hasStats, type ScoreBreakdown } from './scoring';

const SETTINGS_KEY = 'kiro_slideshow_generator_state_v2';
// Every BYOK secret persisted in the settings blob — MUST stay out of an
// exported backup file (it's shareable). Keep in sync with the keys written
// to SETTINGS_KEY in App.tsx.
const API_KEY_FIELDS = ['anthropicKey', 'openaiKey', 'pexelsKey', 'unsplashKey', 'pixabayKey'];

// Return a copy of a settings object with every API key removed. Pure +
// exported so the "secrets never hit a backup file" guarantee is testable.
export function stripSecrets(obj: Record<string, unknown>): Record<string, unknown> {
  const out = { ...obj };
  for (const k of API_KEY_FIELDS) delete out[k];
  return out;
}
const BACKUP_VERSION = 1;
// Other browser-local data worth backing up (irreplaceable, not in settings).
const DRAFTS_KEY = 'kiro_drafts';
const HASHTAG_SETS_KEY = 'kiro_hashtag_sets';
const FAV_FORMATS_KEY = 'kiro_fav_formats';

type BackupFile = {
  app: 'iro-slideshow-generator';
  version: number;
  exportedAt: number;
  settings: Record<string, unknown> | null;
  posts: SerializedPost[];
  // Drafts, hashtag sets, favorite formats (added in a later backup version).
  local?: { drafts?: unknown[]; hashtagSets?: unknown[]; favFormats?: unknown[] };
};

function readLocalArray(key: string): unknown[] {
  try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}

// Merge backed-up items into a localStorage array, deduping by `id` (current
// entries win on conflict). For plain-value arrays (no id), unions values.
function mergeLocalArray(key: string, incoming: unknown[]): void {
  if (!Array.isArray(incoming) || !incoming.length) return;
  try {
    const current = readLocalArray(key);
    const hasIds = incoming.every((x) => x && typeof x === 'object' && 'id' in (x as object));
    let merged: unknown[];
    if (hasIds) {
      const seen = new Set(current.map((x) => (x as { id: string }).id));
      merged = [...current, ...incoming.filter((x) => !seen.has((x as { id: string }).id))];
    } else {
      merged = Array.from(new Set([...current, ...incoming].map((x) => String(x)))) as unknown[];
    }
    localStorage.setItem(key, JSON.stringify(merged));
  } catch { /* best-effort */ }
}

// Post with its thumbnail Blob swapped for a data URL so it survives JSON.
type SerializedPost = Omit<Post, 'thumbnailBlob'> & { thumbnailDataUrl: string | null };

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return await res.blob();
}

function loadSettings(): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw) as Record<string, unknown>;
    // Strip secrets before they ever hit a file.
    return stripSecrets(obj);
  } catch {
    return null;
  }
}

export async function exportBackup(): Promise<Blob> {
  const posts = await listPosts();
  const serialized: SerializedPost[] = await Promise.all(
    posts.map(async (p) => {
      const { thumbnailBlob, ...rest } = p;
      const thumbnailDataUrl = thumbnailBlob ? await blobToDataUrl(thumbnailBlob) : null;
      return { ...rest, thumbnailDataUrl };
    }),
  );
  const file: BackupFile = {
    app: 'iro-slideshow-generator',
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    settings: loadSettings(),
    posts: serialized,
    local: {
      drafts: readLocalArray(DRAFTS_KEY),
      hashtagSets: readLocalArray(HASHTAG_SETS_KEY),
      favFormats: readLocalArray(FAV_FORMATS_KEY),
    },
  };
  return new Blob([JSON.stringify(file)], { type: 'application/json' });
}

export type ImportResult = { posts: number; settingsRestored: boolean };

// Restore a backup. Posts are merged by id (idempotent). Settings are
// merged into the current ones, but never overwrite existing API keys.
export async function importBackup(text: string): Promise<ImportResult> {
  let parsed: BackupFile;
  try {
    parsed = JSON.parse(text) as BackupFile;
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  if (!parsed || parsed.app !== 'iro-slideshow-generator') {
    throw new Error('This does not look like an Iro backup file.');
  }

  const posts = Array.isArray(parsed.posts) ? parsed.posts : [];
  const restored: Post[] = await Promise.all(
    posts.map(async (sp) => {
      const { thumbnailDataUrl, ...rest } = sp;
      // A single corrupt thumbnail data URL must not abort the whole
      // restore — fall back to no thumbnail and keep the post's data.
      let thumbnailBlob: Blob | null = null;
      if (thumbnailDataUrl) {
        try {
          thumbnailBlob = await dataUrlToBlob(thumbnailDataUrl);
        } catch {
          thumbnailBlob = null;
        }
      }
      return { ...(rest as Omit<Post, 'thumbnailBlob'>), thumbnailBlob } as Post;
    }),
  );
  const written = await importPosts(restored);

  let settingsRestored = false;
  if (parsed.settings && typeof parsed.settings === 'object') {
    try {
      const cur = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') as Record<string, unknown>;
      const merged = { ...parsed.settings, ...cur }; // current values (incl. keys) win
      // …except for non-key design/content fields where the backup should
      // take precedence — keep current API keys but accept the backup's rest.
      for (const [k, v] of Object.entries(parsed.settings)) {
        if (!API_KEY_FIELDS.includes(k)) merged[k] = v;
      }
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
      settingsRestored = true;
    } catch {
      // settings restore is best-effort; posts already landed.
    }
  }
  // Restore drafts / hashtag sets / favorites (merged, never destructive).
  if (parsed.local && typeof parsed.local === 'object') {
    if (Array.isArray(parsed.local.drafts)) mergeLocalArray(DRAFTS_KEY, parsed.local.drafts);
    if (Array.isArray(parsed.local.hashtagSets)) mergeLocalArray(HASHTAG_SETS_KEY, parsed.local.hashtagSets);
    if (Array.isArray(parsed.local.favFormats)) mergeLocalArray(FAV_FORMATS_KEY, parsed.local.favFormats);
  }

  return { posts: written, settingsRestored };
}

// Trigger a browser download of a blob.
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function timestampSlug(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

// ---------- Analytics CSV ----------

function csvCell(v: string | number): string {
  const s = String(v);
  // Quote when the cell contains a quote, comma, or any line break
  // (including a lone \r, which some parsers treat as a record terminator).
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// One row per post with stats + computed score, ready for a spreadsheet.
export function postsToCsv(posts: Post[]): string {
  const header = [
    'posted_at', 'origin', 'preset', 'niche', 'score', 'label',
    'views', 'likes', 'comments', 'shares', 'saves', 'photo_views',
    'predicted_score', 'caption', 'tiktok_url',
  ];
  const rows = posts.map((p) => {
    const b: ScoreBreakdown | null = hasStats(p) ? scorePost(p, posts) : null;
    return [
      new Date(p.postedAt).toISOString(),
      p.origin || 'manual',
      p.preset || '',
      p.niche || '',
      b ? b.score : '',
      b ? b.label : '',
      p.stats.views || 0,
      p.stats.likes || 0,
      p.stats.comments || 0,
      p.stats.shares || 0,
      p.stats.saves || 0,
      p.stats.photoViews || 0,
      p.prediction ? p.prediction.score : '',
      p.caption || '',
      p.tiktokUrl || '',
    ].map(csvCell).join(',');
  });
  return [header.join(','), ...rows].join('\n');
}
