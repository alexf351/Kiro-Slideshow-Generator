// Quick Edit — a structured, no-JSON editor for the slides. It parses the
// current JSON into labeled fields (hook, each content slide, CTA) and
// writes edits straight back, so a creator never has to touch raw JSON or
// worry about a stray comma.
//
// It's preset-agnostic on purpose: instead of hard-coding each format's
// schema, it edits every *string* field it finds on the hook object, the
// content array (prompts / beats / panels / features / items / apps —
// whichever exists), and the CTA. Add / remove / reorder act on the
// content array. Non-string and nested values (bg, icons, numbers) are
// left untouched.

import { useMemo, useRef } from 'react';

type Props = {
  jsonText: string;
  onChange: (nextJsonText: string) => void;
};

type Parsed = Record<string, unknown>;

// Mirror of App.stripJsonWrappers so pasted `const SLIDES = …` / fenced
// blobs still parse here.
function stripWrappers(t: string): string {
  return t
    .replace(/^\s*(const|let|var)\s+SLIDES\s*=\s*/, '')
    .replace(/;\s*$/, '')
    .replace(/^```(?:json|javascript|js)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
}

// Unwrap a full clone/propose payload ({ preset, slides, caption, … }) to its
// inner slide content so a pasted clone object edits cleanly instead of
// showing nothing.
function unwrap(v: unknown): Parsed | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Parsed;
  const hasContentTop = ['hook', ...CONTENT_KEYS].some((k) => k in o);
  if (!hasContentTop && o.slides && typeof o.slides === 'object' && !Array.isArray(o.slides)) {
    return o.slides as Parsed;
  }
  return o;
}

function tryParse(t: string): Parsed | null {
  const s = stripWrappers(t.trim());
  if (!s) return null;
  try {
    return unwrap(JSON.parse(s));
  } catch {
    try {
      return unwrap(new Function('return (' + s + ')')() as unknown);
    } catch {
      return null;
    }
  }
}

// Content arrays, in priority order — the first one present is "the slides".
const CONTENT_KEYS = ['prompts', 'beats', 'panels', 'features', 'items', 'apps', 'tools', 'picks'] as const;
// Fields we never surface as text inputs (backgrounds, icons live elsewhere).
// `layout` is the app_stack arrangement keyword (set by dblclick in the
// preview), not copy — hide it along with the media fields.
const SKIP_FIELDS = new Set(['bg', 'iconUrl', 'icon', 'logoUrl', 'layout']);

function stringFields(obj: unknown): string[] {
  if (!obj || typeof obj !== 'object') return [];
  return Object.keys(obj as Record<string, unknown>).filter(
    (k) => typeof (obj as Record<string, unknown>)[k] === 'string' && !SKIP_FIELDS.has(k),
  );
}

function prettyLabel(k: string): string {
  return k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
}

// Longer copy gets a textarea; short labels get an input.
function isLong(field: string): boolean {
  return ['prompt', 'text', 'sub', 'slogan', 'supporting', 'subline', 'bottom', 'top'].includes(field);
}

export default function QuickEdit({ jsonText, onChange }: Props) {
  const parsed = useMemo(() => tryParse(jsonText), [jsonText]);

  if (!parsed) {
    return (
      <div className="text-[11px] text-amber-300/80 leading-relaxed">
        The JSON below can't be parsed right now, so Quick Edit is paused. Fix it (or load a default) and the fields
        come back.
      </div>
    );
  }

  const contentKey = CONTENT_KEYS.find((k) => Array.isArray(parsed[k])) || null;
  const items = contentKey ? (parsed[contentKey] as Record<string, unknown>[]) : [];

  // Deep-clone, mutate, re-stringify, push up. Cheap for slide-sized objects.
  function commit(mutate: (draft: Parsed) => void) {
    const draft = JSON.parse(JSON.stringify(parsed)) as Parsed;
    mutate(draft);
    onChange(JSON.stringify(draft, null, 2));
  }

  function setField(path: { section: 'hook' | 'cta' | 'item'; index?: number; field: string }, value: string) {
    commit((draft) => {
      if (path.section === 'hook') {
        draft.hook = { ...(draft.hook as object), [path.field]: value };
      } else if (path.section === 'cta') {
        draft.cta = { ...(draft.cta as object), [path.field]: value };
      } else if (path.section === 'item' && contentKey && typeof path.index === 'number') {
        const arr = (draft[contentKey] as Record<string, unknown>[]).slice();
        arr[path.index] = { ...arr[path.index], [path.field]: value };
        draft[contentKey] = arr;
      }
    });
  }

  function addItem() {
    if (!contentKey) return;
    commit((draft) => {
      const arr = (draft[contentKey] as Record<string, unknown>[]).slice();
      const template = arr[arr.length - 1] || arr[0] || {};
      const blank: Record<string, unknown> = {};
      for (const k of Object.keys(template)) {
        blank[k] = typeof template[k] === 'string' ? '' : template[k];
      }
      arr.push(blank);
      draft[contentKey] = arr;
    });
  }

  function removeItem(i: number) {
    if (!contentKey) return;
    commit((draft) => {
      const arr = (draft[contentKey] as Record<string, unknown>[]).slice();
      arr.splice(i, 1);
      draft[contentKey] = arr;
    });
  }

  function moveItem(i: number, dir: -1 | 1) {
    if (!contentKey) return;
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    commit((draft) => {
      const arr = (draft[contentKey] as Record<string, unknown>[]).slice();
      [arr[i], arr[j]] = [arr[j], arr[i]];
      draft[contentKey] = arr;
    });
  }

  const hookFields = stringFields(parsed.hook);
  const ctaFields = stringFields(parsed.cta);

  const card = 'rounded-xl border border-white/[0.08] bg-[#0b1224]/60 p-3';

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] text-gray-500 leading-relaxed">
        Edit the copy directly — changes write back to the JSON below and render on the next “Render slides”. HTML like
        <code className="mx-1 text-gray-400">&lt;strong&gt;</code> in a field is kept.
      </p>

      {/* Hook */}
      {!!parsed.hook && hookFields.length > 0 && (
        <div className={card}>
          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#00E5FF] mb-2">Hook</div>
          <div className="flex flex-col gap-2">
            {hookFields.map((f) => (
              <Field
                key={`hook-${f}`}
                field={f}
                value={String((parsed.hook as Record<string, unknown>)[f] ?? '')}
                onVal={(v) => setField({ section: 'hook', field: f }, v)}
              />
            ))}
          </div>
          {(parsed as { preset?: string }).preset === 'prompt_pack' &&
            typeof (parsed.hook as Record<string, unknown>).sub === 'string' && (
            (() => {
              const raw = Number((parsed.hook as Record<string, unknown>).subEmphasis);
              const emphasis = Number.isFinite(raw) ? raw : 30;
              return (
                <label className="mt-3 flex flex-col gap-1">
                  <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500 flex justify-between">
                    <span>Save-bait visibility</span>
                    <span className="text-gray-400 tabular-nums">{emphasis}</span>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={emphasis}
                    onChange={(e) =>
                      commit((draft) => {
                        draft.hook = { ...(draft.hook as object), subEmphasis: Number(e.target.value) };
                      })
                    }
                    className="w-full cursor-pointer"
                    style={{ accentColor: '#00E5FF' }}
                  />
                  <span className="text-[10px] text-gray-600">Brightens &amp; bolds the “save these…” line so it reads on busy photos.</span>
                </label>
              );
            })()
          )}
        </div>
      )}

      {/* Content slides */}
      {contentKey && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-gray-400">
              Slides · {prettyLabel(contentKey)} <span className="text-gray-600">· {items.length}</span>
            </div>
            <button
              type="button"
              onClick={addItem}
              aria-label="Add a slide"
              className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] rounded-md bg-[#00E5FF]/15 text-[#00E5FF] hover:bg-[#00E5FF]/25"
            >
              + Add
            </button>
          </div>
          {items.map((item, i) => {
            const fields = stringFields(item);
            return (
              <div key={i} className={card}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">#{i + 1}</span>
                  <span className="flex gap-1">
                    <button type="button" onClick={() => moveItem(i, -1)} disabled={i === 0} aria-label={`Move slide ${i + 1} up`} title="Move up"
                      className="px-1.5 py-0.5 text-[11px] rounded text-gray-400 hover:text-gray-200 disabled:opacity-30">↑</button>
                    <button type="button" onClick={() => moveItem(i, 1)} disabled={i === items.length - 1} aria-label={`Move slide ${i + 1} down`} title="Move down"
                      className="px-1.5 py-0.5 text-[11px] rounded text-gray-400 hover:text-gray-200 disabled:opacity-30">↓</button>
                    <button type="button" onClick={() => removeItem(i)} aria-label={`Remove slide ${i + 1}`} title="Remove slide"
                      className="px-1.5 py-0.5 text-[11px] rounded text-red-300 hover:text-red-200">✕</button>
                  </span>
                </div>
                <div className="flex flex-col gap-2">
                  {fields.map((f) => (
                    <Field
                      key={`item-${i}-${f}`}
                      field={f}
                      value={String(item[f] ?? '')}
                      onVal={(v) => setField({ section: 'item', index: i, field: f }, v)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* CTA */}
      {!!parsed.cta && ctaFields.length > 0 && (
        <div className={card}>
          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#FFC857] mb-2">CTA</div>
          <div className="flex flex-col gap-2">
            {ctaFields.map((f) => (
              <Field
                key={`cta-${f}`}
                field={f}
                value={String((parsed.cta as Record<string, unknown>)[f] ?? '')}
                onVal={(v) => setField({ section: 'cta', field: f }, v)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// One labeled field with a Bold button that wraps the current text selection
// (or the whole value, if nothing is selected) in <strong>…</strong> — so a
// creator can emphasize words without ever typing an HTML tag.
function Field({ field, value, onVal }: { field: string; value: string; onVal: (v: string) => void }) {
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const long = isLong(field);

  function bold() {
    const el = ref.current;
    const start = el?.selectionStart ?? 0;
    const end = el?.selectionEnd ?? 0;
    if (!el || start === end) {
      // No selection — bold the whole field (unless it's already wrapped).
      onVal(/^<strong>[\s\S]*<\/strong>$/.test(value.trim()) ? value : `<strong>${value}</strong>`);
      return;
    }
    onVal(value.slice(0, start) + '<strong>' + value.slice(start, end) + '</strong>' + value.slice(end));
  }

  const inputCls =
    'flex-1 bg-[#070b18] border border-white/[0.10] rounded-md px-2.5 py-1.5 text-[13px] text-gray-200 focus:border-[#00E5FF]/50 focus:outline-none';

  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-center justify-between">
        <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-gray-500">{prettyLabel(field)}</span>
        <button
          type="button"
          onClick={bold}
          aria-label={`Bold ${prettyLabel(field)}`}
          title="Bold the selected text"
          className="px-1.5 leading-none text-[11px] font-black text-gray-500 hover:text-[#00E5FF]"
        >
          B
        </button>
      </span>
      {long ? (
        <textarea ref={ref} value={value} onChange={(e) => onVal(e.target.value)} rows={2} className={inputCls + ' resize-y'} />
      ) : (
        <input ref={ref} value={value} onChange={(e) => onVal(e.target.value)} className={inputCls} />
      )}
    </label>
  );
}
