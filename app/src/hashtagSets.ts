// Saved hashtag sets — a creator reuses the same niche hashtag blocks across
// posts. Save the current caption's hashtags under a name, then one-tap append
// them to any future caption. localStorage-backed.

export type HashtagSet = { id: string; name: string; tags: string[] };

const KEY = 'kiro_hashtag_sets';
const MAX = 40;

export function listSets(): HashtagSet[] {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? (JSON.parse(raw) as HashtagSet[]) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function write(sets: HashtagSet[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(sets.slice(0, MAX))); } catch {}
}

// Save (or overwrite by name). Tags are stored without the leading '#'.
export function saveSet(name: string, tags: string[]): HashtagSet[] {
  const clean = name.trim();
  const norm = Array.from(new Set(tags.map((t) => t.replace(/^#/, '').trim()).filter(Boolean)));
  if (!clean || !norm.length) return listSets();
  const sets = listSets();
  const existing = sets.find((s) => s.name.toLowerCase() === clean.toLowerCase());
  if (existing) existing.tags = norm;
  else sets.unshift({ id: 'h' + Date.now() + Math.random().toString(36).slice(2, 6), name: clean, tags: norm });
  write(sets);
  return listSets();
}

export function deleteSet(id: string): HashtagSet[] {
  write(listSets().filter((s) => s.id !== id));
  return listSets();
}

export function formatTags(tags: string[]): string {
  return tags.map((t) => '#' + t).join(' ');
}
