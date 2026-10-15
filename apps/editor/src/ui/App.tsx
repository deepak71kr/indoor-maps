import { useEffect } from 'preact/hooks';
import { moveNodes } from '../model/commands';
import { deleteConnector, deleteItems, deleteRoom } from '../model/drawing';
import type { EditorStore, Tool } from '../model/store';
import { Canvas } from './Canvas';
import { FloorTabs, SidePanel, Toolbar, TopBar } from './Panels';
import { useEditor } from './use-editor';

export function App() {
  const { store } = useEditor();

  // Keyboard shortcuts (ignored while typing in a field).
  useEffect(() => {
    const tools: Record<string, Tool> = {
      v: 'select',
      m: 'scale',
      p: 'path',
      d: 'door',
      r: 'room',
      l: 'lift',
      s: 'stairs',
    };
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable]')) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const { selection, pathFrom, pickDoorFor, doc } = store.getState();
      if (mod && key === 'z' && !e.shiftKey) store.undo();
      else if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) store.redo();
      else if (!mod && tools[key]) store.setTool(tools[key]);
      else if (key === 'delete' || key === 'backspace') deleteSelection(store);
      else if (key.startsWith('arrow') && selection?.type === 'nodes') {
        const step = e.shiftKey ? 1 : 0.1; // meters
        const d = {
          arrowleft: [-step, 0],
          arrowright: [step, 0],
          arrowup: [0, -step],
          arrowdown: [0, step],
        }[key] ?? [0, 0];
        const moves = doc.nodes
          .filter((n) => selection.ids.includes(n.id))
          .map((n) => ({
            id: n.id,
            from: { x: n.x, y: n.y },
            to: { x: round2(n.x + (d[0] ?? 0)), y: round2(n.y + (d[1] ?? 0)) },
          }));
        store.run(moveNodes(moves, 'Nudge'));
      } else if (key === 'escape') {
        if (pathFrom) store.setPathFrom(null);
        else if (pickDoorFor) store.setPickDoorFor(null);
        else if (selection) store.select(null);
        else store.setTool('select');
      } else return;
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

const round2 = (v: number) => Math.round(v * 100) / 100;

function deleteSelection(store: EditorStore): void {
  const { selection } = store.getState();
  if (!selection) return;
  if (selection.type === 'nodes')
    store.edit('Delete', (d) => deleteItems(d, new Set(selection.ids), []));
  else if (selection.type === 'edge')
    store.edit('Delete line', (d) => deleteItems(d, new Set(), [[selection.a, selection.b]]));
  else if (selection.type === 'room') store.edit('Delete room', (d) => deleteRoom(d, selection.id));
  else store.edit('Delete', (d) => deleteConnector(d, selection.id));
}
