/**
 * Editor state: the document, its undo history, and UI state (floor, tool, selection).
 * Plain object + subscribe; Preact components read it through `useEditor()`.
 */
import type { Destination } from '@innermap/core';
import type { Amenity, MapFile } from '@innermap/schema';
import type { Command } from './commands';
import { replaceDocument } from './commands';
import { change } from './drawing';
import type { History } from './history';
import { emptyHistory, execute, redo, undo } from './history';
import type { ShapeKind } from './plan';
import { sortedLevels } from './project';

export type Tool =
  | 'select'
  | 'scale'
  | 'outline'
  | 'path'
  | 'door'
  | 'room'
  | 'lift'
  | 'stairs'
  | 'amenity'
  | 'qr'
  | 'test';

export type Selection =
  | { readonly type: 'nodes'; readonly ids: readonly string[] }
  | { readonly type: 'edge'; readonly a: string; readonly b: string }
  | { readonly type: 'room'; readonly id: string }
  | { readonly type: 'connector'; readonly id: string }
  | { readonly type: 'amenity'; readonly id: string }
  | { readonly type: 'qr'; readonly code: string }
  /** A floor plan outline: shapes have no ids, so (floor, index). */
  | { readonly type: 'shape'; readonly levelId: string; readonly index: number }
  | null;

/** ▶ Test route: start dot, destination, step-free. */
export interface RouteTest {
  readonly from: string | null;
  readonly to: Destination | null;
  readonly stepFree: boolean;
}

/** "Show me this" requests (e.g. clicking a check); `n` changes on every request. */
export interface Focus {
  readonly target: { readonly node: string } | { readonly edge: readonly [string, string] };
  readonly n: number;
}

export interface EditorState {
  readonly doc: MapFile;
  readonly history: History;
  readonly levelId: string;
  readonly tool: Tool;
  readonly selection: Selection;
  /** Path tool: the dot the next click connects from (null = start a new path). */
  readonly pathFrom: string | null;
  /** Room tool: the room waiting for "click another door". */
  readonly pickDoorFor: string | null;
  /** Amenity tool: what a click places. */
  readonly amenityKind: Amenity['kind'];
  /** Outline tool: what a drawn shape becomes. */
  readonly shapeKind: ShapeKind;
  readonly test: RouteTest;
  readonly focus: Focus | null;
}

export interface EditorStore {
  getState(): EditorState;
  subscribe(listener: () => void): () => void;
  run(command: Command): void;
  /** Convenience: compute the new document and record it as one undo step. */
  edit(label: string, update: (doc: MapFile) => MapFile): void;
  undo(): void;
  redo(): void;
  /** New project / import / sample: undoable like everything else. */
  load(label: string, doc: MapFile): void;
  setLevel(levelId: string): void;
  setTool(tool: Tool): void;
  select(selection: Selection): void;
  setPathFrom(nodeId: string | null): void;
  setPickDoorFor(roomId: string | null): void;
  setAmenityKind(kind: Amenity['kind']): void;
  setShapeKind(kind: ShapeKind): void;
  setTest(test: Partial<RouteTest>): void;
  /** Switch to the target's floor, select it and ask the canvas to centre on it. */
  focusOn(target: Focus['target']): void;
}

export function createEditorStore(doc: MapFile): EditorStore {
  let state: EditorState = {
    doc,
    history: emptyHistory,
    levelId: sortedLevels(doc)[0]?.id ?? '',
    tool: 'select',
    selection: null,
    pathFrom: null,
    pickDoorFor: null,
    amenityKind: 'toilet',
    shapeKind: 'room',
    test: { from: null, to: null, stepFree: false },
    focus: null,
  };
  const listeners = new Set<() => void>();
  const set = (next: EditorState) => {
    state = sanitize(next);
    for (const listener of listeners) listener();
  };
  const applied = (result: { doc: MapFile; history: History } | null) => {
    if (result) set({ ...state, ...result });
  };
  const run = (command: Command) => applied(execute(state.doc, state.history, command));

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    run,
    edit(label, update) {
      const next = update(state.doc);
      if (next !== state.doc) run(change(label, state.doc, next));
    },
    undo: () => applied(undo(state.doc, state.history)),
    redo: () => applied(redo(state.doc, state.history)),
    load: (label, next) =>
      applied(execute(state.doc, state.history, replaceDocument(label, state.doc, next))),
    setLevel: (levelId) => set({ ...state, levelId, selection: null, pathFrom: null }),
    setTool: (tool) => set({ ...state, tool, pathFrom: null, pickDoorFor: null }),
    select: (selection) => set({ ...state, selection }),
    setPathFrom: (pathFrom) => set({ ...state, pathFrom }),
    setPickDoorFor: (pickDoorFor) => set({ ...state, pickDoorFor }),
    setAmenityKind: (amenityKind) => set({ ...state, amenityKind, tool: 'amenity' }),
    setShapeKind: (shapeKind) => set({ ...state, shapeKind, tool: 'outline' }),
    setTest: (test) => set({ ...state, test: { ...state.test, ...test } }),
    focusOn(target) {
      const nodeId = 'node' in target ? target.node : target.edge[0];
      const level = state.doc.nodes.find((n) => n.id === nodeId)?.lvl ?? state.levelId;
      const testing = state.tool === 'test';
      const selection: Selection =
        'node' in target
          ? { type: 'nodes', ids: [target.node] }
          : { type: 'edge', a: target.edge[0], b: target.edge[1] };
      set({
        ...state,
        levelId: level,
        tool: testing ? 'test' : 'select',
        selection: testing ? state.selection : selection,
        focus: { target, n: (state.focus?.n ?? 0) + 1 },
      });
    },
  };
}

/** After undo/delete/import, drop references to things that no longer exist. */
function sanitize(s: EditorState): EditorState {
  const { doc } = s;
  const levelId = doc.levels.some((l) => l.id === s.levelId)
    ? s.levelId
    : (sortedLevels(doc)[0]?.id ?? '');
  const nodeIds = new Set(doc.nodes.map((n) => n.id));
  let selection = s.selection;
  if (selection?.type === 'nodes') {
    const ids = selection.ids.filter((id) => nodeIds.has(id));
    selection = ids.length > 0 ? { type: 'nodes', ids } : null;
  } else if (selection?.type === 'edge') {
    const { a, b } = selection;
    const exists = doc.edges.some((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));
    selection = exists ? selection : null;
  } else if (selection?.type === 'room') {
    const { id } = selection;
    selection = doc.rooms.some((r) => r.id === id) ? selection : null;
  } else if (selection?.type === 'connector') {
    const { id } = selection;
    selection = doc.connectors.some((c) => c.id === id) ? selection : null;
  } else if (selection?.type === 'amenity') {
    const { id } = selection;
    selection = doc.amenities.some((a) => a.id === id) ? selection : null;
  } else if (selection?.type === 'qr') {
    const { code } = selection;
    selection = doc.qr.some((q) => q.code === code) ? selection : null;
  } else if (selection?.type === 'shape') {
    const { levelId: shapeLevel, index } = selection;
    const shapes = doc.levels.find((l) => l.id === shapeLevel)?.shapes ?? [];
    selection = index < shapes.length && shapeLevel === levelId ? selection : null;
  }
  return {
    ...s,
    levelId,
    selection,
    pathFrom: s.pathFrom && nodeIds.has(s.pathFrom) ? s.pathFrom : null,
    pickDoorFor:
      s.pickDoorFor && doc.rooms.some((r) => r.id === s.pickDoorFor) ? s.pickDoorFor : null,
    test: s.test.from && !nodeIds.has(s.test.from) ? { ...s.test, from: null } : s.test,
  };
}
