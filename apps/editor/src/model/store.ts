/**
 * Editor state: the document, its undo history, and UI state (current floor, tool).
 * Plain object + subscribe; Preact components read it through `useEditor()`.
 */
import type { MapFile } from '@innermap/schema';
import type { Command } from './commands';
import { replaceDocument } from './commands';
import type { History } from './history';
import { emptyHistory, execute, redo, undo } from './history';
import { sortedLevels } from './project';

export type Tool = 'select' | 'scale';

export interface EditorState {
  readonly doc: MapFile;
  readonly history: History;
  readonly levelId: string;
  readonly tool: Tool;
}

export interface EditorStore {
  getState(): EditorState;
  subscribe(listener: () => void): () => void;
  run(command: Command): void;
  undo(): void;
  redo(): void;
  /** New project / import / sample: undoable like everything else. */
  load(label: string, doc: MapFile): void;
  setLevel(levelId: string): void;
  setTool(tool: Tool): void;
}

export function createEditorStore(doc: MapFile): EditorStore {
  let state: EditorState = {
    doc,
    history: emptyHistory,
    levelId: sortedLevels(doc)[0]?.id ?? '',
    tool: 'select',
  };
  const listeners = new Set<() => void>();
  const set = (next: EditorState) => {
    state = { ...next, levelId: validLevel(next.doc, next.levelId) };
    for (const listener of listeners) listener();
  };
  const applied = (result: { doc: MapFile; history: History } | null) => {
    if (result) set({ ...state, ...result });
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    run: (command) => applied(execute(state.doc, state.history, command)),
    undo: () => applied(undo(state.doc, state.history)),
    redo: () => applied(redo(state.doc, state.history)),
    load: (label, next) =>
      applied(execute(state.doc, state.history, replaceDocument(label, state.doc, next))),
    setLevel: (levelId) => set({ ...state, levelId }),
    setTool: (tool) => set({ ...state, tool }),
  };
}

/** Keep the current floor valid after deletes/imports/undo. */
function validLevel(doc: MapFile, levelId: string): string {
  return doc.levels.some((l) => l.id === levelId) ? levelId : (sortedLevels(doc)[0]?.id ?? '');
}
