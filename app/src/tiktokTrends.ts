// Parser + rollups for TikTok's account-level "Overview" analytics export
// (Settings → download, or TikTok Studio → Analytics). That file is one row
// PER DAY — Date, Video Views, Profile Views, Likes, Comments, Shares — for a
// trailing ~365-day window. It's account-wide totals, not per-post, so it
// powers a trends view (growth over time) rather than the per-post scorer.
//
// Pure: CSV text in, a structured summary out. No DOM, fully unit-testable.

export type TrendRow = {
  date: Date;
  label: string;        // the original "June 12" label from the file
  videoViews: number;
  profileViews: number;
  likes: number;
  comments: number;
  shares: number;
};

export type MonthBucket = {
  key: string;          // 'YYYY-MM'
  label: string;        // 'Apr 2026'
  videoViews: number;
  likes: number;
  comments: number;
  shares: number;
};

export type TrendSummary = {
  rows: TrendRow[];                 // chronological
  totals: { videoViews: number; profileViews: number; likes: number; comments: number; shares: number };
  activeDays: number;               // days with any engagement/views
  firstActive: Date | null;
  lastActive: Date | null;
  bestDay: TrendRow | null;         // max video views
  byMonth: MonthBucket[];
  engagementRate: number;           // (likes+comments+shares) / videoViews, 0 if no views
  // Momentum: trailing-30-days vs the 30 before that, in video views.
  last30: number;
  prev30: number;
  growthPct: number | null;         // null when prev30 is 0
};

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};
const MONTH_LABEL = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Minimal RFC-4180-ish CSV line splitter: handles "quoted" fields and commas
// inside quotes. TikTok quotes every field, but we stay tolerant of unquoted.
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function num(s: string): number {
  const n = Number(String(s ?? '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

// Parse "June 12" / "Jun 12" / "12 June" → { month, day } or null.
function parseMonthDay(label: string): { month: number; day: number } | null {
  const m = label.toLowerCase().match(/([a-z]+)\s*(\d{1,2})|(\d{1,2})\s*([a-z]+)/);
  if (!m) return null;
  const word = (m[1] || m[4] || '').slice(0, 3);
  const day = Number(m[2] || m[3]);
  const month = MONTHS[word];
  if (month == null || !day) return null;
  return { month, day };
}

// TikTok's date labels carry no year. The export is a trailing window ending
// at-or-near today, so we walk the rows in order, bump the year whenever the
// month rolls back (Dec→Jan), then shift the whole series so the LAST row is
// the most recent date that isn't in the future relative to `today`.
function assignYears(parsed: { month: number; day: number }[], today: Date): number[] {
  if (parsed.length === 0) return [];
  const offsets: number[] = [0];
  for (let i = 1; i < parsed.length; i++) {
    const prev = parsed[i - 1];
    const cur = parsed[i];
    offsets.push(offsets[i - 1] + (cur.month < prev.month ? 1 : 0));
  }
  // Anchor the last row: the newest year for which (month,day) is <= today.
  const last = parsed[parsed.length - 1];
  let lastYear = today.getFullYear();
  const asDate = (y: number) => new Date(y, last.month, last.day);
  if (asDate(lastYear).getTime() > startOfDay(today).getTime()) lastYear -= 1;
  const base = lastYear - offsets[offsets.length - 1];
  return offsets.map((o) => base + o);
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// Parse the Overview CSV into a chronological summary. `today` is injectable
// for deterministic tests.
export function parseTikTokOverview(text: string, today: Date = new Date()): TrendSummary {
  const clean = (text || '').replace(/^﻿/, ''); // strip BOM
  const lines = clean.split(/\r\n|\n|\r/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return emptySummary();

  // Header → column index, by name (tolerant of order/extra columns).
  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.findIndex((h) => h.includes(name));
  const iDate = col('date');
  const iViews = col('video view') >= 0 ? col('video view') : col('view');
  const iProfile = col('profile view');
  const iLikes = col('like');
  const iComments = col('comment');
  const iShares = col('share');
  if (iDate < 0) return emptySummary();

  const md: { month: number; day: number }[] = [];
  const raw: { label: string; v: number; p: number; l: number; c: number; s: number }[] = [];
  for (let r = 1; r < lines.length; r++) {
    const f = splitCsvLine(lines[r]);
    const label = (f[iDate] || '').trim();
    const parsed = parseMonthDay(label);
    if (!parsed) continue;
    md.push(parsed);
    raw.push({
      label,
      v: iViews >= 0 ? num(f[iViews]) : 0,
      p: iProfile >= 0 ? num(f[iProfile]) : 0,
      l: iLikes >= 0 ? num(f[iLikes]) : 0,
      c: iComments >= 0 ? num(f[iComments]) : 0,
      s: iShares >= 0 ? num(f[iShares]) : 0,
    });
  }
  if (raw.length === 0) return emptySummary();

  const years = assignYears(md, today);
  const rows: TrendRow[] = raw.map((x, i) => ({
    date: new Date(years[i], md[i].month, md[i].day),
    label: x.label,
    videoViews: x.v, profileViews: x.p, likes: x.l, comments: x.c, shares: x.s,
  }));

  const totals = rows.reduce(
    (a, r) => ({
      videoViews: a.videoViews + r.videoViews,
      profileViews: a.profileViews + r.profileViews,
      likes: a.likes + r.likes,
      comments: a.comments + r.comments,
      shares: a.shares + r.shares,
    }),
    { videoViews: 0, profileViews: 0, likes: 0, comments: 0, shares: 0 },
  );

  const active = rows.filter((r) => r.videoViews + r.likes + r.comments + r.shares > 0);
  const bestDay = rows.reduce<TrendRow | null>((best, r) => (!best || r.videoViews > best.videoViews ? r : best), null);

  // Monthly rollup.
  const monthMap = new Map<string, MonthBucket>();
  for (const r of rows) {
    const key = `${r.date.getFullYear()}-${String(r.date.getMonth() + 1).padStart(2, '0')}`;
    const b = monthMap.get(key) || { key, label: `${MONTH_LABEL[r.date.getMonth()]} ${r.date.getFullYear()}`, videoViews: 0, likes: 0, comments: 0, shares: 0 };
    b.videoViews += r.videoViews; b.likes += r.likes; b.comments += r.comments; b.shares += r.shares;
    monthMap.set(key, b);
  }
  const byMonth = Array.from(monthMap.values()).sort((a, b) => a.key.localeCompare(b.key));

  // Momentum: last 30 days vs the 30 before, anchored on the most recent row.
  const anchor = rows[rows.length - 1].date;
  const dayMs = 86_400_000;
  const windowSum = (startDaysAgo: number, endDaysAgo: number) => {
    const lo = anchor.getTime() - startDaysAgo * dayMs;
    const hi = anchor.getTime() - endDaysAgo * dayMs;
    return rows.filter((r) => r.date.getTime() > lo && r.date.getTime() <= hi).reduce((s, r) => s + r.videoViews, 0);
  };
  const last30 = windowSum(30, 0);
  const prev30 = windowSum(60, 30);

  return {
    rows,
    totals,
    activeDays: active.length,
    firstActive: active[0]?.date ?? null,
    lastActive: active[active.length - 1]?.date ?? null,
    bestDay: bestDay && bestDay.videoViews > 0 ? bestDay : null,
    byMonth,
    engagementRate: totals.videoViews > 0 ? (totals.likes + totals.comments + totals.shares) / totals.videoViews : 0,
    last30,
    prev30,
    growthPct: prev30 > 0 ? Math.round(((last30 - prev30) / prev30) * 100) : null,
  };
}

function emptySummary(): TrendSummary {
  return {
    rows: [], totals: { videoViews: 0, profileViews: 0, likes: 0, comments: 0, shares: 0 },
    activeDays: 0, firstActive: null, lastActive: null, bestDay: null, byMonth: [],
    engagementRate: 0, last30: 0, prev30: 0, growthPct: null,
  };
}
