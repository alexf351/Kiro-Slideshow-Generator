// Auto-scheduling. After batch-generating a week of drafts, hand-picking a
// date for each on the calendar is tedious — this spreads N drafts across
// consecutive days at a fixed posting hour, turning a pile of drafts into a
// posting plan in one tap (which then flows into the calendar .ics export).
//
// Pure (count + start in, dates out). Uses local date components so the
// posting hour means the creator's local time, and the Date constructor
// rolls month/year boundaries for us.

export function scheduleDates(
  n: number,
  startDate: Date,
  hour = 18,
  perDay = 1,
): Date[] {
  const out: Date[] = [];
  const pd = Math.max(1, Math.floor(perDay));
  const h = Math.max(0, Math.min(23, Math.floor(hour)));
  for (let i = 0; i < Math.max(0, n); i++) {
    const dayOffset = Math.floor(i / pd);
    out.push(new Date(
      startDate.getFullYear(),
      startDate.getMonth(),
      startDate.getDate() + dayOffset,
      h, 0, 0, 0,
    ));
  }
  return out;
}

// Convenience: the dates to assign starting tomorrow at `hour`. Kept separate
// from scheduleDates so the spreading math stays pure/testable while the
// "from tomorrow" default lives here.
export function planFromTomorrow(n: number, now: Date = new Date(), hour = 18, perDay = 1): Date[] {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return scheduleDates(n, start, hour, perDay);
}

// Local-day key so two timestamps on the same calendar day collapse.
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// Spread `n` posts onto the next FREE days from tomorrow, skipping any day
// that's already taken by an existing scheduled draft — so auto-scheduling a
// batch doesn't double-book days the creator already planned.
export function planAroundExisting(n: number, taken: Date[], now: Date = new Date(), hour = 18): Date[] {
  const takenKeys = new Set((taken || []).map(dayKey));
  const h = Math.max(0, Math.min(23, Math.floor(hour)));
  const out: Date[] = [];
  let offset = 1;
  while (out.length < Math.max(0, n) && offset <= 400) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, h, 0, 0, 0);
    if (!takenKeys.has(dayKey(d))) out.push(d);
    offset++;
  }
  return out;
}
