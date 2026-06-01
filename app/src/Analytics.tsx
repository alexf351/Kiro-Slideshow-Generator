import { useEffect, useMemo, useState } from 'react';
import {
  deletePost,
  listPosts,
  sumStats,
  updatePost,
  type Post,
  type PostStats,
} from './posts';
import {
  hasStats,
  scorePost,
  summarizeWhatWorks,
  SCORE_LABEL_COLOR,
  SCORE_LABEL_TEXT,
  type ScoreBreakdown,
} from './scoring';
import AnalyzeMyPost from './AnalyzeMyPost';
import HookLibrary from './HookLibrary';
import { type ClaudeModelId } from './anthropic';

const STAT_FIELDS: { key: keyof PostStats; label: string }[] = [
  { key: 'views', label: 'Views' },
  { key: 'likes', label: 'Likes' },
  { key: 'comments', label: 'Comments' },
  { key: 'shares', label: 'Shares' },
  { key: 'saves', label: 'Saves' },
  { key: 'photoViews', label: 'Photo views' },
];

type Props = {
  anthropicKey: string;
  model: ClaudeModelId;
  onModelChange: (m: ClaudeModelId) => void;
  // Drops a winning hook into the editor caption + jumps to Edit.
  onUseHook: (hook: string) => void;
};

type Tab = 'posts' | 'hooks';

function compactNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1) + 'K';
  return String(n);
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return new Date(ms).toLocaleDateString();
}

// Round score circle shown on each post row + in the totals.
function ScoreBadge({ breakdown, scored }: { breakdown: ScoreBreakdown; scored: boolean }) {
  if (!scored) {
    return (
      <div className="shrink-0 w-12 h-12 rounded-full border border-white/10 flex flex-col items-center justify-center text-gray-600">
        <span className="text-[10px] uppercase tracking-[0.12em]">no</span>
        <span className="text-[8px] uppercase tracking-[0.12em]">data</span>
      </div>
    );
  }
  const color = SCORE_LABEL_COLOR[breakdown.label];
  return (
    <div
      className="shrink-0 w-12 h-12 rounded-full border-2 flex flex-col items-center justify-center"
      style={{ borderColor: color }}
      title={`${SCORE_LABEL_TEXT[breakdown.label]} · ${breakdown.basis} basis`}
    >
      <span className="text-base font-black tabular-nums leading-none text-white">{breakdown.score}</span>
      <span className="text-[7px] uppercase tracking-[0.1em]" style={{ color }}>
        {SCORE_LABEL_TEXT[breakdown.label]}
      </span>
    </div>
  );
}

export default function Analytics({ anthropicKey, model, onModelChange, onUseHook }: Props) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('posts');

  async function refresh() {
    setPosts(await listPosts());
  }
  useEffect(() => {
    refresh();
  }, []);

  const thumbs = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of posts) {
      if (p.thumbnailBlob) map.set(p.id, URL.createObjectURL(p.thumbnailBlob));
    }
    return map;
  }, [posts]);
  useEffect(() => {
    return () => {
      for (const url of thumbs.values()) URL.revokeObjectURL(url);
    };
  }, [thumbs]);

  const totals = useMemo(() => sumStats(posts), [posts]);

  // Score every post against the whole population, keyed by id.
  const scores = useMemo(() => {
    const map = new Map<string, ScoreBreakdown>();
    for (const p of posts) map.set(p.id, scorePost(p, posts));
    return map;
  }, [posts]);

  const summary = useMemo(() => summarizeWhatWorks(posts), [posts]);

  async function handleStatChange(post: Post, field: keyof PostStats, raw: string) {
    const n = parseInt(raw.replace(/[^0-9-]/g, ''), 10);
    const value = Number.isFinite(n) ? Math.max(0, n) : 0;
    const next = { ...post, stats: { ...post.stats, [field]: value } };
    setPosts((prev) => prev.map((p) => (p.id === post.id ? next : p)));
    await updatePost(post.id, { stats: next.stats });
  }

  async function handleCaptionChange(post: Post, caption: string) {
    setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, caption } : p)));
    await updatePost(post.id, { caption });
  }

  async function handleUrlChange(post: Post, url: string) {
    setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, tiktokUrl: url } : p)));
    await updatePost(post.id, { tiktokUrl: url });
  }

  async function handleDelete(post: Post) {
    if (!window.confirm(`Delete this post from your history? Stats will be lost.`)) return;
    setBusy('Deleting…');
    try {
      await deletePost(post.id);
      if (expandedId === post.id) setExpandedId(null);
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="h-full flex flex-col bg-[#070a14]">
      <header className="shrink-0 px-5 md:px-8 pt-5 md:pt-7 pb-4 border-b border-white/[0.06]">
        <h2 className="text-xl md:text-2xl font-black tracking-tight text-white">Performance</h2>
        <p className="mt-1 text-xs text-gray-500">
          Import your posts, enter the numbers, and the engine scores each one + learns what works.
        </p>

        <div className="mt-3 flex gap-1.5 p-1 rounded-lg bg-black/30 border border-white/[0.05] w-fit">
          {(['posts', 'hooks'] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={
                'px-4 py-1.5 rounded-md text-[11px] font-bold uppercase tracking-[0.16em] transition-colors ' +
                (tab === t ? 'bg-[#00E5FF]/15 text-[#00E5FF]' : 'text-gray-400 hover:text-gray-200')
              }
            >
              {t === 'posts' ? 'Posts' : 'Hooks'}
            </button>
          ))}
        </div>

        {tab === 'posts' && (
          <div className="mt-4">
            <AnalyzeMyPost anthropicKey={anthropicKey} model={model} onModelChange={onModelChange} onImported={refresh} />
          </div>
        )}

        {tab === 'posts' && summary.scored > 0 && (
          <div className="mt-4 flex flex-wrap gap-2 text-[11px]">
            {summary.topPreset && (
              <span className="px-2.5 py-1 rounded-full bg-[#00E5FF]/10 text-[#00E5FF] border border-[#00E5FF]/20">
                Best format: <strong>{summary.topPreset.key}</strong> · {summary.topPreset.avgScore} avg
              </span>
            )}
            {summary.byHook[0] && summary.byHook[0].key && (
              <span className="px-2.5 py-1 rounded-full bg-[#22C55E]/10 text-[#22C55E] border border-[#22C55E]/20">
                Best hook: <strong>{summary.byHook[0].key}</strong> · {summary.byHook[0].avgScore} avg
              </span>
            )}
            {summary.predictionCount > 0 && summary.meanAbsError !== null && (
              <span className="px-2.5 py-1 rounded-full bg-[#A78BFA]/10 text-[#A78BFA] border border-[#A78BFA]/20">
                Prediction error: <strong>±{summary.meanAbsError}</strong> over {summary.predictionCount}
              </span>
            )}
            <span className="px-2.5 py-1 rounded-full bg-white/[0.04] text-gray-400 border border-white/10">
              {summary.scored} scored post{summary.scored === 1 ? '' : 's'}
            </span>
          </div>
        )}
      </header>

      {tab === 'posts' && (
      <div className="shrink-0 grid grid-cols-3 md:grid-cols-6 gap-2 md:gap-3 px-5 md:px-8 py-4 md:py-5 border-b border-white/[0.05]">
        {STAT_FIELDS.map(({ key, label }) => {
          const has = totals[key] > 0;
          return (
            <div
              key={key}
              className={
                'rounded-xl px-3 py-3 border transition-colors ' +
                (has
                  ? 'border-[#00E5FF]/20 bg-gradient-to-br from-[#0e2030] to-[#0a1424]'
                  : 'border-white/[0.06] bg-[#0b1224]/60')
              }
            >
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-gray-500">{label}</div>
              <div
                className={
                  'mt-1 font-black tabular-nums leading-none ' +
                  (has ? 'text-white text-lg md:text-2xl' : 'text-gray-600 text-lg md:text-2xl')
                }
              >
                {compactNumber(totals[key])}
              </div>
            </div>
          );
        })}
      </div>
      )}

      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 md:p-6">
        {tab === 'hooks' && <HookLibrary posts={posts} onUseHook={onUseHook} />}
        {tab === 'posts' && (
          <>
        {busy && <div className="mb-3 text-xs text-[#00E5FF]">{busy}</div>}
        {posts.length === 0 && (
          <div className="block w-full py-16 rounded-2xl border-2 border-dashed border-white/10 text-center text-gray-500">
            <div className="mx-auto mb-3 w-12 h-12 rounded-full bg-white/[0.04] border border-white/10 flex items-center justify-center text-2xl text-gray-500">
              📊
            </div>
            <div className="text-sm font-bold uppercase tracking-[0.18em] mb-1 text-gray-300">No posts tracked yet</div>
            <div className="text-xs px-6 leading-relaxed">
              Paste one of your own post URLs in <strong>Analyze my TikTok post</strong> above, or render a draft on the
              Edit tab and tap <strong>Save to history</strong>.
            </div>
          </div>
        )}
        {posts.length > 0 && (
          <div className="flex flex-col gap-3">
            {posts.map((post) => {
              const expanded = expandedId === post.id;
              const thumb = thumbs.get(post.id);
              const breakdown = scores.get(post.id)!;
              const scored = hasStats(post);
              const pred = post.prediction;
              const delta = pred && scored ? breakdown.score - pred.score : null;
              return (
                <div key={post.id} className="rounded-xl border border-white/[0.06] bg-[#0b1224] overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setExpandedId(expanded ? null : post.id)}
                    className="w-full text-left p-3 flex gap-3 hover:bg-white/[0.02] transition-colors"
                  >
                    <div className="shrink-0 w-16 h-28 md:w-20 md:h-36 rounded-md overflow-hidden bg-[#070b18] border border-white/[0.06]">
                      {thumb ? (
                        <img src={thumb} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[10px] text-gray-600">no thumb</div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] uppercase tracking-[0.14em] text-gray-500 flex items-center gap-2 flex-wrap">
                        <span>{relativeTime(post.postedAt)}</span>
                        {post.origin === 'self' && (
                          <span className="px-1.5 py-0.5 rounded bg-[#22C55E]/15 text-[#22C55E] tracking-[0.1em]">my post</span>
                        )}
                        {post.platform && <span>· {post.platform}</span>}
                      </div>
                      <div className="mt-1 text-sm text-gray-200 line-clamp-2 leading-snug">
                        {post.caption || <span className="italic text-gray-500">no caption</span>}
                      </div>
                      {pred && (
                        <div className="mt-1.5 text-[11px]">
                          {scored ? (
                            <span className="text-gray-400">
                              Predicted <strong className="text-[#A78BFA]">{pred.score}</strong> → Actual{' '}
                              <strong className="text-white">{breakdown.score}</strong>{' '}
                              <span className={delta! >= 0 ? 'text-[#22C55E]' : 'text-[#F59E0B]'}>
                                (Δ{delta! >= 0 ? '+' : ''}{delta})
                              </span>
                            </span>
                          ) : (
                            <span className="text-gray-500">
                              Predicted <strong className="text-[#A78BFA]">{pred.score}</strong> · awaiting numbers
                            </span>
                          )}
                        </div>
                      )}
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-gray-400">
                        {STAT_FIELDS.map(({ key, label }) => (
                          <span key={key}>
                            <span className="text-gray-500">{label}:</span>{' '}
                            <span className="text-gray-200 font-medium">{compactNumber(post.stats[key] || 0)}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                    <ScoreBadge breakdown={breakdown} scored={scored} />
                  </button>

                  {expanded && (
                    <div className="px-3 pb-3 border-t border-white/[0.06] bg-[#070b18]/40">
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-3">
                        {STAT_FIELDS.map(({ key, label }) => (
                          <label key={key} className="flex flex-col gap-1">
                            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">{label}</span>
                            <input
                              type="number"
                              inputMode="numeric"
                              min={0}
                              value={post.stats[key] || 0}
                              onChange={(e) => handleStatChange(post, key, e.target.value)}
                              className="bg-[#070b18] border border-white/[0.10] rounded-md px-2 py-1.5 text-sm text-gray-200 focus:border-[#00E5FF]/50 focus:outline-none"
                            />
                          </label>
                        ))}
                      </div>

                      {scored && (
                        <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
                          <ScoreStat label="Reach pct" value={`${Math.round(breakdown.reachPercentile * 100)}%`} />
                          <ScoreStat label="Engagement" value={`${(breakdown.engagementRate * 100).toFixed(1)}%`} />
                          <ScoreStat label="Save rate" value={`${(breakdown.saveRate * 100).toFixed(1)}%`} />
                          <ScoreStat label="Share rate" value={`${(breakdown.shareRate * 100).toFixed(1)}%`} />
                        </div>
                      )}

                      {post.selfAnalysis?.contentSummary && (
                        <div className="mt-3 text-[11px] text-gray-400 leading-relaxed bg-white/[0.02] border border-white/[0.06] rounded-md p-2.5">
                          <span className="text-gray-500 font-bold uppercase tracking-[0.14em] text-[10px]">Read: </span>
                          {post.selfAnalysis.contentSummary}
                        </div>
                      )}
                      {pred?.suggestions && pred.suggestions.length > 0 && (
                        <details className="mt-3 text-[11px] text-gray-400">
                          <summary className="cursor-pointer text-[#A78BFA] hover:text-[#c4b5fd]">
                            Pre-publish suggestions ({pred.suggestions.length})
                          </summary>
                          <ul className="mt-1.5 list-disc list-inside space-y-0.5 leading-relaxed">
                            {pred.suggestions.map((s, i) => <li key={i}>{s}</li>)}
                          </ul>
                        </details>
                      )}

                      <label className="mt-3 flex flex-col gap-1">
                        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">Caption</span>
                        <textarea
                          value={post.caption}
                          onChange={(e) => handleCaptionChange(post, e.target.value)}
                          rows={2}
                          className="bg-[#070b18] border border-white/[0.10] rounded-md px-2 py-1.5 text-sm text-gray-200 focus:border-[#00E5FF]/50 focus:outline-none resize-y"
                        />
                      </label>
                      <label className="mt-3 flex flex-col gap-1">
                        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">TikTok URL</span>
                        <input
                          type="url"
                          value={post.tiktokUrl}
                          placeholder="https://www.tiktok.com/@you/video/…"
                          onChange={(e) => handleUrlChange(post, e.target.value)}
                          className="bg-[#070b18] border border-white/[0.10] rounded-md px-2 py-1.5 text-sm text-gray-200 focus:border-[#00E5FF]/50 focus:outline-none"
                        />
                      </label>
                      <div className="mt-3 flex justify-end">
                        <button
                          type="button"
                          onClick={() => handleDelete(post)}
                          className="px-3 py-1.5 rounded-md text-xs font-bold uppercase tracking-[0.14em] bg-red-500/15 text-red-300 border border-red-500/40 hover:bg-red-500/25"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
          </>
        )}
      </div>
    </div>
  );
}

function ScoreStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-white/[0.03] border border-white/[0.06] px-2.5 py-2">
      <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-gray-500">{label}</div>
      <div className="mt-0.5 text-sm font-bold tabular-nums text-gray-200">{value}</div>
    </div>
  );
}
