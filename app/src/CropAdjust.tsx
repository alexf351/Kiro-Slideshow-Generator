import { useEffect, useRef, useState } from 'react';

// Per-photo crop adjuster. Shows the image in a 9:16 frame (matching a
// slide). Drag to pan, zoom to scale in. We size the image from its aspect
// ratio so that zooming creates real overflow in BOTH axes — then panning
// works vertically as well as horizontally (a wide photo at no-zoom only
// has horizontal room, since its full height already shows). The same
// background-size / background-position is applied by the engine on export,
// so this preview is WYSIWYG.

export type CropValue = { x: number; y: number; zoom: number; ar?: number; darken?: number };

export const DEFAULT_CROP: CropValue = { x: 50, y: 50, zoom: 1 };

const FRAME_AR = 9 / 16; // width / height, matches the slide

// Background-size (in % of the frame) so the image covers at zoom 1 and
// overflows both axes once zoomed in.
export function coverSizePct(ar: number, zoom: number): [number, number] {
  let sw: number;
  let sh: number;
  if (ar >= FRAME_AR) {
    sh = 100;
    sw = (ar / FRAME_AR) * 100;
  } else {
    sw = 100;
    sh = (FRAME_AR / ar) * 100;
  }
  return [sw * zoom, sh * zoom];
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export default function CropAdjust({
  url,
  value,
  onChange,
  onClose,
}: {
  url: string;
  value: CropValue;
  onChange: (v: CropValue) => void;
  onClose: () => void;
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const v = value || DEFAULT_CROP;
  const vRef = useRef(v);
  vRef.current = v;
  const [ar, setAr] = useState<number | undefined>(v.ar);

  // Read the image's natural aspect ratio so we can size it correctly and
  // persist it (the engine needs it to compute background-size on export).
  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const a = img.naturalWidth / img.naturalHeight;
      if (a > 0) {
        setAr(a);
        const cur = vRef.current;
        if (!cur.ar || Math.abs(cur.ar - a) > 0.001) onChange({ ...cur, ar: a });
      }
    };
    img.src = url;
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const effAr = ar || v.ar || FRAME_AR;
  const [sw, sh] = coverSizePct(effAr, v.zoom);

  function startDrag(e: React.PointerEvent) {
    e.preventDefault();
    const frame = frameRef.current?.getBoundingClientRect();
    if (!frame) return;
    const sx = e.clientX;
    const sy = e.clientY;
    const vx = v.x;
    const vy = v.y;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const move = (ev: PointerEvent) => {
      const dx = ((ev.clientX - sx) / frame.width) * 100 / v.zoom;
      const dy = ((ev.clientY - sy) / frame.height) * 100 / v.zoom;
      onChange({ ...vRef.current, x: clamp(vx - dx, 0, 100), y: clamp(vy - dy, 0, 100) });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  return (
    <div className="mt-2 rounded-xl border border-white/[0.10] bg-[#070b18] p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-gray-400">Adjust crop</div>
        <button
          type="button"
          onClick={() => onChange({ ...DEFAULT_CROP, ar: effAr })}
          className="text-[10px] font-bold uppercase tracking-[0.12em] text-gray-500 hover:text-[#00E5FF]"
        >
          Reset
        </button>
      </div>

      <div className="flex gap-3">
        {/* 9:16 draggable preview */}
        <div
          ref={frameRef}
          onPointerDown={startDrag}
          className="relative shrink-0 rounded-lg overflow-hidden border border-white/15 cursor-grab active:cursor-grabbing touch-none select-none bg-black"
          style={{
            width: 150,
            height: 267,
            backgroundImage: `url("${url}")`,
            backgroundRepeat: 'no-repeat',
            backgroundSize: `${sw}% ${sh}%`,
            backgroundPosition: `${v.x}% ${v.y}%`,
          }}
        >
          {/* WYSIWYG darken overlay — matches the engine's export. */}
          {(v.darken || 0) > 0 && (
            <div className="absolute inset-0 pointer-events-none" style={{ background: `rgba(0,0,0,${Math.min(0.85, v.darken || 0)})` }} />
          )}
        </div>

        {/* controls */}
        <div className="flex-1 flex flex-col justify-center gap-3">
          <p className="text-[11px] text-gray-500 leading-relaxed">
            Drag the photo to reposition it. To move it up/down, <strong className="text-gray-300">zoom in</strong> a little first — a wide photo already shows its full height.
          </p>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500 flex justify-between">
              <span>Zoom</span>
              <span className="text-gray-400 tabular-nums">{v.zoom.toFixed(2)}×</span>
            </span>
            <input
              type="range"
              min={1}
              max={3}
              step={0.05}
              value={v.zoom}
              onChange={(e) => onChange({ ...v, zoom: Number(e.target.value), ar: effAr })}
              className="w-full cursor-pointer"
              style={{ accentColor: '#00E5FF' }}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500 flex justify-between">
              <span>Darken</span>
              <span className="text-gray-400 tabular-nums">{Math.round((v.darken || 0) * 100)}%</span>
            </span>
            <input
              type="range"
              min={0}
              max={0.85}
              step={0.05}
              value={v.darken || 0}
              onChange={(e) => onChange({ ...v, darken: Number(e.target.value), ar: effAr })}
              className="w-full cursor-pointer"
              style={{ accentColor: '#00E5FF' }}
              title="Dim the photo so text stays readable"
            />
          </label>
          <button
            type="button"
            onClick={onClose}
            className="self-start px-3 py-1 rounded-md text-[10px] font-bold uppercase tracking-[0.14em] border border-[#00E5FF]/30 bg-[#0e2b3a] text-[#00E5FF] hover:bg-[#13384c]"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
