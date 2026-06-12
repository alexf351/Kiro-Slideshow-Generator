// Named drafts — lets a creator keep a library of in-progress posts instead
// of a single working slot. Each draft is a snapshot of the editable content
// (JSON, caption, preset, per-slide media + crops, handle settings), stored
// in localStorage. Distinct from "posts" (published/archived with analytics).

export type DraftState = {
  jsonText: string;
  caption: string;
  preset: string;
  slideBgs: Record<string, unknown>;
  slideBgAdjust: Record<string, unknown>;
  attribution: string;
  attrPresets: Record<string, boolean>;
};

export type Draft = { id: string; name: string; savedAt: number; state: DraftState };

const KEY = 'kiro_drafts';
const MAX = 60;

export function listDrafts(): Draft[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as Draft[];
    return Array.isArray(arr) ? arr.sort((a, b) => b.savedAt - a.savedAt) : [];
  } catch {
    return [];
  }
}

function write(drafts: Draft[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(drafts.slice(0, MAX))); } catch {}
}

// Save a new draft, or overwrite an existing one with the same (case-insensitive)
// name so re-saving a project updates it instead of piling up duplicates.
export function saveDraft(name: string, state: DraftState): Draft[] {
  const clean = name.trim() || `Draft ${new Date().toLocaleString()}`;
  const drafts = listDrafts();
  const existing = drafts.find((d) => d.name.toLowerCase() === clean.toLowerCase());
  if (existing) {
    existing.state = state;
    existing.savedAt = Date.now();
  } else {
    drafts.unshift({ id: 'd' + Date.now() + Math.random().toString(36).slice(2, 6), name: clean, savedAt: Date.now(), state });
  }
  write(drafts);
  return listDrafts();
}

export function deleteDraft(id: string): Draft[] {
  write(listDrafts().filter((d) => d.id !== id));
  return listDrafts();
}

export function renameDraft(id: string, name: string): Draft[] {
  const drafts = listDrafts();
  const d = drafts.find((x) => x.id === id);
  if (d) { d.name = name.trim() || d.name; write(drafts); }
  return listDrafts();
}
