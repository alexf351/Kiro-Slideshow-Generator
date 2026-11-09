// Fastlane panel: connected accounts, recent posts with views / likes /
// saves / shares, and scheduling a library item — all through this app's
// /api/fastlane route so the Fastlane API key never touches the browser.
//
// Nothing here schedules or cancels on its own: both go through an explicit
// confirm dialog that spells out exactly what will happen, and the server
// additionally requires `confirm: true` plus the admin token.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useUI } from './ui';
import {
  PANEL_TOKEN_KEY,
  FastlaneError,
  compactNumber,
  fastlaneCall,
  localToUtcIso,
  normalizeAnalytics,
  normalizeConnection,
  normalizeContent,
  normalizePost,
  type FastlaneStatus,
  type FlConnection,
  type FlContent,
  type FlMetrics,
  type FlPost,
} from './fastlane';

const PLATFORM_LABEL: Record<string, string> = { tiktok: 'TikTok', instagram: 'Instagram', youtube: 'YouTube', reddit: 'Reddit' };
const SCHEDULE_PLATFORMS = ['tiktok', 'instagram', 'youtube'];

// Only ever link out to a plain http(s) URL from Fastlane's data.
const safeHref = (u: string) => (/^https?:\/\//i.test(u) ? u : '');
const label = (p: string) => PLATFORM_LABEL[p] || p;

function fmtWhen(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  return new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function errText(e: unknown): string {
  if (e instanceof FastlaneError) {
    if (e.status === 429) return `Fastlane rate limit (20 requests/min). Try again in ${Math.ceil((e.retryAfterMs || 60000) / 1000)}s.`;
    return e.message;
  }
  return (e as Error)?.message || 'Something went wrong.';
}

const btn = 'py-2 rounded-lg text-[11px] font-bold uppercase tracking-[0.12em] border transition-all disabled:opacity-50 disabled:cursor-not-allowed';
const btnGhost = btn + ' border-white/10 bg-white/[0.04] text-gray-300 hover:bg-white/[0.08]';
const btnAccent = btn + ' border-[#FF7A1A]/30 bg-[#FF7A1A]/15 text-[#FF9A4D] hover:bg-[#FF7A1A]/25';
const field = 'bg-[#070b18] border border-white/[0.10] rounded-md px-3 py-2 text-sm text-gray-200 focus:border-[#FF7A1A]/40 focus:outline-none';
const cap = 'text-[10px] font-bold uppercase tracking-[0.16em] text-gray-500';

export default function FastlanePanel({ defaultCaption }: { defaultCaption: string }) {
  const ui = useUI();
  const [token, setToken] = useState<string>(() => {
    try { return localStorage.getItem(PANEL_TOKEN_KEY) || ''; } catch { return ''; }
  });
  const [tokenDraft, setTokenDraft] = useState('');
  const [status, setStatus] = useState<FastlaneStatus | null>(null);
  const [statusErr, setStatusErr] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');

  const [connections, setConnections] = useState<FlConnection[] | null>(null);
  const [posts, setPosts] = useState<FlPost[] | null>(null);
  const [metrics, setMetrics] = useState<Record<string, FlMetrics>>({});
  const [metricsNote, setMetricsNote] = useState('');
  const [rawStats, setRawStats] = useState<unknown>(null);
  const [content, setContent] = useState<FlContent[] | null>(null);

  // schedule form
  const [contentId, setContentId] = useState('');
  const [platform, setPlatform] = useState('tiktok');
  const [connectionId, setConnectionId] = useState('');
  const [whenLocal, setWhenLocal] = useState('');
  const [caption, setCaption] = useState('');

  const isAdmin = status?.access === 'admin';
  const canRead = status?.access === 'admin' || status?.access === 'read';

  const loadStatus = useCallback(async (tok: string) => {
    setStatusErr('');
    try {
      const r = await fastlaneCall<{ data: FastlaneStatus }>('status', tok);
      setStatus(r.data);
    } catch (e) {
      setStatus(null);
      setStatusErr(errText(e));
    }
  }, []);

  useEffect(() => { void loadStatus(token); }, [token, loadStatus]);

  function saveToken() {
    const t = tokenDraft.trim();
    if (!t) return;
    try { localStorage.setItem(PANEL_TOKEN_KEY, t); } catch { /* private mode */ }
    setToken(t);
    setTokenDraft('');
  }
  function forgetToken() {
    try { localStorage.removeItem(PANEL_TOKEN_KEY); } catch { /* ignore */ }
    setToken('');
    setConnections(null); setPosts(null); setContent(null); setMetrics({}); setRawStats(null);
  }

  async function run<T>(what: string, fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(what); setErr('');
    try { return await fn(); }
    catch (e) { setErr(errText(e)); return undefined; }
    finally { setBusy(''); }
  }

  async function refresh() {
    await run('Loading accounts and posts…', async () => {
      const c = await fastlaneCall<{ data: unknown[] }>('connections', token);
      const conns = (Array.isArray(c.data) ? c.data : []).map(normalizeConnection).filter(Boolean) as FlConnection[];
      setConnections(conns);
      const s = await fastlaneCall<{ data: { posts: unknown[]; analytics: unknown; analyticsError: { message?: string } | null } }>('stats', token, { query: { limit: 15 } });
      setRawStats(s.data);
      setPosts((s.data.posts || []).map(normalizePost).filter(Boolean) as FlPost[]);
      setMetrics(normalizeAnalytics(s.data.analytics));
      setMetricsNote(s.data.analyticsError ? `Metrics unavailable: ${s.data.analyticsError.message || 'unknown error'}` : '');
    });
  }

  async function loadContent() {
    await run('Loading your Fastlane library…', async () => {
      const r = await fastlaneCall<{ data: unknown[] }>('content', token, { query: { limit: 30 } });
      const items = (Array.isArray(r.data) ? r.data : []).map(normalizeContent).filter(Boolean) as FlContent[];
      setContent(items);
      if (!connections) {
        const c = await fastlaneCall<{ data: unknown[] }>('connections', token);
        setConnections((Array.isArray(c.data) ? c.data : []).map(normalizeConnection).filter(Boolean) as FlConnection[]);
      }
    });
  }

  const platforms = useMemo(() => {
    const set = new Set((connections || []).map((c) => c.platform).filter((p) => SCHEDULE_PLATFORMS.includes(p)));
    return set.size ? Array.from(set) : ['tiktok', 'instagram', 'youtube'];
  }, [connections]);
  const accountsForPlatform = (connections || []).filter((c) => c.platform === platform);
  const schedulable = (content || []).filter((c) => c.status === 'CREATED' || c.status === 'READY' || c.status === 'UNKNOWN');

  useEffect(() => {
    if (!platforms.includes(platform)) setPlatform(platforms[0]);
  }, [platforms, platform]);
  useEffect(() => {
    if (accountsForPlatform.length === 1) setConnectionId(accountsForPlatform[0].id);
    else if (!accountsForPlatform.some((a) => a.id === connectionId)) setConnectionId('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform, connections]);

  async function schedule() {
    const item = (content || []).find((c) => c.id === contentId);
    const utc = localToUtcIso(whenLocal);
    if (!item) { setErr('Pick a library item to schedule.'); return; }
    if (!utc) { setErr('Pick a date and time.'); return; }
    if (Date.parse(utc) < Date.now() + 60_000) { setErr('Pick a time at least a minute from now.'); return; }
    if (accountsForPlatform.length > 1 && !connectionId) { setErr(`You have ${accountsForPlatform.length} ${label(platform)} accounts — pick one.`); return; }
    const acct = accountsForPlatform.find((a) => a.id === connectionId);
    const text = caption.trim();
    const ok = await ui.confirm({
      title: 'Schedule a real post?',
      message:
        `This tells Fastlane to post “${item.title || item.type}” to ${label(platform)}` +
        `${acct ? ` (${acct.name})` : ''} on ${fmtWhen(utc)} (${utc}).\n\n` +
        `Caption: ${text ? `“${text.slice(0, 160)}${text.length > 160 ? '…' : ''}”` : '(none)'}\n\n` +
        'It will go out publicly at that time unless you cancel it first.',
      confirmLabel: `Schedule on ${label(platform)}`,
      danger: true,
    });
    if (!ok) return;
    const r = await run('Scheduling…', () => fastlaneCall<{ data: unknown }>('schedule', token, {
      method: 'POST',
      body: { confirm: true, contentId: item.id, platform, utc_datetime: utc, caption: text || undefined, connectionId: connectionId || undefined },
    }));
    if (r) {
      ui.notify(`Scheduled on ${label(platform)} for ${fmtWhen(utc)}.`, { type: 'success' });
      setContentId(''); setWhenLocal('');
      void refresh();
    }
  }

  async function cancelPost(p: FlPost) {
    const ok = await ui.confirm({
      title: 'Cancel this scheduled post?',
      message: `Cancels the ${label(p.platform)} post${p.when ? ` set for ${fmtWhen(p.when)}` : ''}${p.caption ? ` (“${p.caption.slice(0, 80)}”)` : ''}. It won't go out.`,
      confirmLabel: 'Cancel post',
      danger: true,
    });
    if (!ok) return;
    const r = await run('Cancelling…', () => fastlaneCall('cancel', token, { method: 'POST', body: { confirm: true, postIds: [p.id] } }));
    if (r) { ui.notify('Scheduled post cancelled.', { type: 'success' }); void refresh(); }
  }

  // ---- setup states ----
  const setupMsgs: string[] = [];
  if (status && !status.apiKeySet) setupMsgs.push('Add FASTLANE_API_KEY in Vercel → Settings → Environment Variables, then redeploy.');
  if (status?.adminTokenTooShort) setupMsgs.push('FASTLANE_ADMIN_TOKEN is too short. Make it at least 16 characters, then redeploy.');
  if (status && !status.adminTokenSet) setupMsgs.push('Add FASTLANE_ADMIN_TOKEN too (a long password you make up, 16+ characters). It locks these routes so only you can use them.');

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-gray-500 leading-relaxed">
        Pull post stats from <strong className="text-gray-300">Fastlane</strong> and schedule library content to TikTok, Reels and Shorts.
        Your Fastlane API key stays on the server. Nothing posts or cancels without a confirm.
      </p>

      {statusErr && <div className="text-[11px] text-red-400 leading-relaxed">{statusErr}</div>}

      {setupMsgs.length > 0 && (
        <div className="p-3 rounded-xl border border-[#FFC857]/30 bg-[#FFC857]/[0.06] text-[11px] text-[#FFD98A] leading-relaxed flex flex-col gap-1.5">
          <div className="font-bold uppercase tracking-[0.14em] text-[10px]">Setup needed</div>
          {setupMsgs.map((m) => <div key={m}>{m}</div>)}
        </div>
      )}

      {/* Panel token */}
      {!token ? (
        <div className="flex flex-col gap-1.5">
          <span className={cap}>Panel token</span>
          <div className="flex gap-2">
            <input
              type="password"
              autoComplete="off"
              value={tokenDraft}
              onChange={(e) => setTokenDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') saveToken(); }}
              placeholder="Paste FASTLANE_ADMIN_TOKEN"
              className={field + ' flex-1 min-w-0'}
            />
            <button type="button" onClick={saveToken} disabled={!tokenDraft.trim()} className={btnAccent + ' px-3'}>Save</button>
          </div>
          <span className="text-[10px] text-gray-600 leading-relaxed">The same value you set as FASTLANE_ADMIN_TOKEN in Vercel. Saved in this browser only.</span>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-[11px]">
          <span className={status?.access === 'none' ? 'text-red-400' : 'text-[#22C55E]'}>
            {status?.access === 'admin' ? '✓ Token works (full access)'
              : status?.access === 'read' ? '✓ Token works (read-only)'
              : status ? '✕ Token not recognised' : 'Checking token…'}
          </span>
          <button type="button" onClick={forgetToken} className="ml-auto text-[10px] font-bold uppercase tracking-[0.12em] text-gray-500 hover:text-[#ff4d7d]">Forget token</button>
        </div>
      )}

      {canRead && (
        <>
          <div className="flex gap-2">
            <button type="button" onClick={() => void refresh()} disabled={!!busy} className={btnAccent + ' flex-1'}>
              {posts ? '↻ Refresh stats' : 'Load accounts & stats'}
            </button>
          </div>

          {busy && <div className="text-[11px] text-gray-400">{busy}</div>}
          {err && <div className="text-[11px] text-red-400 leading-relaxed">{err}</div>}

          {connections && (
            <div className="flex flex-col gap-1.5">
              <span className={cap}>Connected accounts</span>
              {connections.length === 0 ? (
                <span className="text-[11px] text-gray-500">No accounts connected in Fastlane yet.</span>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {connections.map((c) => (
                    <span key={c.id} className="px-2 py-1 rounded-md bg-white/[0.04] border border-white/[0.08] text-[11px] text-gray-300">
                      {label(c.platform)} · {c.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {posts && (
            <div className="flex flex-col gap-1.5">
              <span className={cap}>Recent posts</span>
              {metricsNote && <span className="text-[10px] text-[#FFD98A]">{metricsNote}</span>}
              {posts.length > 0 && (
                <span className="text-[10px] text-gray-600 leading-relaxed">
                  Fastlane reports views, likes and comments. It doesn't give saves or shares, so check those in the TikTok app.
                </span>
              )}
              {posts.length === 0 && <span className="text-[11px] text-gray-500">No posts yet.</span>}
              {posts.map((p) => {
                const m = metrics[p.id];
                const href = safeHref(p.url || m?.url || '');
                const posted = p.status === 'POSTED';
                return (
                  <div key={p.id} className="p-2.5 rounded-lg border border-white/[0.08] bg-white/[0.02] flex flex-col gap-1">
                    <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.1em]">
                      <span className="font-bold text-gray-300">{label(p.platform)}</span>
                      <span className={p.status === 'FAILED' ? 'text-red-400' : p.status === 'SCHEDULED' ? 'text-[#FFC857]' : 'text-gray-500'}>{p.status.toLowerCase()}</span>
                      {p.when && <span className="text-gray-600 normal-case tracking-normal">{fmtWhen(p.when)}</span>}
                      {href && <a href={href} target="_blank" rel="noreferrer noopener" className="ml-auto text-[#00E5FF] normal-case tracking-normal">open ↗</a>}
                    </div>
                    {p.caption && <div className="text-[12px] text-gray-300 truncate" title={p.caption}>{p.caption}</div>}
                    {posted && m && !m.notFound && (
                      <div className="grid grid-cols-3 gap-1 text-center">
                        {(['views', 'likes', 'comments'] as const).map((k) => (
                          <div key={k} className="rounded-md bg-black/20 py-1">
                            <div className="text-[13px] font-bold text-gray-200">{m[k] === undefined ? 'n/a' : compactNumber(m[k])}</div>
                            <div className="text-[9px] uppercase tracking-[0.12em] text-gray-600">{k}</div>
                          </div>
                        ))}
                      </div>
                    )}
                    {posted && m?.notFound && (
                      <div className="text-[10px] text-[#FFD98A]">Fastlane can't find this post on {label(p.platform)} anymore, so it has no stats.</div>
                    )}
                    {posted && !m && !metricsNote && (
                      <div className="text-[10px] text-gray-600">No stats from Fastlane for this post yet. New posts can take a while to sync.</div>
                    )}
                    {isAdmin && p.status === 'SCHEDULED' && (
                      <button type="button" onClick={() => void cancelPost(p)} disabled={!!busy} className="self-start text-[10px] font-bold uppercase tracking-[0.12em] text-gray-500 hover:text-[#ff4d7d]">
                        Cancel this post
                      </button>
                    )}
                  </div>
                );
              })}
              {rawStats != null && (
                <details className="text-[10px] text-gray-600">
                  <summary className="cursor-pointer select-none">Raw Fastlane data</summary>
                  <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-all bg-black/30 rounded-md p-2">{JSON.stringify(rawStats, null, 2)}</pre>
                </details>
              )}
            </div>
          )}

          {isAdmin && (
            <div className="p-3 rounded-xl border border-white/[0.08] bg-white/[0.02] flex flex-col gap-2.5">
              <span className={cap}>Schedule from your Fastlane library</span>
              {!content ? (
                <button type="button" onClick={() => void loadContent()} disabled={!!busy} className={btnGhost}>Load library</button>
              ) : schedulable.length === 0 ? (
                <span className="text-[11px] text-gray-500">No finished items in the library yet.</span>
              ) : (
                <>
                  <label className="flex flex-col gap-1">
                    <span className={cap}>Content</span>
                    <select value={contentId} onChange={(e) => setContentId(e.target.value)} className={field}>
                      <option value="">Pick an item…</option>
                      {schedulable.map((c) => (
                        <option key={c.id} value={c.id}>{c.title ? `${c.title.slice(0, 60)} · ${c.type}` : `${c.type}${c.createdAt ? ` · made ${fmtWhen(c.createdAt)}` : ` · ${c.id}`}`}</option>
                      ))}
                    </select>
                  </label>
                  <div className="flex gap-2">
                    <label className="flex flex-col gap-1 flex-1">
                      <span className={cap}>Platform</span>
                      <select value={platform} onChange={(e) => setPlatform(e.target.value)} className={field}>
                        {platforms.map((p) => <option key={p} value={p}>{label(p)}</option>)}
                      </select>
                    </label>
                    {accountsForPlatform.length > 1 && (
                      <label className="flex flex-col gap-1 flex-1">
                        <span className={cap}>Account</span>
                        <select value={connectionId} onChange={(e) => setConnectionId(e.target.value)} className={field}>
                          <option value="">Pick…</option>
                          {accountsForPlatform.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                      </label>
                    )}
                  </div>
                  <label className="flex flex-col gap-1">
                    <span className={cap}>When (your time)</span>
                    <input type="datetime-local" value={whenLocal} onChange={(e) => setWhenLocal(e.target.value)} className={field} />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="flex items-center justify-between">
                      <span className={cap}>Caption</span>
                      {defaultCaption && (
                        <button type="button" onClick={() => setCaption(defaultCaption)} className="text-[10px] font-bold uppercase tracking-[0.12em] text-gray-500 hover:text-[#FF9A4D]">
                          Use current caption
                        </button>
                      )}
                    </span>
                    <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={3} className={field + ' resize-y'} />
                  </label>
                  <button type="button" onClick={() => void schedule()} disabled={!!busy || !contentId || !whenLocal} className={btnAccent}>
                    Review & schedule…
                  </button>
                </>
              )}
            </div>
          )}
        </>
      )}

      <div className="text-[10px] text-gray-600 leading-relaxed">
        Setup: see <code className="text-gray-500">FASTLANE_SETUP.md</code>. Fastlane allows 20 requests a minute.
      </div>
    </div>
  );
}
