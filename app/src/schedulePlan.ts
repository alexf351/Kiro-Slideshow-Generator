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
