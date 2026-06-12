// Performance → CSV export. The app scores posts and rolls up "what's
// working", but a creator often wants their own numbers in a spreadsheet —
// to pivot, chart, or share with a collaborator who doesn't have the app.
// This flattens the post history (stats + the engine's computed score) into
// a single CSV the Analytics/Settings panel can download.
//
// Pure: takes the post array, returns a string. The score columns reuse
// scoring.ts so the CSV matches exactly what the in-app Analytics shows.

import type { Post } from './posts';
import { scorePost, SCORE_LABEL_TEXT } from './scoring';

// RFC 4180 field quoting: wrap in double-quotes and double any embedded
// quotes whenever the value contains a comma, quote, or newline. Numbers
// and clean strings pass through bare.
export function csvCell(value: string | number): string {
  const s = String(value ?? '');
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function csvRow(cells: (string | number)[]): string {
  return cells.map(csvCell).join(',');
}

// ISO date (YYYY-MM-DD HH:MM) in the viewer's locale-agnostic UTC, so the
// column sorts lexically and survives reopening anywhere.
function fmtDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
}

const HEADERS = [
  'Posted (UTC)', 'Format', 'Niche', 'Origin', 'Hook', 'Caption',
  'Views', 'Likes', 'Comments', 'Shares', 'Saves', 'Photo views',
  'Engagement %', 'Save %', 'Share %',
  'Score', 'Label', 'Predicted', 'TikTok URL',
];

function pct(n: number): string {
  return (n * 100).toFixed(2);
}

function hookOf(caption: string): string {
  for (const raw of (caption || '').split('\n')) {
    const line = raw.trim();
    if (line) return line;
  }
  return '';
}

// Build the full CSV for the given posts (newest first, matching listPosts).
// Scores are computed relative to the whole population, exactly as the
// Analytics view does. Always returns at least the header row so an empty
// history still produces a valid, openable file.
export function postsToCsv(posts: Post[]): string {
  const rows = [csvRow(HEADERS)];
  for (const p of posts) {
    const s = p.stats || ({} as Post['stats']);
    const b = scorePost(p, posts);
    rows.push(csvRow([
      fmtDate(p.postedAt),
      p.preset || '',
      p.niche || '',
      p.origin || 'manual',
      hookOf(p.caption),
      p.caption || '',
      s.views || 0,
      s.likes || 0,
      s.comments || 0,
      s.shares || 0,
      s.saves || 0,
      s.photoViews || 0,
      pct(b.engagementRate),
      pct(b.saveRate),
      pct(b.shareRate),
      b.score,
      SCORE_LABEL_TEXT[b.label],
      p.prediction ? p.prediction.score : '',
      p.tiktokUrl || '',
    ]));
  }
  // CRLF per RFC 4180 — the most broadly compatible across Excel/Sheets.
  return rows.join('\r\n') + '\r\n';
}
