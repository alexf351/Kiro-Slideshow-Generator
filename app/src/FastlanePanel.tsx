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
import {
  MIN_VIEWS,
  WINDOW_DAYS,
  findWinnerDeck,
  pct,
  rankWinners,
  readyDeckFile,
  remixDeck,
  remixSlug,
  type DeckMatch,
  type DeckSource,
  type RankedPost,
  type Ranking,
  type RemixResult,
} from './remixWinner';

export type RemixLoad = {
  name: string;
  json: string;
  caption: string;
  preset: string;
  source: DeckSource;
  remix: Extract<RemixResult, { ok: true }>;
};

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

type Props = {
  defaultCaption: string;
  // Remix the winner: where to look for the winning post's deck in this
  // browser, what to do with the remix, and the Clone-from-TikTok fallback.
  getDeckSources?: () => Promise<DeckSource[]>;
  onRemix?: (r: RemixLoad) => Promise<boolean>;
  onCloneUrl?: (url: string) => void;
};

type RemixState = {
  ranking: Ranking;
  pickedId: string;
  match: DeckMatch | null;
  result: RemixResult | null;
  loaded: RemixLoad | null;
};

export default function FastlanePanel({ defaultCaption, getDeckSources, onRemix, onCloneUrl }: Props) {
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

  // remix the winner
  const [remixSlot, setRemixSlot] = useState<3 | 4>(3);
  const [remix, setRemix] = useState<RemixState | null>(null);

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

  // Rank the last 7 days of posts, find the top one's deck in this browser
  // and load a remix of it with the Iro slide at slide 3 or 4. `pickId`
  // remixes a runner-up instead of re-ranking.
  async function remixTheWinner(pickId?: string) {
    if (!getDeckSources || !onRemix) return;
    await run(pickId ? 'Building the remix…' : 'Ranking last week’s posts…', async () => {
      let ranking = remix?.ranking;
      if (!pickId || !ranking) {
        const s = await fastlaneCall<{ data: { posts: unknown[]; analytics: unknown; analyticsError: { message?: string } | null } }>('stats', token, { query: { limit: 50 } });
        if (s.data.analyticsError) throw new Error(`Fastlane didn't return post stats: ${s.data.analyticsError.message || 'unknown error'}`);
        const ps = (s.data.posts || []).map(normalizePost).filter(Boolean) as FlPost[];
        ranking = rankWinners(ps, normalizeAnalytics(s.data.analytics));
      }
      const pick: RankedPost | undefined = pickId ? ranking.ranked.find((r) => r.post.id === pickId) : ranking.ranked[0];
      if (!pick) {
        setRemix({ ranking, pickedId: '', match: null, result: null, loaded: null });
        return;
      }
      const match = findWinnerDeck({ caption: pick.post.caption, url: pick.post.url }, await getDeckSources());
      if (!match) {
        setRemix({ ranking, pickedId: pick.post.id, match: null, result: null, loaded: null });
        return;
      }
      const result = remixDeck(match.source.json, remixSlot);
      let loaded: RemixLoad | null = null;
      if (result.ok) {
        const parsed = JSON.parse(result.json) as { preset?: string };
        const load: RemixLoad = {
          name: `Remix · ${match.source.name}`.slice(0, 60),
          json: result.json,
          caption: match.source.caption || pick.post.caption,
          preset: parsed.preset || match.source.preset || '',
          source: match.source,
          remix: result,
        };
        if (await onRemix(load)) loaded = load;
      }
      setRemix({ ranking, pickedId: pick.post.id, match, result, loaded });
    });
  }

  // The remix as a decks/<slug>.json file: commit it to the repo's decks/
  // folder and it shows up under Ready decks for one-tap loading.
  function downloadReadyDeck(l: RemixLoad) {
    const slug = remixSlug(l.source.name);
    const blob = new Blob([readyDeckFile(l.json, l.name, l.caption)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${slug}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
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

          {getDeckSources && onRemix && (
            <div className="p-3 rounded-xl border border-[#FF7A1A]/20 bg-[#FF7A1A]/[0.04] flex flex-col gap-2.5">
              <span className={cap}>Remix the winner</span>
              <span className="text-[10px] text-gray-500 leading-relaxed">
                Ranks your last {WINDOW_DAYS} days of posts by (likes + 2×comments) per view, skipping posts under {MIN_VIEWS} views,
                then loads the top post’s deck with the Iro slide moved to slide {remixSlot} and saves it to Drafts.
              </span>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-gray-500">Iro slide at</span>
                {([3, 4] as const).map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setRemixSlot(n)}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-bold border ${remixSlot === n ? 'border-[#FF7A1A]/50 bg-[#FF7A1A]/20 text-[#FF9A4D]' : 'border-white/10 bg-white/[0.03] text-gray-400'}`}
                  >
                    slide {n}
                  </button>
                ))}
              </div>
              <button type="button" onClick={() => void remixTheWinner()} disabled={!!busy} className={btnAccent}>
                Remix the winner
              </button>

              {remix && (() => {
                const { ranking, pickedId, match, result, loaded } = remix;
                const picked = ranking.ranked.find((r) => r.post.id === pickedId);
                if (!ranking.ranked.length) {
                  return (
                    <div className="text-[11px] text-gray-400 leading-relaxed">
                      No posted slideshows with stats in the last {WINDOW_DAYS} days. New posts can take a while to sync in Fastlane.
                    </div>
                  );
                }
                const others = ranking.ranked.filter((r) => r.post.id !== pickedId).slice(0, 2);
                const href = picked ? safeHref(picked.post.url) : '';
                return (
                  <div className="flex flex-col gap-2">
                    {ranking.basis === 'views' && (
                      <span className="text-[10px] text-[#FFD98A] leading-relaxed">
                        No post this week reached {MIN_VIEWS} views, so this ranks by views instead of engagement.
                      </span>
                    )}
                    {picked && (
                      <div className="p-2.5 rounded-lg border border-[#FF7A1A]/30 bg-black/20 flex flex-col gap-1">
                        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.1em]">
                          <span className="font-bold text-[#FF9A4D]">{picked === ranking.ranked[0] ? 'Winner' : 'Picked'}</span>
                          <span className="text-gray-400 normal-case tracking-normal">
                            {pct(picked.score)} engagement · {compactNumber(picked.views)} views · {compactNumber(picked.likes)} likes · {compactNumber(picked.comments)} comments
                          </span>
                          {href && <a href={href} target="_blank" rel="noreferrer noopener" className="ml-auto text-[#00E5FF] normal-case tracking-normal">open ↗</a>}
                        </div>
                        {picked.post.caption && <div className="text-[12px] text-gray-300 truncate" title={picked.post.caption}>{picked.post.caption}</div>}
                      </div>
                    )}
                    {picked && !match && (
                      <div className="text-[11px] text-[#FFD98A] leading-relaxed flex flex-col gap-1.5">
                        <span>Couldn’t find this post’s deck in this browser (post history, drafts or Ready decks), so there’s nothing to remix yet.</span>
                        {onCloneUrl && href && (
                          <button type="button" onClick={() => onCloneUrl(href)} className={btnGhost}>Clone it from TikTok instead</button>
                        )}
                      </div>
                    )}
                    {match && result && !result.ok && (
                      <div className="text-[11px] text-red-400 leading-relaxed">Found its deck ({match.source.name}) but couldn’t remix it: {result.reason}</div>
                    )}
                    {match && result?.ok && !loaded && (
                      <div className="text-[11px] text-gray-400">Remix not loaded, your current edits are untouched.</div>
                    )}
                    {loaded && (
                      <div className="text-[11px] text-[#22C55E] leading-relaxed flex flex-col gap-1">
                        <span>
                          Loaded “{loaded.name}” from your {loaded.source.kind === 'history' ? 'post history' : loaded.source.kind === 'draft' ? 'drafts' : 'Ready decks'}
                          {match?.how === 'link' ? ' (matched by TikTok link)' : ' (matched by caption)'}.
                          The Iro slide is slide {loaded.remix.slot} of {loaded.remix.total}. Saved to Drafts.
                        </span>
                        {loaded.remix.notes.map((n) => <span key={n} className="text-[#FFD98A]">{n}</span>)}
                        <button type="button" onClick={() => downloadReadyDeck(loaded)} className="self-start text-[10px] font-bold uppercase tracking-[0.12em] text-gray-500 hover:text-[#FF9A4D]">
                          Download as a Ready deck file
                        </button>
                      </div>
                    )}
                    {others.length > 0 && (
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] text-gray-600">Runners-up</span>
                        {others.map((r) => (
                          <div key={r.post.id} className="flex items-center gap-2 text-[11px] text-gray-400">
                            <span className="truncate flex-1 min-w-0" title={r.post.caption}>{r.post.caption || '(no caption)'}</span>
                            <span className="shrink-0 text-gray-500">{pct(r.score)} · {compactNumber(r.views)}</span>
                            <button type="button" onClick={() => void remixTheWinner(r.post.id)} disabled={!!busy} className="shrink-0 text-[10px] font-bold uppercase tracking-[0.12em] text-gray-500 hover:text-[#FF9A4D]">
                              Remix
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
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
