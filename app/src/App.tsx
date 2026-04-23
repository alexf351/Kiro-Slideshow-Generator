export default function App() {
  return (
    <div className="flex h-screen bg-[#0a0e1a] text-gray-100">
      <aside className="w-80 border-r border-[#2a334a] flex flex-col">
        <header className="px-5 py-4 border-b border-[#2a334a]">
          <h1 className="text-sm font-semibold tracking-wider text-[#00E5FF]">
            KIRO SLIDESHOW GENERATOR
          </h1>
          <p className="text-xs text-gray-400 mt-1">Local library · stats entered manually</p>
        </header>

        <div className="p-5 border-b border-[#2a334a]">
          <button
            type="button"
            className="w-full bg-[#00E5FF] text-[#0a0e1a] font-bold text-sm py-2.5 rounded-md hover:bg-[#33ECFF] transition-colors"
          >
            + New slideshow
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <p className="text-xs text-gray-500 leading-relaxed">
            No slideshows yet. Click <span className="text-[#00E5FF]">+ New slideshow</span> to
            start. Saved slideshows live in your browser's localStorage.
          </p>
        </div>
      </aside>

      <main className="flex-1 flex items-center justify-center text-gray-500 text-sm">
        <div className="text-center max-w-md px-8">
          <p className="mb-2">Pick a slideshow from the sidebar, or create a new one.</p>
          <p className="text-xs text-gray-600">
            Renderer wires up in the next commit — this scaffold is here so you can verify the
            build works before the iframe + library + stats logic lands on top.
          </p>
        </div>
      </main>
    </div>
  );
}
