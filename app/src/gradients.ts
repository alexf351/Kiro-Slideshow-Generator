// Curated CSS gradient backgrounds. The engine paints any slide whose `bg`
// (or the top-level `background`) is a gradient string directly, so these can
// be applied across formats with zero engine work — an instant aesthetic
// background that needs no photo or stock API.

export type Gradient = { name: string; css: string | null };

export const GRADIENTS: Gradient[] = [
  { name: 'Default', css: null },
  { name: 'Gold', css: 'linear-gradient(180deg, #f0c75e 0%, #7a4f12 100%)' },
  { name: 'Amber', css: 'linear-gradient(180deg, #f4a63c 0%, #5a2f0a 100%)' },
  { name: 'Ember', css: 'linear-gradient(180deg, #f0703c 0%, #3a1208 100%)' },
  { name: 'Coral', css: 'linear-gradient(180deg, #f55f5a 0%, #45101c 100%)' },
  { name: 'Crimson', css: 'linear-gradient(180deg, #e23a52 0%, #380810 100%)' },
  { name: 'Rose', css: 'linear-gradient(180deg, #f0608f 0%, #380e28 100%)' },
  { name: 'Magenta', css: 'linear-gradient(180deg, #cc46d4 0%, #340e3e 100%)' },
  { name: 'Plum', css: 'linear-gradient(180deg, #9a44cc 0%, #2a0a3a 100%)' },
  { name: 'Violet', css: 'linear-gradient(180deg, #8a54f0 0%, #261050 100%)' },
  { name: 'Indigo', css: 'linear-gradient(180deg, #5560f0 0%, #141a4a 100%)' },
  { name: 'Royal', css: 'linear-gradient(180deg, #3f6ed9 0%, #0e1a44 100%)' },
  { name: 'Sky', css: 'linear-gradient(180deg, #36a6e8 0%, #0a2748 100%)' },
  { name: 'Ocean', css: 'linear-gradient(180deg, #1f86c0 0%, #06223a 100%)' },
  { name: 'Cyan', css: 'linear-gradient(180deg, #28c2d4 0%, #06303a 100%)' },
  { name: 'Teal', css: 'linear-gradient(180deg, #1fbf9c 0%, #06231f 100%)' },
  { name: 'Emerald', css: 'linear-gradient(180deg, #2fbf5a 0%, #0a2718 100%)' },
  { name: 'Lime', css: 'linear-gradient(180deg, #93c63c 0%, #1c2a08 100%)' },
  { name: 'Sunset', css: 'linear-gradient(160deg, #ff8a4c 0%, #c33c6e 50%, #3a1030 100%)' },
  { name: 'Aurora', css: 'linear-gradient(160deg, #2bd4c0 0%, #3f6ed9 55%, #2a1050 100%)' },
  { name: 'Slate', css: 'linear-gradient(180deg, #5a6678 0%, #161d24 100%)' },
  { name: 'Midnight', css: 'linear-gradient(180deg, #2a3656 0%, #070b14 100%)' },
  { name: 'Charcoal', css: 'linear-gradient(180deg, #2e333c 0%, #0a0c10 100%)' },
];

// Flat solid backgrounds (encoded as flat gradients so they go through the
// same engine path with no extra support). Kept rich/dark so the formats'
// light slide text stays readable.
const solid = (hex: string): string => `linear-gradient(180deg, ${hex} 0%, ${hex} 100%)`;

export const SOLID_BGS: { name: string; hex: string; css: string }[] = [
  { name: 'Black', hex: '#0a0a0c' },
  { name: 'Ink', hex: '#10131c' },
  { name: 'Navy', hex: '#101b3a' },
  { name: 'Royal', hex: '#1b3a8c' },
  { name: 'Teal', hex: '#0e3b3a' },
  { name: 'Forest', hex: '#123524' },
  { name: 'Olive', hex: '#2c2f17' },
  { name: 'Mustard', hex: '#7a5a14' },
  { name: 'Rust', hex: '#7a2f16' },
  { name: 'Brick', hex: '#5e1620' },
  { name: 'Wine', hex: '#3f1028' },
  { name: 'Plum', hex: '#2e1140' },
  { name: 'Indigo', hex: '#241b52' },
  { name: 'Slate', hex: '#222831' },
  { name: 'Espresso', hex: '#241712' },
  { name: 'Pine', hex: '#0d2a24' },
].map((s) => ({ ...s, css: solid(s.hex) }));
