// Compact emoji quick-insert popover — a curated set of creator-favorite
// emojis for captions. Inserts at the caption's cursor via the parent.

import { useState } from 'react';

const EMOJIS = [
  '🔥', '✨', '💯', '🚀', '😍', '🤯', '😭', '💀', '👀', '🙌',
  '👇', '🧠', '💡', '⚡️', '🎯', '📈', '✅', '❌', '⭐️', '💪',
  '🏆', '🎁', '🤔', '😅', '😎', '🥹', '🫶', '❤️', '🧵', '📌',
  '💬', '🔑', '🪄', '💸', '🤖', '📱', '🎬', '🧩', '😤', '🤝',
  '🙏', '👏', '💥', '📲', '🆕', '🌟', '👉', '🫡',
];

export default function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-[11px] font-bold uppercase tracking-[0.14em] text-gray-500 hover:text-[#00E5FF]"
      >
        😀 Emoji
      </button>
      {open && (
        <>
          <button type="button" aria-label="Close" className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 bottom-full mb-2 z-40 w-[244px] p-2 rounded-xl border border-white/10 bg-[#0a0e1a] shadow-[0_18px_44px_-10px_rgba(0,0,0,0.7)] grid grid-cols-8 gap-0.5">
            {EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => {
                  onPick(e);
                  setOpen(false);
                }}
                className="text-[18px] leading-none p-1 rounded hover:bg-white/[0.08] transition-colors"
              >
                {e}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
