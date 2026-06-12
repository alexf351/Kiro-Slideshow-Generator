// Catches render-time crashes anywhere in the app and shows a recovery screen
// instead of a blank white page. Critically, it offers a one-tap backup export
// so a transient bug can't trap the user's locally-stored posts/drafts.

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { exportBackup, downloadBlob, timestampSlug } from './backup';

type Props = { children: ReactNode };
type State = { error: Error | null };

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface in the console for debugging; the UI shows a friendly message.
    console.error('App crashed:', error, info.componentStack);
  }

  private async handleBackup() {
    try {
      const blob = await exportBackup();
      downloadBlob(blob, `iro-backup-${timestampSlug()}.json`);
    } catch (e) {
      console.error('Backup failed:', e);
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#070b14] text-gray-200 p-6">
        <div className="max-w-md w-full rounded-2xl border border-white/10 bg-[#0d1320] p-7 text-center shadow-2xl">
          <div className="text-2xl mb-2">😵‍💫</div>
          <h1 className="text-lg font-bold mb-1">Something broke</h1>
          <p className="text-[13px] text-gray-400 leading-relaxed mb-5">
            The app hit an error. Your posts, drafts and settings are still saved in this browser.
            Grab a backup just in case, then reload.
          </p>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => void this.handleBackup()}
              className="w-full py-2.5 rounded-lg text-[12px] font-bold uppercase tracking-[0.12em] border border-[#00E5FF]/30 bg-[#00E5FF]/10 text-[#00E5FF] hover:bg-[#00E5FF]/20"
            >
              ↓ Export a backup
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="w-full py-2.5 rounded-lg text-[12px] font-bold uppercase tracking-[0.12em] bg-gradient-to-r from-[#00E5FF] to-[#00A5D9] text-[#0a0e1a] hover:brightness-110"
            >
              ⟳ Reload the app
            </button>
          </div>
          {this.state.error.message && (
            <pre className="mt-4 text-[10px] text-gray-600 whitespace-pre-wrap break-words text-left max-h-24 overflow-auto">
              {this.state.error.message}
            </pre>
          )}
        </div>
      </div>
    );
  }
}
