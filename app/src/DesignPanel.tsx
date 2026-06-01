// "Design" sidebar card — output format + brand kit. Sets the export
// aspect ratio (TikTok 9:16, IG 4:5, square, YouTube 16:9), brand accent +
// background colors, and an optional watermark/logo. Everything flows to
// the engine via the render message's `design` payload; defaults are a
// no-op so existing posts look identical.

import { useRef, useState } from 'react';
import {
  ASPECTS,
  ASPECT_KEYS,
  DEFAULT_DESIGN,
  isCustomDesign,
  type AspectKey,
  type BrandDesign,
  type WatermarkPos,
} from './design';

type Props = {
  design: BrandDesign;
  onChange: (d: BrandDesign) => void;
};

const POS_OPTIONS: { key: WatermarkPos; label: string }[] = [
  { key: 'br', label: 'Bottom-right' },
  { key: 'bl', label: 'Bottom-left' },
  { key: 'tr', label: 'Top-right' },
  { key: 'tl', label: 'Top-left' },
];

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export default function DesignPanel({ design, onChange }: Props) {
  const [expanded, setExpanded] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const set = (patch: Partial<BrandDesign>) => onChange({ ...design, ...patch });
  const custom = isCustomDesign(design);

  async function handleWatermarkFile(file: File) {
    if (!file.type.startsWith('image/')) {
      window.alert('Pick an image file (PNG with transparency works best).');
      return;
    }
    try {
      set({ watermark: await fileToDataUrl(file) });
    } catch {
      window.alert('Could not read that image.');
    }
  }

  const colorRow = (label: string, value: string, onColor: (hex: string) => void) => (
    <label className="flex items-center justify-between gap-3">
      <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-gray-400">{label}</span>
      <span className="flex items-center gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => {
            const v = e.target.value.trim();
            if (/^#[0-9a-fA-F]{0,6}$/.test(v)) onColor(v);
          }}
          spellCheck={false}
          className="w-24 bg-[#070b18] border border-white/[0.10] rounded-md px-2 py-1.5 text-xs font-mono text-gray-200 focus:border-[#F472B6]/40 focus:outline-none"
        />
        <input
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000'}
          onChange={(e) => onColor(e.target.value)}
          className="w-8 h-8 rounded-md border border-white/10 bg-transparent cursor-pointer"
        />
      </span>
    </label>
  );

  return (
    <div className="rounded-2xl border border-[#F472B6]/25 bg-gradient-to-br from-[#2a1320] to-[#160a11] p-4 md:p-5">
      <button type="button" onClick={() => setExpanded((v) => !v)} className="w-full flex items-center justify-between text-left">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-[#F472B6]/15 text-[#F472B6] text-base">◐</span>
          <div>
            <div className="text-[13px] font-bold uppercase tracking-[0.18em] text-[#F472B6]">Design &amp; brand</div>
            <div className="text-[11px] text-gray-500 mt-0.5">
              Aspect ratio · brand colors · watermark
            </div>
          </div>
        </div>
        <span className="flex items-center gap-2">
          {custom && <span className="text-[9px] uppercase tracking-[0.14em] text-[#F472B6] bg-[#F472B6]/10 px-1.5 py-0.5 rounded">on</span>}
          <span className="text-gray-500 text-xs">{expanded ? '▾' : '▸'}</span>
        </span>
      </button>

      {expanded && (
        <div className="mt-4 flex flex-col gap-4">
          {/* Aspect ratio */}
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-gray-500 mb-2">Output size</div>
            <div className="grid grid-cols-2 gap-2">
              {ASPECT_KEYS.map((k: AspectKey) => {
                const active = design.aspect === k;
                const a = ASPECTS[k];
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => set({ aspect: k })}
                    className={
                      'px-3 py-2.5 rounded-lg text-left border transition-colors ' +
                      (active
                        ? 'border-[#F472B6]/60 bg-[#F472B6]/10'
                        : 'border-white/[0.07] bg-[#0b1224]/60 hover:border-white/[0.16]')
                    }
                  >
                    <div className={'text-[13px] font-bold ' + (active ? 'text-[#F472B6]' : 'text-gray-200')}>
                      {k}
                      {k !== '9:16' && (
                        <span className="ml-1.5 text-[8px] uppercase tracking-[0.12em] text-amber-300/70">beta</span>
                      )}
                    </div>
                    <div className="text-[10px] text-gray-500 mt-0.5">{a.sub} · {a.w}×{a.h}</div>
                  </button>
                );
              })}
            </div>
            {design.aspect !== '9:16' && (
              <p className="mt-2 text-[10px] text-amber-300/70 leading-relaxed">
                Layouts are tuned for 9:16 — other ratios export at the right size but may need the visual editor to
                fine-tune text placement.
              </p>
            )}
          </div>

          {/* Brand colors */}
          <div className="flex flex-col gap-2.5">
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-gray-500">Brand colors</div>
            {colorRow('Accent', design.accent, (hex) => set({ accent: hex }))}
            {colorRow('Background', design.bg, (hex) => set({ bg: hex }))}
          </div>

          {/* Watermark */}
          <div className="flex flex-col gap-2">
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-gray-500">Watermark / logo</div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleWatermarkFile(f);
                e.target.value = '';
              }}
            />
            <div className="flex items-center gap-3">
              <div className="shrink-0 w-16 h-16 rounded-lg border border-white/[0.10] bg-[#070b18] flex items-center justify-center overflow-hidden">
                {design.watermark ? (
                  <img src={design.watermark} alt="watermark" className="max-w-full max-h-full object-contain" />
                ) : (
                  <span className="text-[9px] uppercase tracking-[0.14em] text-gray-700">none</span>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-[0.14em] bg-[#F472B6]/15 text-[#F472B6] hover:bg-[#F472B6]/25"
                >
                  {design.watermark ? 'Replace' : 'Upload logo'}
                </button>
                {design.watermark && (
                  <button
                    type="button"
                    onClick={() => set({ watermark: '' })}
                    className="px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-[0.14em] text-gray-400 hover:text-gray-200 border border-white/10"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
            {design.watermark && (
              <select
                value={design.watermarkPos}
                onChange={(e) => set({ watermarkPos: e.target.value as WatermarkPos })}
                className="bg-[#070b18] border border-white/[0.10] rounded-md px-2 py-2 text-xs text-gray-200 focus:border-[#F472B6]/40 focus:outline-none"
              >
                {POS_OPTIONS.map((p) => (
                  <option key={p.key} value={p.key}>{p.label}</option>
                ))}
              </select>
            )}
          </div>

          {custom && (
            <button
              type="button"
              onClick={() => onChange({ ...DEFAULT_DESIGN })}
              className="text-[11px] font-bold uppercase tracking-[0.14em] text-gray-500 hover:text-[#F472B6] self-start"
            >
              Reset to default ↺
            </button>
          )}
        </div>
      )}
    </div>
  );
}
