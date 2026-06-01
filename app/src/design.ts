// Brand kit + output format model. Drives the engine's optional `design`
// render payload (aspect ratio via --page-w/h, brand accent + background
// colors, and an optional watermark logo). Defaults reproduce the engine's
// historical 1080×1920 cyan-on-black look, so an untouched Design panel is
// a no-op.

export type AspectKey = '9:16' | '4:5' | '1:1' | '16:9';

export const ASPECTS: Record<AspectKey, { w: number; h: number; sub: string }> = {
  '9:16': { w: 1080, h: 1920, sub: 'TikTok · Reels · Shorts' },
  '4:5': { w: 1080, h: 1350, sub: 'Instagram feed' },
  '1:1': { w: 1080, h: 1080, sub: 'Square' },
  '16:9': { w: 1920, h: 1080, sub: 'YouTube · LinkedIn' },
};

export const ASPECT_KEYS = Object.keys(ASPECTS) as AspectKey[];

export type WatermarkPos = 'br' | 'bl' | 'tr' | 'tl';

export type BrandDesign = {
  aspect: AspectKey;
  accent: string; // hex
  bg: string;     // hex
  watermark: string; // data URL, or '' for none
  watermarkPos: WatermarkPos;
};

export const DEFAULT_DESIGN: BrandDesign = {
  aspect: '9:16',
  accent: '#00E5FF',
  bg: '#000000',
  watermark: '',
  watermarkPos: 'br',
};

// True when the design differs from engine defaults (used to badge the
// panel header so the user knows a brand kit is active).
export function isCustomDesign(d: BrandDesign): boolean {
  return (
    d.aspect !== DEFAULT_DESIGN.aspect ||
    d.accent.toLowerCase() !== DEFAULT_DESIGN.accent.toLowerCase() ||
    d.bg.toLowerCase() !== DEFAULT_DESIGN.bg.toLowerCase() ||
    !!d.watermark
  );
}

// Shape posted to the engine alongside `slides` on render.
export function designPayload(d: BrandDesign) {
  const a = ASPECTS[d.aspect] || ASPECTS['9:16'];
  return {
    pageW: a.w,
    pageH: a.h,
    accent: d.accent || DEFAULT_DESIGN.accent,
    bg: d.bg || DEFAULT_DESIGN.bg,
    watermark: d.watermark || undefined,
    watermarkPos: d.watermarkPos,
  };
}

// Validate a persisted blob back into a BrandDesign, repairing anything off.
export function coerceDesign(raw: unknown): BrandDesign {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Partial<BrandDesign>;
  const aspect = ASPECT_KEYS.includes(d.aspect as AspectKey) ? (d.aspect as AspectKey) : DEFAULT_DESIGN.aspect;
  const pos: WatermarkPos[] = ['br', 'bl', 'tr', 'tl'];
  return {
    aspect,
    accent: typeof d.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(d.accent) ? d.accent : DEFAULT_DESIGN.accent,
    bg: typeof d.bg === 'string' && /^#[0-9a-fA-F]{6}$/.test(d.bg) ? d.bg : DEFAULT_DESIGN.bg,
    watermark: typeof d.watermark === 'string' ? d.watermark : '',
    watermarkPos: pos.includes(d.watermarkPos as WatermarkPos) ? (d.watermarkPos as WatermarkPos) : 'br',
  };
}
