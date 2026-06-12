// Posting-plan → calendar export. A creator who schedules drafts on the
// in-app calendar still has to remember to actually open the app on the
// right day. This turns every scheduled (not-yet-posted) draft into a real
// VEVENT so the plan lands in Google / Apple / Outlook Calendar with a
// reminder — the schedule follows them out of the app.
//
// Pure string generation against RFC 5545, so it's deterministic and
// unit-testable with no DOM. The UI (App) feeds in drafts and downloads
// the returned text as an .ics file.

import type { Draft } from './drafts';

// RFC 5545 TEXT escaping: backslash, semicolon, comma, and newlines are
// special inside a property value.
function escapeText(s: string): string {
  return (s || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\n|\r/g, '\\n');
}

// UTC timestamp in iCalendar's basic format: 20260612T143000Z.
function toIcsUtc(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

// Fold lines to <=75 octets per RFC 5545 (continuation lines start with a
// space). We approximate octets with chars — fine for the ASCII-ish content
// here, and over-folding is harmless. Operates on a single already-built line.
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let rest = line;
  parts.push(rest.slice(0, 75));
  rest = rest.slice(75);
  while (rest.length > 74) {
    parts.push(' ' + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  if (rest.length) parts.push(' ' + rest);
  return parts.join('\r\n');
}

// The first non-empty line of the caption — the hook — makes the most
// useful event title ("Post: <hook>"). Falls back to the draft name.
function eventTitle(d: Draft): string {
  const caption = d.state?.caption || '';
  for (const raw of caption.split('\n')) {
    const line = raw.trim();
    if (line) return line.length > 60 ? line.slice(0, 57) + '…' : line;
  }
  return d.name || 'Untitled post';
}

export type IcsOptions = {
  // Default event duration. TikTok posting is an instant, but a zero-length
  // event renders oddly in some calendars, so we give it a short window.
  durationMinutes?: number;
  // Minutes-before-event reminder (VALARM). 0 / undefined = no alarm.
  reminderMinutes?: number;
  calendarName?: string;
};

// Build an iCalendar document for every scheduled, not-yet-posted draft.
// Returns null when there's nothing to export so the caller can show a
// friendly "schedule something first" message instead of an empty file.
export function buildIcs(drafts: Draft[], opts: IcsOptions = {}): string | null {
  const { durationMinutes = 15, reminderMinutes = 30, calendarName = 'iro posting plan' } = opts;
  const planned = drafts.filter((d) => d.scheduledFor && !d.posted);
  if (planned.length === 0) return null;

  const stamp = toIcsUtc(Date.now());
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//iro studio//posting plan//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(calendarName)}`,
  ];

  for (const d of planned) {
    const start = d.scheduledFor!;
    const end = start + durationMinutes * 60_000;
    const title = eventTitle(d);
    const caption = (d.state?.caption || '').trim();
    const desc = caption
      ? `Caption:\n${caption}\n\n— scheduled in iro studio`
      : 'Scheduled in iro studio';
    lines.push('BEGIN:VEVENT');
    // Stable UID so re-importing an updated export updates the event in
    // place rather than duplicating it.
    lines.push(`UID:${d.id}@iro-studio`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART:${toIcsUtc(start)}`);
    lines.push(`DTEND:${toIcsUtc(end)}`);
    lines.push(foldLine(`SUMMARY:📲 Post: ${escapeText(title)}`));
    lines.push(foldLine(`DESCRIPTION:${escapeText(desc)}`));
    if (reminderMinutes && reminderMinutes > 0) {
      lines.push('BEGIN:VALARM');
      lines.push('ACTION:DISPLAY');
      lines.push(`DESCRIPTION:${escapeText(`Time to post: ${title}`)}`);
      lines.push(`TRIGGER:-PT${Math.round(reminderMinutes)}M`);
      lines.push('END:VALARM');
    }
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  // RFC 5545 mandates CRLF line endings.
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

// How many drafts would be included — lets the UI label the button and
// decide whether it's worth enabling.
export function scheduledCount(drafts: Draft[]): number {
  return drafts.filter((d) => d.scheduledFor && !d.posted).length;
}
