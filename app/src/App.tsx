import { useEffect, useMemo, useState } from 'react';
import engineHtml from '../../kiro_slideshow_engine_v3.html?raw';

type View = 'welcome' | 'editor';

export default function App() {
  const [view, setView] = useState<View>('welcome');

  // Wrap the engine HTML in a blob URL so the iframe can load it in-place,
  // without Vite needing to serve the file from outside /app.
  const engineUrl = useMemo(() => {
    const blob = new Blob([engineHtml], { type: 'text/html' });
    return URL.createObjectURL(blob);
  }, []);

  useEffect(() => {
    return () => URL.revokeObjectURL(engineUrl);
  }, [engineUrl]);

  return (
    <div className="flex h-screen bg-[#0a0e1a] text-gray-100">
      <aside className="w-80 border-r border-[#2a334a] flex flex-col shrink-0">
        <header className="px-5 py-4 border-b border-[#2a334a]">
          <h1 className="text-sm font-semibold tracking-wider text-[#00E5FF]">
            KIRO SLIDESHOW GENERATOR
          </h1>
          <p className="text-xs text-gray-400 mt-1">Local library · stats entered manually</p>
        </header>

        <div className="p-5 border-b border-[#2a334a]">
          <button
            type="button"
            onClick={() => setView('editor')}
            className="w-full bg-[#00E5FF] text-[#0a0e1a] font-bold text-sm py-2.5 rounded-md hover:bg-[#33ECFF] transition-colors"
          >
            + New slideshow
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <p className="text-xs text-gray-500 leading-relaxed">
            Saved slideshows will appear here. Library persistence ships in the next commit.
          </p>
        </div>
      </aside>

      <main className="flex-1 overflow-hidden">
        {view === 'welcome' ? (
          <div className="h-full flex items-center justify-center text-gray-500 text-sm">
            <div className="text-center max-w-md px-8">
              <p className="mb-2 text-gray-300">Click "+ New slideshow" to start.</p>
              <p className="text-xs text-gray-600">
                Engine loads in an iframe. Paste JSON inside the engine's panel on the right,
                click Render, then Download all slides.
              </p>
            </div>
          </div>
        ) : (
          <iframe
            src={engineUrl}
            className="w-full h-full border-0 bg-[#1a1a1a]"
            title="Kiro slideshow renderer"
          />
        )}
      </main>
    </div>
  );
}
