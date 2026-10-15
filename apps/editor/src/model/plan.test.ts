import type { MapFile } from '@innermap/schema';
import { validateMapFile } from '@innermap/schema/validate';
import { describe, expect, it } from 'vitest';
import demo from '../../../../samples/demo-hospital/map.json';
import { setScale } from './commands';
import { deleteItems, deleteRoom } from './drawing';
import {
  addShape,
  deleteShape,
  moveShapePoint,
  rectangle,
  roomForOutline,
  shapeAt,
  snapToPlan,
  updateShape,
} from './plan';
import { isLevelEmpty } from './project';

/** The demo hospital without any outlines yet. */
function bare(): MapFile {
  const map = JSON.parse(JSON.stringify(demo)) as MapFile;
  map.levels = map.levels.map(({ id, name, ord, color }) => ({ id, name, ord, color }));
  return map;
}
const shapes = (doc: MapFile, levelId = 'G') =>
  doc.levels.find((l) => l.id === levelId)?.shapes ?? [];

describe('drawing outlines', () => {
  it('a rectangle around a door becomes that room’s outline by itself', () => {
    const { doc, index } = addShape(
      bare(),
      'G',
      'room',
      rectangle({ x: 24, y: 12 }, { x: 12, y: 4 }),
    );
    expect(shapes(doc)[index]).toEqual({
      kind: 'room',
      pts: [12, 4, 24, 4, 24, 12, 12, 12],
      room: 'billing', // its door G-N18 (18, 12) is on the bottom wall
    });
    expect(validateMapFile(doc).ok).toBe(true);
  });

  it('a second outline over the same door is not linked again', () => {
    const once = addShape(bare(), 'G', 'room', rectangle({ x: 12, y: 4 }, { x: 24, y: 12 })).doc;
    expect(roomForOutline(once, 'G', rectangle({ x: 14, y: 6 }, { x: 22, y: 12 }))).toBeUndefined();
  });

  it('the walkable floor is drawn underneath everything else', () => {
    let doc = addShape(bare(), 'G', 'room', rectangle({ x: 12, y: 4 }, { x: 24, y: 12 })).doc;
    const result = addShape(doc, 'G', 'floor', rectangle({ x: 1, y: 4 }, { x: 59, y: 24 }));
    doc = result.doc;
    expect(result.index).toBe(0);
    expect(shapes(doc).map((s) => s.kind)).toEqual(['floor', 'room']);
  });

  it('snaps to a nearby corner, then to a nearby wall, then to the half-meter grid', () => {
    const doc = addShape(bare(), 'G', 'room', rectangle({ x: 12, y: 4 }, { x: 24, y: 12 })).doc;
    expect(snapToPlan(doc, 'G', { x: 23.7, y: 11.8 }, 0.6)).toEqual({ x: 24, y: 12 });
    expect(snapToPlan(doc, 'G', { x: 20.13, y: 12.3 }, 0.6)).toEqual({ x: 20, y: 12 }); // on the wall, on the grid
    expect(snapToPlan(doc, 'G', { x: 24.3, y: 7.8 }, 0.6)).toEqual({ x: 24, y: 8 });
    expect(snapToPlan(doc, 'G', { x: 40.3, y: 30.8 }, 0.6)).toEqual({ x: 40.5, y: 31 });
  });

  it('click picks the smallest outline around the point, or a wall line', () => {
    let doc = addShape(bare(), 'G', 'floor', rectangle({ x: 1, y: 4 }, { x: 59, y: 24 })).doc;
    doc = addShape(doc, 'G', 'room', rectangle({ x: 12, y: 4 }, { x: 24, y: 12 })).doc;
    doc = addShape(doc, 'G', 'wall', [30, 14, 30, 18]).doc;
    expect(shapeAt(doc, 'G', { x: 15, y: 6 }, 0.5)).toBe(1);
    expect(shapeAt(doc, 'G', { x: 40, y: 20 }, 0.5)).toBe(0);
    expect(shapeAt(doc, 'G', { x: 30.2, y: 16 }, 0.5)).toBe(2);
    expect(shapeAt(doc, 'G', { x: 80, y: 80 }, 0.5)).toBeNull();
  });
});

describe('editing outlines', () => {
  const withRoom = () =>
    addShape(bare(), 'G', 'room', rectangle({ x: 12, y: 4 }, { x: 24, y: 12 })).doc;

  it('drags a corner', () => {
    const doc = moveShapePoint(withRoom(), 'G', 0, 2, { x: 25, y: 13 });
    expect(shapes(doc)[0]?.pts).toEqual([12, 4, 24, 4, 25, 13, 12, 12]);
  });

  it('changing the kind away from room drops the room link; labels can be cleared', () => {
    let doc = updateShape(withRoom(), 'G', 0, { kind: 'void', label: 'Courtyard' });
    expect(shapes(doc)[0]).toEqual({
      kind: 'void',
      pts: [12, 4, 24, 4, 24, 12, 12, 12],
      label: 'Courtyard',
    });
    doc = updateShape(doc, 'G', 0, { label: null });
    expect(shapes(doc)[0]).not.toHaveProperty('label');
  });

  it('deleting the last outline removes the empty list (a floor can be empty again)', () => {
    const doc = deleteShape(withRoom(), 'G', 0);
    expect(doc.levels[0]).not.toHaveProperty('shapes');
  });

  it('a floor with only outlines is not empty', () => {
    const doc = addShape(bare(), '1', 'wall', [0, 0, 5, 0]).doc;
    const nodesGone = { ...doc, nodes: doc.nodes.filter((n) => n.lvl !== '1') };
    expect(isLevelEmpty(nodesGone, '1')).toBe(false);
  });

  it('deleting a room (or its only door) unlinks its outline instead of breaking the file', () => {
    expect(shapes(deleteRoom(withRoom(), 'billing'))[0]).not.toHaveProperty('room');
    const doorGone = deleteItems(withRoom(), new Set(['G-N18']), []);
    expect(shapes(doorGone)[0]).not.toHaveProperty('room');
    expect(validateMapFile(doorGone).ok).toBe(true);
  });

  it('setting the floor scale rescales outlines together with the dots', () => {
    const doc = withRoom();
    const scaled = setScale(doc, 'G', 20, 10).apply(doc); // twice as many px per meter
    expect(shapes(scaled)[0]?.pts).toEqual([6, 2, 12, 2, 12, 6, 6, 6]);
    expect(scaled.nodes.find((n) => n.id === 'G-N18')).toMatchObject({ x: 9, y: 6 });
  });
});
