// Shared retry policy for the slide-upload path (TikTok inbox send + phone
// QR handoff). A multi-slide send fetches each slide separately, so one
// transient network blip or 5xx shouldn't sink the whole batch — these decide
// what's worth retrying and how long to wait. Pure + tested; the fetch loop
// that uses them lives in App.

// A status worth retrying: 0 = our sentinel for a thrown/network error,
// 408 request timeout, 429 rate limit, and any 5xx server error.
export function isTransientStatus(status: number): boolean {
  return status === 0 || status === 408 || status === 429 || (status >= 500 && status <= 599);
}

// Exponential backoff (attempt is 0-based), capped so a retry never stalls
// the UI for too long.
export function backoffMs(attempt: number): number {
  return Math.min(8000, 500 * 2 ** Math.max(0, attempt));
}
