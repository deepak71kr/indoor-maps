import { createContext } from 'preact';
import { useContext, useEffect, useState } from 'preact/hooks';
import type { EditorState, EditorStore } from '../model/store';

export const StoreContext = createContext<EditorStore | null>(null);

/** Re-renders the component whenever the editor state changes. */
export function useEditor(): { store: EditorStore; state: EditorState } {
  const store = useContext(StoreContext);
  if (!store) throw new Error('StoreContext missing');
  const [, setTick] = useState(0);
  useEffect(() => store.subscribe(() => setTick((n) => n + 1)), [store]);
  return { store, state: store.getState() };
}
