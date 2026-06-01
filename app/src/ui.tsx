// App-wide toast + dialog system — replaces the jarring native
// window.alert / confirm / prompt with in-app, on-brand surfaces.
//
// Usage:
//   const ui = useUI();
//   ui.notify('Saved', { type: 'success' });
//   if (await ui.confirm({ message: 'Delete this?', danger: true })) …
//   const url = await ui.prompt({ message: 'Paste an image URL' });
//
// Toasts stack bottom-right and auto-dismiss; confirm/prompt render a
// single centered modal and resolve a promise when the user responds.

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

type ToastType = 'success' | 'error' | 'info';
type Toast = { id: number; message: string; type: ToastType };

type ConfirmOpts = {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};
type PromptOpts = {
  title?: string;
  message: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
};

type DialogState =
  | { kind: 'confirm'; opts: ConfirmOpts; resolve: (v: boolean) => void }
  | { kind: 'prompt'; opts: PromptOpts; resolve: (v: string | null) => void }
  | null;

type UIContextValue = {
  notify: (message: string, opts?: { type?: ToastType; duration?: number }) => void;
  confirm: (opts: ConfirmOpts) => Promise<boolean>;
  prompt: (opts: PromptOpts) => Promise<string | null>;
};

const UIContext = createContext<UIContextValue | null>(null);

export function useUI(): UIContextValue {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error('useUI must be used within <UIProvider>');
  return ctx;
}

const TYPE_STYLES: Record<ToastType, { accent: string; icon: string }> = {
  success: { accent: '#22C55E', icon: '✓' },
  error: { accent: '#EF4444', icon: '!' },
  info: { accent: '#00E5FF', icon: 'i' },
};

export function UIProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [promptValue, setPromptValue] = useState('');
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const notify = useCallback<UIContextValue['notify']>((message, opts) => {
    const id = ++idRef.current;
    const type = opts?.type ?? 'info';
    setToasts((prev) => [...prev, { id, message, type }]);
    const duration = opts?.duration ?? (type === 'error' ? 6000 : 3500);
    window.setTimeout(() => dismiss(id), duration);
  }, [dismiss]);

  const confirm = useCallback<UIContextValue['confirm']>((opts) => {
    return new Promise<boolean>((resolve) => setDialog({ kind: 'confirm', opts, resolve }));
  }, []);

  const prompt = useCallback<UIContextValue['prompt']>((opts) => {
    setPromptValue(opts.defaultValue ?? '');
    return new Promise<string | null>((resolve) => setDialog({ kind: 'prompt', opts, resolve }));
  }, []);

  const value = useMemo(() => ({ notify, confirm, prompt }), [notify, confirm, prompt]);

  function closeDialog(result: boolean | string | null) {
    if (!dialog) return;
    if (dialog.kind === 'confirm') dialog.resolve(result as boolean);
    else dialog.resolve(result as string | null);
    setDialog(null);
    setPromptValue('');
  }

  return (
    <UIContext.Provider value={value}>
      {children}

      {/* Toast stack */}
      <div className="fixed z-[100] bottom-4 right-4 flex flex-col gap-2 max-w-[min(92vw,360px)] pointer-events-none">
        {toasts.map((t) => {
          const s = TYPE_STYLES[t.type];
          return (
            <div
              key={t.id}
              role="status"
              className="pointer-events-auto flex items-start gap-3 rounded-xl border bg-[#0b1224]/95 backdrop-blur px-4 py-3 shadow-[0_12px_40px_-8px_rgba(0,0,0,0.7)] animate-[toastIn_180ms_ease-out]"
              style={{ borderColor: s.accent + '55' }}
            >
              <span
                className="mt-0.5 shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-black text-[#0a0e1a]"
                style={{ background: s.accent }}
              >
                {s.icon}
              </span>
              <span className="text-[13px] leading-snug text-gray-100 flex-1">{t.message}</span>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss"
                className="shrink-0 text-gray-500 hover:text-gray-200 text-sm leading-none"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>

      {/* Modal: confirm / prompt */}
      {dialog && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Cancel"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => closeDialog(dialog.kind === 'confirm' ? false : null)}
          />
          <div className="relative w-full max-w-sm rounded-2xl border border-white/10 bg-gradient-to-b from-[#0e1426] to-[#0a0e1a] p-5 shadow-[0_24px_70px_-12px_rgba(0,0,0,0.8)] animate-[dialogIn_160ms_ease-out]">
            {dialog.opts.title && (
              <div className="text-[15px] font-bold text-white mb-1.5">{dialog.opts.title}</div>
            )}
            <div className="text-[13px] text-gray-300 leading-relaxed whitespace-pre-wrap">{dialog.opts.message}</div>

            {dialog.kind === 'prompt' && (
              <input
                autoFocus
                value={promptValue}
                onChange={(e) => setPromptValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') closeDialog(promptValue);
                  if (e.key === 'Escape') closeDialog(null);
                }}
                placeholder={dialog.opts.placeholder}
                className="mt-3 w-full bg-[#070b18] border border-white/[0.12] rounded-lg px-3 py-2.5 text-sm text-gray-100 placeholder:text-gray-600 focus:border-[#00E5FF]/60 focus:outline-none"
              />
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => closeDialog(dialog.kind === 'confirm' ? false : null)}
                className="px-4 py-2 rounded-lg text-[12px] font-bold uppercase tracking-[0.12em] text-gray-300 hover:text-white border border-white/10 hover:bg-white/[0.04]"
              >
                {dialog.kind === 'confirm' ? dialog.opts.cancelLabel || 'Cancel' : 'Cancel'}
              </button>
              <button
                type="button"
                autoFocus={dialog.kind === 'confirm'}
                onClick={() => closeDialog(dialog.kind === 'confirm' ? true : promptValue)}
                className={
                  'px-4 py-2 rounded-lg text-[12px] font-bold uppercase tracking-[0.12em] text-[#0a0e1a] ' +
                  (dialog.kind === 'confirm' && dialog.opts.danger
                    ? 'bg-gradient-to-r from-[#EF4444] to-[#b91c1c] text-white'
                    : 'bg-gradient-to-r from-[#00E5FF] to-[#00A5D9]')
                }
              >
                {dialog.kind === 'confirm'
                  ? dialog.opts.confirmLabel || 'Confirm'
                  : dialog.opts.confirmLabel || 'OK'}
              </button>
            </div>
          </div>
        </div>
      )}
    </UIContext.Provider>
  );
}
