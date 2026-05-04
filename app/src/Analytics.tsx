import { useEffect, useMemo, useState } from 'react';
import {
  deletePost,
  listPosts,
  sumStats,
  updatePost,
  type Post,
  type PostStats,
} from './posts';

const STAT_FIELDS: { key: keyof PostStats; label: string }[] = [
  { key: 'views', label: 'Views' },
  { key: 'likes', label: 'Likes' },
  { key: 'comments', label: 'Comments' },
  { key: 'shares', label: 'Shares' },
  { key: 'saves', label: 'Saves' },
];

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

export default function Analytics() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function refresh() {
    setPosts(await listPosts());
  }
  useEffect(() => {
    refresh();
  }, []);

  // Object URLs for thumbnails. Re-built whenever the post list changes;
  // the previous batch is revoked in cleanup so we don't leak.
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
        <h2 className="text-xl md:text-2xl font-black tracking-tight text-white">Analytics</h2>
        <p className="mt-1 text-xs text-gray-500">
          Manual stats — update each post after you check TikTok.
        </p>
      </header>

      <div className="shrink-0 grid grid-cols-2 md:grid-cols-5 gap-2 md:gap-3 px-5 md:px-8 py-4 md:py-5 border-b border-white/[0.04]">
        {STAT_FIELDS.map(({ key, label }) => (
          <div
            key={key}
            className="rounded-xl bg-gradient-to-br from-[#0e2b3a] to-[#091626] border border-white/[0.06] px-3 py-2.5"
          >
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-gray-500">{label}</div>
            <div className="mt-0.5 text-xl md:text-2xl font-black text-white">
              {compactNumber(totals[key])}
            </div>
          </div>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 md:p-6">
        {busy && <div className="mb-3 text-xs text-[#00E5FF]">{busy}</div>}
        {posts.length === 0 && (
          <div className="block w-full py-16 rounded-2xl border-2 border-dashed border-white/10 text-center text-gray-500">
            <div className="text-base font-bold uppercase tracking-[0.16em] mb-1">No posts yet</div>
            <div className="text-xs px-6 leading-relaxed">
              Render a slideshow on the Edit tab, then tap <strong>Save to history</strong> after you post on TikTok.
            </div>
          </div>
        )}
        {posts.length > 0 && (
          <div className="flex flex-col gap-3">
            {posts.map((post) => {
              const expanded = expandedId === post.id;
              const thumb = thumbs.get(post.id);
              return (
                <div
                  key={post.id}
                  className="rounded-xl border border-white/[0.06] bg-[#0b1224] overflow-hidden"
                >
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
                      <div className="text-[11px] uppercase tracking-[0.14em] text-gray-500">
                        {relativeTime(post.postedAt)} · {post.platform} · {post.mascot}
                      </div>
                      <div className="mt-1 text-sm text-gray-200 line-clamp-2 leading-snug">
                        {post.caption || <span className="italic text-gray-500">no caption</span>}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-gray-400">
                        {STAT_FIELDS.map(({ key, label }) => (
                          <span key={key}>
                            <span className="text-gray-500">{label}:</span>{' '}
                            <span className="text-gray-200 font-medium">{compactNumber(post.stats[key])}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  </button>

                  {expanded && (
                    <div className="px-3 pb-3 border-t border-white/[0.06] bg-[#070b18]/40">
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-3">
                        {STAT_FIELDS.map(({ key, label }) => (
                          <label key={key} className="flex flex-col gap-1">
                            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">{label}</span>
                            <input
                              type="number"
                              inputMode="numeric"
                              min={0}
                              value={post.stats[key]}
                              onChange={(e) => handleStatChange(post, key, e.target.value)}
                              className="bg-[#070b18] border border-white/[0.10] rounded-md px-2 py-1.5 text-sm text-gray-200 focus:border-[#00E5FF]/50 focus:outline-none"
                            />
                          </label>
                        ))}
                      </div>
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
      </div>
    </div>
  );
}
