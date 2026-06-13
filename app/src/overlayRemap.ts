// Remap on-slide overlays (pasted photos + text) when the slide ORDER changes.
//
// Overlays live in the engine keyed by absolute slide index
// ({ [slideIndex]: [overlay, …] }). When the creator reorders/adds/removes/
// duplicates content slides, the content moves but those numeric keys don't —
// so a photo snipped onto slide 3 stays on slide 3 even though its slide moved.
// This recomputes the keys so overlays follow their slide.
//
// Pure (no DOM): the engine's current overlays + a description of how the
// content array changed → the new overlay map. App captures the overlays,
// runs this, and pushes the result back after the re-render. Unit-tested.

export type Overlay = { id?: string;[k: string]: unknown };
export type OverlayMap = Record<string, Overlay[]>;

function cloneList(list: Overlay[], nextId: () => string): Overlay[] {
  return list.map((o) => ({ ...(JSON.parse(JSON.stringify(o)) as Overlay), id: nextId() }));
}

// `hookOffset`  — how many slides precede the content block (1 if the deck
//                 renders a hook slide first, else 0).
// `oldLen`      — content-item count before the change.
// `newOrder`    — the new content array expressed in OLD indices; -1 marks a
//                 freshly-inserted blank item. Examples:
//                 move 1↔2 of 4: [0,2,1,3]; remove 2: [0,1,3];
//                 append: [0,1,2,3,-1]; duplicate 1: [0,1,1,2,3].
export function remapOverlays(
  overlays: OverlayMap,
  hookOffset: number,
  oldLen: number,
  newOrder: number[],
  nextId: () => string = () => 'o' + Math.random().toString(36).slice(2, 9),
): OverlayMap {
  const newLen = newOrder.length;
  const trailingShift = newLen - oldLen;

  // old content index -> the new position(s) it lands at (duplicate => 2+).
  const positionsFor = new Map<number, number[]>();
  newOrder.forEach((q, p) => {
    if (q < 0) return;
    const arr = positionsFor.get(q) || [];
    arr.push(p);
    positionsFor.set(q, arr);
  });

  const out: OverlayMap = {};
  for (const key of Object.keys(overlays)) {
    const k = Number(key);
    const list = overlays[key];
    if (!Number.isInteger(k) || k < 0 || !Array.isArray(list) || list.length === 0) continue;

    if (k < hookOffset) {
      out[k] = list; // hook (and anything before content) stays put
    } else if (k < hookOffset + oldLen) {
      const positions = positionsFor.get(k - hookOffset);
      if (!positions) continue; // this content slide was removed → drop its overlays
      positions.forEach((p, i) => {
        // The original slide keeps the live overlays; extra copies (from a
        // duplicate) get fresh ids so two slides don't share DOM ids.
        out[String(hookOffset + p)] = i === 0 ? list : cloneList(list, nextId);
      });
    } else {
      out[String(k + trailingShift)] = list; // cta / trailing slides shift
    }
  }
  return out;
}
