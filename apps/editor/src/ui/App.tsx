import { useEffect } from 'preact/hooks';
import { Canvas } from './Canvas';
import { FloorTabs, SidePanel, Toolbar, TopBar } from './Panels';
import { useEditor } from './use-editor';

export function App() {
  const { store } = useEditor();

  // Keyboard shortcuts (ignored while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable]')) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'z' && !e.shiftKey) store.undo();
      else if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) store.redo();
      else if (!mod && key === 'v') store.setTool('select');
      else if (!mod && key === 'm') store.setTool('scale');
      else if (key === 'escape') store.setTool('select');
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store]);

  return (
    <div class="editor">
      <TopBar />
      <Toolbar />
      <main class="workspace">
        <FloorTabs />
        <Canvas />
      </main>
      <SidePanel />
    </div>
  );
}
