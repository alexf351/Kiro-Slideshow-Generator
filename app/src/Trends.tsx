// Account Trends tab — import TikTok's daily "Overview" analytics export
// (Date + Video Views / Profile Views / Likes / Comments / Shares) and chart
// the account's growth over time. This is account-wide daily data, NOT
// per-post — so it answers "how is the account trending" rather than "which
// post won" (that's the Performance tab). The raw CSV is cached in
// localStorage so it survives reloads.

import { useMemo, useRef, useState } from 'react';
import { parseTikTokOverview, type TrendSummary } from './tiktokTrends';

const STORE_KEY = 'kiro_trends_csv';

function loadRaw(): string {
  try { return localStorage.getItem(STORE_KEY) || ''; } catch { return ''; }
}

// 1234 → "1.2K", 1_250_000 → "1.3M".
function compact(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '') + 'K';
  return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
}

const METRICS = [
  { key: 'videoViews', label: 'Views', color: '#00E5FF' },
  { key: 'likes', label: 'Likes', color: '#FF4D7D' },
  { key: 'comments', label: 'Comments', color: '#FFC857' },
  { key: 'shares', label: 'Shares', color: '#34D399' },
  { key: 'profileViews', label: 'Profile', color: '#A78BFA' },
] as const;
type MetricKey = (typeof METRICS)[number]['key'];

function fmtDate(d: Date | null): string {
  return d ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
}

// Dependency-free line chart scaled to the series' own max.
function LineChart({ values, color, height = 160 }: { values: number[]; color: string; height?: number }) {
  const w = 760, h = height, pad = 6;
  if (values.length < 2) return <div className="text-[12px] text-gray-600 py-8 text-center">Not enough data to chart.</div>;
  const max = Math.max(1, ...values);
  const n = values.length;
  const x = (i: number) => pad + (i / (n - 1)) * (w - pad * 2);
  const y = (v: number) => pad + (1 - v / max) * (h - pad * 2);
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${x(0).toFixed(1)},${h - pad} ${pts} ${x(n - 1).toFixed(1)},${h - pad}`;
  const gid = 'tg-' + color.replace('#', '');
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.30" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${gid})`} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export default function Trends() {
  const [raw, setRaw] = useState<string>(loadRaw);
  const [metric, setMetric] = useState<MetricKey>('videoViews');
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const summary: TrendSummary | null = useMemo(() => {
    if (!raw) return null;
    try {
      const s = parseTikTokOverview(raw);
      return s.rows.length ? s : null;
    } catch { return null; }
  }, [raw]);

  function ingest(text: string) {
    const s = parseTikTokOverview(text);
    if (!s.rows.length) {
      setError("Couldn't find any dated rows. Make sure it's the TikTok Overview export (Date, Video Views, Likes…).");
      return;
    }
    try { localStorage.setItem(STORE_KEY, text); } catch { /* quota — still show it this session */ }
    setError(null);
    setRaw(text);
  }

  function onFile(file: File) {
    if (/\.xlsx$/i.test(file.name)) {
      setError('Upload the .csv version (the .xlsx has the same data). In the TikTok export, pick CSV — or open the xlsx and “Save As” CSV.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => ingest(String(reader.result || ''));
    reader.onerror = () => setError('Could not read that file.');
    reader.readAsText(file);
  }

  function clearData() {
    try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
    setRaw('');
    setError(null);
  }

  const accent = METRICS.find((m) => m.key === metric)!.color;

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 px-5 md:px-8 pt-4 pb-3 border-b border-white/[0.06]">
        <div className="flex items-baseline gap-2.5">
          <h2 className="text-lg font-black tracking-tight text-white">Account Trends</h2>
          <span className="text-[10px] font-bold uppercase tracking-[0.28em] text-[#00E5FF]">daily overview</span>
          {summary && (
            <button type="button" onClick={() => fileRef.current?.click()} className="ml-auto text-[10px] font-bold uppercase tracking-[0.12em] text-gray-500 hover:text-[#00E5FF]">Replace</button>
          )}
          {summary && (
            <button type="button" onClick={clearData} className="text-[10px] font-bold uppercase tracking-[0.12em] text-gray-600 hover:text-red-400">Clear</button>
          )}
        </div>
        <p className="text-[12px] text-gray-500 leading-relaxed mt-1">
          Your whole-account performance over time (not per-post — that's the Performance tab).
        </p>
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 md:p-6">
        {error && <div className="mb-3 text-[12px] text-amber-300/90 bg-amber-400/[0.06] border border-amber-400/20 rounded-lg px-3 py-2">{error}</div>}

        {!summary ? (
          <div className="max-w-lg mx-auto mt-6">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-full rounded-2xl border-2 border-dashed border-white/15 hover:border-[#00E5FF]/50 bg-white/[0.02] p-10 text-center transition-colors"
            >
              <div className="text-3xl mb-2">📈</div>
              <div className="text-sm font-bold text-gray-200">Import your TikTok analytics</div>
              <div className="text-[12px] text-gray-500 mt-1">Click to choose your Overview <strong className="text-gray-400">.csv</strong></div>
            </button>
            <div className="mt-5 text-[12px] text-gray-500 leading-relaxed">
              <div className="font-bold text-gray-400 uppercase tracking-[0.14em] text-[10px] mb-1.5">Where to get it</div>
              TikTok app → <strong className="text-gray-300">Profile → ☰ → TikTok Studio → Analytics</strong>, or on web at{' '}
              <strong className="text-gray-300">tiktokstudio.com → Analytics</strong> → <strong className="text-gray-300">download</strong> the
              Overview data. Pick the <strong className="text-gray-300">CSV</strong> and drop it here.
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {/* Period + momentum */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-gray-400">
              <span>{fmtDate(summary.firstActive)} — {fmtDate(summary.lastActive)}</span>
              <span className="text-gray-600">·</span>
              <span>{summary.activeDays} active days</span>
              {summary.growthPct != null && (
                <>
                  <span className="text-gray-600">·</span>
                  <span className={summary.growthPct >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                    {summary.growthPct >= 0 ? '▲' : '▼'} {Math.abs(summary.growthPct)}% views (last 30d vs prior 30d)
                  </span>
                </>
              )}
            </div>

            {/* Totals */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
              {METRICS.map((m) => (
                <div key={m.key} className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
                  <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-gray-500">{m.label}</div>
                  <div className="text-xl font-black tabular-nums mt-0.5" style={{ color: m.color }}>{compact(summary.totals[m.key])}</div>
                </div>
              ))}
            </div>

            {/* Chart + metric toggle */}
            <div className="rounded-xl border border-white/[0.08] bg-[#0b1224]/50 p-4">
              <div className="flex items-center gap-1.5 flex-wrap mb-3">
                {METRICS.map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => setMetric(m.key)}
                    className={'px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-[0.1em] transition-colors ' + (metric === m.key ? 'text-[#0a0e1a]' : 'bg-white/[0.04] text-gray-400 hover:text-gray-200')}
                    style={metric === m.key ? { backgroundColor: m.color } : undefined}
                  >
                    {m.label}
                  </button>
                ))}
                <span className="ml-auto text-[10px] uppercase tracking-[0.12em] text-gray-600">daily</span>
              </div>
              <LineChart values={summary.rows.map((r) => r[metric])} color={accent} />
            </div>

            {/* Best day + engagement */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3.5">
                <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-gray-500 mb-1">Best day</div>
                {summary.bestDay ? (
                  <div className="text-[13px] text-gray-200">
                    <strong className="text-[#00E5FF]">{compact(summary.bestDay.videoViews)} views</strong> on {fmtDate(summary.bestDay.date)}
                  </div>
                ) : <div className="text-[12px] text-gray-600">No views yet.</div>}
              </div>
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3.5">
                <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-gray-500 mb-1">Engagement rate</div>
                <div className="text-[13px] text-gray-200">
                  <strong className="text-[#FF4D7D]">{(summary.engagementRate * 100).toFixed(2)}%</strong>
                  <span className="text-gray-500"> of views liked / commented / shared</span>
                </div>
              </div>
            </div>

            {/* Monthly bars */}
            {summary.byMonth.length > 1 && (
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
                <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-gray-500 mb-3">Views by month</div>
                <div className="flex items-end gap-1.5 h-28">
                  {(() => {
                    const mx = Math.max(1, ...summary.byMonth.map((b) => b.videoViews));
                    return summary.byMonth.map((b) => (
                      <div key={b.key} className="flex-1 flex flex-col items-center justify-end gap-1 min-w-0" title={`${b.label}: ${compact(b.videoViews)} views`}>
                        <div className="w-full rounded-t bg-[#00E5FF]/70" style={{ height: `${Math.max(2, (b.videoViews / mx) * 100)}%` }} />
                        <span className="text-[8px] text-gray-600 truncate w-full text-center">{b.label.split(' ')[0]}</span>
                      </div>
                    ));
                  })()}
                </div>
              </div>
            )}

            <p className="text-[11px] text-gray-600 leading-relaxed">
              Note: this is account-wide daily data, so it can't be split into individual posts. To score
              specific posts, use the Performance tab.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
