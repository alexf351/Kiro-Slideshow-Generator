// Dedicated editor for the "Output vs Hype" format. The generic Quick
// Edit only surfaces string fields, but this format's whole point is the
// per-tool logo + the two numeric bars + the accent tint, so it gets a
// purpose-built panel: a logo control, Output/Hype sliders, an accent
// swatch per tool, and a background-gradient picker for the whole set.
//
// Like QuickEdit, it parses the JSON, mutates a clone, and writes the
// pretty-printed result back up — the JSON box stays the source of truth.

type Tool = {
  name?: string;
  logoUrl?: string;
  accent?: string;
  output?: number;
  hype?: number;
  [k: string]: unknown;
};

type Parsed = {
  hook?: { headline?: string; sub?: string; [k: string]: unknown };
  tools?: Tool[];
  bgGradient?: string;
  [k: string]: unknown;
};

type Props = {
  jsonText: string;
  onChange: (next: string) => void;
  // Logo lives in the per-slide background system (key `tool-logo:i`) so
  // it gets the same upload / paste-URL / proxy treatment as photos.
  logoThumb: (i: number) => string | undefined;
  onPickLogo: (i: number, name: string) => void;
  onPasteLogo: (i: number) => void;
  onClearLogoBg: (i: number) => void;
};

// Background gradients offered in the picker. `null` = the engine's
// default dark radial. Kept to a calm, on-brand dark palette plus a few
// tinted options so text + bars stay legible.
const BG_GRADIENTS: { name: string; css: string | null }[] = [
  { name: 'Default', css: null },
  { name: 'Midnight', css: 'linear-gradient(180deg, #0b1220 0%, #060810 100%)' },
  { name: 'Plum', css: 'linear-gradient(180deg, #1a1030 0%, #0a0716 100%)' },
  { name: 'Ocean', css: 'linear-gradient(180deg, #07223a 0%, #04101d 100%)' },
  { name: 'Forest', css: 'linear-gradient(180deg, #0a2018 0%, #050d0a 100%)' },
  { name: 'Ember', css: 'linear-gradient(180deg, #2a1206 0%, #120804 100%)' },
  { name: 'Slate', css: 'linear-gradient(180deg, #1b2026 0%, #0a0d11 100%)' },
  { name: 'Aurora', css: 'linear-gradient(160deg, #0b1020 0%, #102a3a 55%, #0a0716 100%)' },
  { name: 'Berry', css: 'linear-gradient(160deg, #2a0a1e 0%, #120414 100%)' },
];

const ACCENTS = ['#D97757', '#22D3EE', '#F5707A', '#5B8DEF', '#E5E7EB', '#34D399', '#A78BFA', '#FBBF24', '#FB7185', '#F97316'];

const ENGINE_DEFAULT_BG = 'radial-gradient(120% 80% at 50% 0%, #11151f 0%, #07090e 70%, #050608 100%)';

function tryParse(txt: string): Parsed | null {
  try {
    const o = JSON.parse(txt) as unknown;
    if (o && typeof o === 'object') return o as Parsed;
  } catch {}
  return null;
}

function clampInt(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  if (!isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export default function HypeEditor({ jsonText, onChange, logoThumb, onPickLogo, onPasteLogo, onClearLogoBg }: Props) {
  const parsed = tryParse(jsonText);

  if (!parsed) {
    return (
      <div className="text-[11px] text-amber-300/80 leading-relaxed">
        The JSON can't be parsed right now, so this editor is paused. Fix it (or reload the example) and the controls come back.
      </div>
    );
  }

  const tools: Tool[] = Array.isArray(parsed.tools) ? parsed.tools : [];

  function commit(mutate: (draft: Parsed) => void) {
    const draft = JSON.parse(JSON.stringify(parsed)) as Parsed;
    if (!Array.isArray(draft.tools)) draft.tools = [];
    mutate(draft);
    onChange(JSON.stringify(draft, null, 2));
  }

  function setTool(i: number, patch: Partial<Tool>) {
    commit((draft) => {
      const arr = draft.tools as Tool[];
      arr[i] = { ...arr[i], ...patch };
    });
  }

  function addTool() {
    commit((draft) => {
      const arr = draft.tools as Tool[];
      const last = arr[arr.length - 1];
      arr.push({ name: '', logoUrl: '', accent: ACCENTS[arr.length % ACCENTS.length], output: 70, hype: 60, ...(last ? {} : {}) });
    });
  }

  function removeTool(i: number) {
    onClearLogoBg(i);
    commit((draft) => {
      (draft.tools as Tool[]).splice(i, 1);
    });
  }

  function moveTool(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= tools.length) return;
    commit((draft) => {
      const arr = draft.tools as Tool[];
      [arr[i], arr[j]] = [arr[j], arr[i]];
    });
  }

  function setHook(field: 'headline' | 'sub', value: string) {
    commit((draft) => {
      draft.hook = { ...(draft.hook as object), [field]: value };
    });
  }

  function setBgGradient(css: string | null) {
    commit((draft) => {
      if (css) draft.bgGradient = css;
      else delete draft.bgGradient;
    });
  }

  const card = 'rounded-xl border border-white/[0.08] bg-[#0b1224]/60 p-3';
  const inputCls =
    'w-full bg-[#070b18] border border-white/[0.10] rounded-md px-2.5 py-1.5 text-sm text-gray-200 placeholder:text-gray-700 focus:border-[#00E5FF]/40 focus:outline-none';
  const miniBtn =
    'px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-[0.12em] border border-white/10 bg-white/[0.04] text-gray-300 hover:text-white hover:border-white/25 transition-colors';

  const currentBg = typeof parsed.bgGradient === 'string' ? parsed.bgGradient : null;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[11px] text-gray-500 leading-relaxed">
        Add a logo, drag the sliders to set how each tool scores on <strong className="text-gray-300">Output</strong> vs{' '}
        <strong className="text-gray-300">Hype</strong>, and pick a background. Changes render on the next “Render slides”.
      </p>

      {/* Background gradient picker */}
      <div className={card}>
        <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-gray-400 mb-2">Background</div>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {BG_GRADIENTS.map((g) => {
            const active = (g.css ?? null) === currentBg;
            return (
              <button
                key={g.name}
                type="button"
                onClick={() => setBgGradient(g.css)}
                title={g.name}
                className={
                  'relative h-12 rounded-lg overflow-hidden border transition-all ' +
                  (active ? 'border-[#00E5FF] shadow-[0_0_0_2px_rgba(0,229,255,0.4)]' : 'border-white/10 hover:border-white/30')
                }
                style={{ background: g.css ?? ENGINE_DEFAULT_BG }}
              >
                <span className="absolute bottom-0 inset-x-0 text-[9px] font-bold uppercase tracking-[0.1em] text-white/85 bg-black/40 py-0.5">
                  {g.name}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Optional hook (title slide) */}
      <div className={card}>
        <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#00E5FF] mb-2">Title slide (optional)</div>
        <div className="flex flex-col gap-2">
          <input
            className={inputCls}
            placeholder="Headline — e.g. Output vs Hype"
            value={String(parsed.hook?.headline ?? '')}
            onChange={(e) => setHook('headline', e.target.value)}
          />
          <input
            className={inputCls}
            placeholder="Subline — e.g. what AI tools actually deliver."
            value={String(parsed.hook?.sub ?? '')}
            onChange={(e) => setHook('sub', e.target.value)}
          />
        </div>
      </div>

      {/* Tools */}
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-gray-400">
          Tools <span className="text-gray-600">· {tools.length}</span>
        </div>
        <button type="button" onClick={addTool} className={miniBtn}>
          + Add tool
        </button>
      </div>

      <div className="flex flex-col gap-3">
        {tools.map((t, i) => {
          const accent = t.accent || '#00E5FF';
          const output = clampInt(t.output, 60);
          const hype = clampInt(t.hype, 60);
          const thumb = logoThumb(i) || (t.logoUrl ? String(t.logoUrl) : '');
          const initial = (t.name || '?').trim().charAt(0).toUpperCase() || '?';
          return (
            <div key={i} className={card}>
              {/* top row: logo + name + reorder/delete */}
              <div className="flex items-center gap-3">
                {thumb ? (
                  <img
                    src={thumb}
                    alt=""
                    className="w-12 h-12 rounded-xl object-contain bg-white/[0.04] border border-white/10 shrink-0"
                  />
                ) : (
                  <div
                    className="w-12 h-12 rounded-xl shrink-0 flex items-center justify-center text-lg font-black text-white border border-white/10"
                    style={{ background: accent + '22' }}
                  >
                    {initial}
                  </div>
                )}
                <input
                  className={inputCls + ' flex-1'}
                  placeholder={`Tool ${i + 1} name`}
                  value={String(t.name ?? '')}
                  onChange={(e) => setTool(i, { name: e.target.value })}
                />
                <div className="flex flex-col gap-0.5 shrink-0">
                  <button type="button" onClick={() => moveTool(i, -1)} disabled={i === 0} className="text-gray-500 hover:text-white disabled:opacity-25 leading-none text-xs">▲</button>
                  <button type="button" onClick={() => moveTool(i, 1)} disabled={i === tools.length - 1} className="text-gray-500 hover:text-white disabled:opacity-25 leading-none text-xs">▼</button>
                </div>
                <button type="button" onClick={() => removeTool(i)} title="Remove tool" className="shrink-0 text-gray-600 hover:text-red-400 text-lg leading-none">×</button>
              </div>

              {/* logo controls */}
              <div className="flex flex-wrap gap-1.5 mt-2">
                <button type="button" onClick={() => onPickLogo(i, t.name || `Tool ${i + 1}`)} className={miniBtn}>
                  {thumb ? 'Change logo' : 'Add logo'}
                </button>
                <button type="button" onClick={() => onPasteLogo(i)} className={miniBtn}>
                  Paste URL
                </button>
                {thumb && (
                  <button
                    type="button"
                    onClick={() => { onClearLogoBg(i); setTool(i, { logoUrl: '' }); }}
                    className={miniBtn + ' hover:!text-red-300 hover:!border-red-400/40'}
                  >
                    Remove logo
                  </button>
                )}
              </div>

              {/* Output / Hype sliders */}
              <div className="mt-3 flex flex-col gap-2.5">
                {([
                  { key: 'output' as const, label: 'Output', val: output },
                  { key: 'hype' as const, label: 'Hype', val: hype },
                ]).map(({ key, label, val }) => (
                  <div key={key} className="flex items-center gap-3">
                    <span className="w-14 text-[11px] font-bold uppercase tracking-[0.1em] text-gray-400 shrink-0">{label}</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={val}
                      onChange={(e) => setTool(i, { [key]: Number(e.target.value) })}
                      className="flex-1 h-1.5 cursor-pointer"
                      style={{ accentColor: accent }}
                    />
                    <span className="w-9 text-right text-xs font-mono tabular-nums text-gray-300 shrink-0">{val}</span>
                  </div>
                ))}
                {/* which-is-higher hint */}
                <div className="text-[10px] text-gray-600">
                  {output === hype
                    ? 'Output and Hype are equal — nudge one so the bars differ.'
                    : output > hype
                      ? `Output leads by ${output - hype} — this tool over-delivers.`
                      : `Hype leads by ${hype - output} — this tool is overhyped.`}
                </div>
              </div>

              {/* accent color */}
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-gray-500">Color</span>
                {ACCENTS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setTool(i, { accent: c })}
                    title={c}
                    className={
                      'w-5 h-5 rounded-full border transition-transform hover:scale-110 ' +
                      (String(t.accent).toLowerCase() === c.toLowerCase() ? 'border-white shadow-[0_0_0_2px_rgba(255,255,255,0.3)]' : 'border-white/20')
                    }
                    style={{ background: c }}
                  />
                ))}
                <label className="ml-1 inline-flex items-center" title="Custom color">
                  <input
                    type="color"
                    value={/^#[0-9a-fA-F]{6}$/.test(accent) ? accent : '#00E5FF'}
                    onChange={(e) => setTool(i, { accent: e.target.value })}
                    className="w-5 h-5 rounded-full bg-transparent border border-white/20 cursor-pointer p-0"
                  />
                </label>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
