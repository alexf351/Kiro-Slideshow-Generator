// First-run welcome. Shows once (gated by a localStorage flag), lays out
// the three-step flow + the ⌘K palette, and gets out of the way. Tasteful,
// skippable, no nagging.

const FLAG = 'iro_onboarded_v1';

export function shouldOnboard(): boolean {
  try {
    return localStorage.getItem(FLAG) !== '1';
  } catch {
    return false;
  }
}

const STEPS: { n: string; title: string; body: string }[] = [
  {
    n: '1',
    title: 'Start from an idea',
    body: 'Type a topic and hit “Full post” — AI picks the best of 24 formats, writes the slides, and drafts a caption. Or pick a format yourself and fill the Quick Edit fields (no JSON), clone a TikTok, or brainstorm + batch a whole week.',
  },
  {
    n: '2',
    title: 'Make it yours',
    body: 'Backgrounds from stock, built-in gradients, or AI-generated. Drag text & photos onto slides. Improve / rewrite with AI, then AI-write or punch up the caption with hashtags (any language).',
  },
  {
    n: '3',
    title: 'Publish & track',
    body: 'Export slides, an MP4, or a PDF, send to your phone by QR, or push straight to your TikTok inbox. Schedule drafts on the calendar and log results in Performance — the engine learns what works for you.',
  },
];

export default function Onboarding({ onClose }: { onClose: () => void }) {
  function dismiss() {
    try {
      localStorage.setItem(FLAG, '1');
    } catch {}
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="relative w-full max-w-md rounded-3xl border border-[#00E5FF]/20 bg-gradient-to-b from-[#0e1733] to-[#080c1a] p-6 md:p-8 shadow-[0_30px_90px_-15px_rgba(0,0,0,0.85)] animate-[dialogIn_200ms_ease-out]">
        <div className="flex items-baseline gap-2.5 mb-1">
          <span className="text-2xl font-black tracking-tight text-white">iro</span>
          <span className="text-[10px] font-bold uppercase tracking-[0.32em] text-[#00E5FF]">studio</span>
        </div>
        <p className="text-[13px] text-gray-400 leading-relaxed mb-5">
          A slideshow studio that learns what performs. Here’s the loop:
        </p>

        <div className="flex flex-col gap-3 mb-6">
          {STEPS.map((s) => (
            <div key={s.n} className="flex gap-3.5">
              <span className="shrink-0 w-7 h-7 rounded-full bg-[#00E5FF]/15 text-[#00E5FF] font-black text-[13px] flex items-center justify-center">
                {s.n}
              </span>
              <div>
                <div className="text-[13px] font-bold text-gray-100">{s.title}</div>
                <div className="text-[12px] text-gray-500 leading-relaxed mt-0.5">{s.body}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3 mb-5 px-3 py-2.5 rounded-xl border border-white/[0.07] bg-white/[0.02]">
          <span className="text-[12px] text-gray-400">Tip: open the command palette anytime</span>
          <kbd className="text-[11px] font-mono bg-white/[0.06] text-gray-300 rounded px-1.5 py-0.5">⌘K</kbd>
        </div>

        <button
          type="button"
          onClick={dismiss}
          className="w-full py-3 rounded-xl font-bold text-sm tracking-wide bg-gradient-to-r from-[#00E5FF] to-[#00A5D9] text-[#0a0e1a] shadow-[0_4px_20px_rgba(0,229,255,0.35)] hover:-translate-y-0.5 transition-transform"
        >
          Start creating
        </button>
      </div>
    </div>
  );
}
