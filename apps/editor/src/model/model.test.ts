import type { MapFile } from '@innermap/schema';
import { validateMapFile } from '@innermap/schema/validate';
import { describe, expect, it } from 'vitest';
import demo from '../../../../samples/demo-hospital/map.json';
import type { Command } from './commands';
import {
  addLevel,
  composite,
  moveLevel,
  moveNodes,
  removeLevel,
  renameSite,
  setScale,
  updateLevel,
} from './commands';
import { emptyHistory, execute, redo, undo } from './history';
import { DEFAULT_PX_PER_METER, newProject, nextLevel, sortedLevels } from './project';
import { createEditorStore } from './store';

const demoDoc = (): MapFile => JSON.parse(JSON.stringify(demo)) as MapFile;

/** Apply then revert must give back exactly the original document. */
function roundTrips(doc: MapFile, command: Command): void {
  const after = command.apply(doc);
  expect(after).not.toEqual(doc);
  expect(command.revert(after)).toEqual(doc);
}

describe('every command can be undone exactly', () => {
  const doc = demoDoc();
  it.each<[string, Command]>([
    ['rename site', renameSite(doc, 'City Hospital')],
    ['rename floor', updateLevel(doc, '1', { name: 'OPD floor' })],
    ['floor color', updateLevel(doc, '2', { color: 'rose' })],
    ['add plan image', updateLevel(doc, 'G', { image: 'img-1-ground.png' })],
    ['add floor', addLevel(nextLevel(doc))],
    ['move floor', moveLevel(doc, 'G', 1) as Command],
    ['move dots', moveNodes([{ id: 'G-W', from: { x: 5, y: 15 }, to: { x: 6, y: 16 } }])],
    ['set scale', setScale(doc, 'G', 25, DEFAULT_PX_PER_METER)],
  ])('%s', (_name, command) => roundTrips(doc, command));

  it('removing an optional field is undone too', () => {
    const withImage = updateLevel(doc, 'G', { image: 'x.png', pxPerMeter: 20 }).apply(doc);
    const remove = updateLevel(withImage, 'G', { image: null, pxPerMeter: null });
    const removed = remove.apply(withImage);
    expect(removed.levels.find((l) => l.id === 'G')).not.toHaveProperty('image');
    expect(remove.revert(removed)).toEqual(withImage);
  });

  it('deleting an empty floor is undone at the same position', () => {
    const withFloor = addLevel(nextLevel(doc)).apply(doc);
    const id = withFloor.levels.at(-1)?.id ?? '';
    roundTrips(withFloor, removeLevel(withFloor, id));
  });

  it('refuses to delete a floor that has dots on it', () => {
    expect(() => removeLevel(doc, 'G')).toThrow(/not empty/);
  });
});

describe('set scale', () => {
  it('rescales the dots on that floor so they stay on the image', () => {
    const doc = demoDoc(); // demo floors have no scale → drawn at the default 10 px/m
    const scaled = setScale(doc, 'G', 20, DEFAULT_PX_PER_METER).apply(doc);
    const before = doc.nodes.find((n) => n.id === 'G-W');
    const after = scaled.nodes.find((n) => n.id === 'G-W');
    // Same image pixel: 5 m × 10 px/m = 50 px = 2.5 m × 20 px/m.
    expect(after).toMatchObject({ x: (before?.x ?? 0) / 2, y: (before?.y ?? 0) / 2 });
    expect(scaled.levels.find((l) => l.id === 'G')?.pxPerMeter).toBe(20);
    // Other floors untouched.
    expect(scaled.nodes.find((n) => n.id === '1-W')).toEqual(doc.nodes.find((n) => n.id === '1-W'));
  });

  it('keeps the map valid', () => {
    const doc = demoDoc();
    expect(validateMapFile(setScale(doc, '2', 31.5, DEFAULT_PX_PER_METER).apply(doc)).ok).toBe(
      true,
    );
  });
});

describe('floors', () => {
  it('a new floor goes on top with an unused id and the next color', () => {
    const doc = newProject();
    const one = nextLevel(doc);
    expect(one).toMatchObject({ id: '1', name: 'Floor 1', ord: 1 });
    const two = nextLevel(addLevel(one).apply(doc));
    expect(two).toMatchObject({ id: '2', ord: 2 });
    expect(two.color).not.toBe(one.color);
  });

  it('moving a floor swaps order with its neighbour; ends cannot move further', () => {
    const doc = demoDoc();
    const moved = (moveLevel(doc, 'G', 1) as Command).apply(doc);
    expect(sortedLevels(moved).map((l) => l.id)).toEqual(['1', 'G', '2']);
    expect(moveLevel(doc, 'G', -1)).toBeNull();
    expect(moveLevel(doc, '2', 1)).toBeNull();
  });
});

describe('history', () => {
  it('undo / redo walk back and forth; a new action clears redo', () => {
    const doc = newProject();
    let state = { doc, history: emptyHistory };
    state = execute(state.doc, state.history, renameSite(state.doc, 'A'));
    state = execute(state.doc, state.history, renameSite(state.doc, 'B'));
    state = undo(state.doc, state.history) ?? state;
    expect(state.doc.site.name).toBe('A');
    state = redo(state.doc, state.history) ?? state;
    expect(state.doc.site.name).toBe('B');
    state = undo(state.doc, state.history) ?? state;
    state = execute(state.doc, state.history, renameSite(state.doc, 'C'));
    expect(state.history.future).toHaveLength(0);
    expect(redo(state.doc, state.history)).toBeNull();
  });

  it('a composite command is ONE undo step', () => {
    const doc = demoDoc();
    const both = composite('two edits', [
      renameSite(doc, 'X'),
      updateLevel(doc, 'G', { name: 'Lobby' }),
    ]);
    const applied = execute(doc, emptyHistory, both);
    expect(applied.history.past).toHaveLength(1);
    expect(undo(applied.doc, applied.history)?.doc).toEqual(doc);
  });
});

describe('editor store', () => {
  it('loading a project is undoable, and the current floor stays valid', () => {
    const store = createEditorStore(demoDoc());
    store.setLevel('2');
    store.load('New project', newProject());
    expect(store.getState().levelId).toBe('G');
    expect(store.getState().doc.nodes).toHaveLength(0);
    store.undo();
    expect(store.getState().doc.nodes.length).toBeGreaterThan(0);
  });

  it('notifies subscribers on every change', () => {
    const store = createEditorStore(newProject());
    let calls = 0;
    store.subscribe(() => calls++);
    store.run(renameSite(store.getState().doc, 'Hospital'));
    store.undo();
    store.setTool('scale');
    expect(calls).toBe(3);
  });
});
