import { useRef } from 'react';

// Per-photo crop adjuster. Shows the image in a 9:16 frame (matching a
// slide) with the TikTok safe zone overlaid, so you can drag the photo to
// pan and zoom in until the subject sits inside the safe area. The same
// background-position / scale is applied by the engine on export, so this
// preview is WYSIWYG.

export type CropValue = { x: number; y: number; zoom: number };

export const DEFAULT_CROP: CropValue = { x: 50, y: 50, zoom: 1 };

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
      // Drag the photo with the finger: moving right reveals the left of
      // the image, i.e. object-position x decreases. Sensitivity scaled by
      // zoom so it feels consistent when zoomed in.
      const dx = ((ev.clientX - sx) / frame.width) * 100 / v.zoom;
      const dy = ((ev.clientY - sy) / frame.height) * 100 / v.zoom;
      onChange({ x: clamp(vx - dx, 0, 100), y: clamp(vy - dy, 0, 100), zoom: v.zoom });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      void ev;
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
          onClick={() => onChange({ ...DEFAULT_CROP })}
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
          style={{ width: 150, height: 267 }}
        >
          <img
            src={url}
            alt=""
            draggable={false}
            className="absolute inset-0 w-full h-full object-cover pointer-events-none"
            style={{ objectPosition: `${v.x}% ${v.y}%`, transform: `scale(${v.zoom})` }}
          />
          {/* TikTok safe zone (matches the engine: top 10 / bottom 30 / left 5 / right 14) */}
          <div
            className="absolute border-2 border-dashed border-white/80 rounded pointer-events-none"
            style={{ top: '10%', bottom: '30%', left: '5%', right: '14%', boxShadow: '0 0 0 999px rgba(255,45,45,0.18)' }}
          />
        </div>

        {/* controls */}
        <div className="flex-1 flex flex-col justify-center gap-3">
          <p className="text-[11px] text-gray-500 leading-relaxed">
            Drag the photo to reposition it. Keep the subject inside the dashed box so TikTok’s UI doesn’t cover it.
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
              onChange={(e) => onChange({ ...v, zoom: Number(e.target.value) })}
              className="w-full cursor-pointer"
              style={{ accentColor: '#00E5FF' }}
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
