import { loadSite } from '@innermap/core';
import type { MapFile } from '@innermap/schema';
import { describe, expect, it } from 'vitest';
import demo from '../../../../samples/demo-hospital/map.json';
import { sceneFor } from './map-scene';
import type { Action, State } from './state';
import { initialState, reducer } from './state';

const site = loadSite(demo as MapFile);
const run = (...actions: Action[]): State =>
  [{ type: 'map-loaded', site } as Action, ...actions].reduce(reducer, initialState);
const scanned: Action = {
  type: 'set-position',
  position: { node: 'G-ENT', facing: 0, source: 'qr' },
};
const toRadiology: Action = {
  type: 'choose',
  target: { destination: { type: 'room', roomId: 'radiology' }, label: 'Radiology' },
};

describe('what the map shows', () => {
  it('no map before we know where the visitor is', () => {
    expect(sceneFor(run())).toBeNull();
  });

  it('after a scan: the whole floor, turned the way the QR sign faces', () => {
    const scene = sceneFor(run(scanned));
    expect(scene).toMatchObject({ levelId: 'G', here: 'G-ENT', facing: 0, path: [], focus: [] });
  });

  it('while walking: this step and the next are framed, the next checkpoint pulses', () => {
    const scene = sceneFor(run(scanned, toRadiology));
    expect(scene).toMatchObject({ here: 'G-ENT', at: 0, next: 'G-LOB', facing: 0 });
    expect(scene?.focus).toEqual(['G-ENT', 'G-LOB', 'G-LA']);
  });

  it('after a turn the map faces the way the visitor walked', () => {
    const scene = sceneFor(run(scanned, toRadiology, { type: 'confirm' }));
    expect(scene).toMatchObject({ here: 'G-LOB', at: 1, next: 'G-LA', facing: 0 });
  });

  it('after the lift ride it shows the new floor', () => {
    const s = run(
      scanned,
      toRadiology,
      { type: 'confirm' },
      { type: 'confirm' },
      { type: 'confirm' },
    );
    const scene = sceneFor(s);
    expect(scene).toMatchObject({ levelId: '2', here: '2-LA', facing: 270 });
  });

  it('no map on the "I\'m lost" screen (it lists landmarks instead)', () => {
    expect(sceneFor(run(scanned, toRadiology, { type: 'lost' }))).toBeNull();
  });
});
