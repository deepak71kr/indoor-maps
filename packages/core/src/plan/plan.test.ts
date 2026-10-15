import type { Shape } from '@innermap/schema';
import { describe, expect, it } from 'vitest';
import { buildGraph } from '../graph/build-graph';
import { demoMap } from '../test-support';
import { containsPoint, doorGaps, facingAt, labelPoint, routeLines, shapeSides } from './plan';

const square: Shape = { kind: 'room', pts: [0, 0, 10, 0, 10, 6, 0, 6] };
const lShape: Shape = { kind: 'room', pts: [0, 0, 10, 0, 10, 2, 2, 2, 2, 10, 0, 10] };

describe('shapes', () => {
  it('closes outlines but not walls', () => {
    expect(shapeSides(square)).toHaveLength(4);
    expect(shapeSides({ kind: 'wall', pts: [0, 0, 5, 0, 5, 5] })).toHaveLength(2);
  });

  it('labels a room at its centre of area', () => {
    expect(labelPoint(square)).toEqual({ x: 5, y: 3 });
    const p = labelPoint(lShape);
    expect(containsPoint(lShape, { x: 1, y: 9 })).toBe(true);
    expect(containsPoint(lShape, { x: 8, y: 8 })).toBe(false);
    expect(p.x).toBeCloseTo(p.y); // symmetric L
  });
});

describe('doorGaps', () => {
  it('opens a 1.2 m gap where a door dot sits on a wall', () => {
    expect(doorGaps([square], [{ x: 5, y: 6 }])).toEqual([[5.6, 6, 4.4, 6]]); // along the side 10,6 → 0,6
  });

  it('ignores dots away from walls, and walls of voids', () => {
    expect(doorGaps([square], [{ x: 5, y: 3 }])).toEqual([]);
    expect(doorGaps([{ ...square, kind: 'void' }], [{ x: 5, y: 6 }])).toEqual([]);
  });

  it('opens both rooms when a door sits on a shared wall', () => {
    const below: Shape = { kind: 'room', pts: [0, 6, 10, 6, 10, 12, 0, 12] };
    expect(doorGaps([square, below], [{ x: 3, y: 6.2 }])).toHaveLength(2);
  });
});

describe('route on the map', () => {
  const graph = buildGraph(demoMap());
  const path = ['G-ENT', 'G-LOB', 'G-LA', '2-LA', '2-LOB', '2-C30', '2-N30'];

  it('splits the route into one line per floor', () => {
    const lines = routeLines(graph, path);
    expect([...lines.keys()]).toEqual(['G', '2']);
    expect(lines.get('G')?.[0]).toHaveLength(3);
    expect(lines.get('2')?.[0]).toEqual([
      { x: 34, y: 22 },
      { x: 30, y: 22 },
      { x: 30, y: 15 },
      { x: 30, y: 12 },
    ]);
  });

  it('faces the QR sign at the start, then the way the visitor walked', () => {
    expect(facingAt(graph, path, 0, 0)).toBe(0);
    expect(facingAt(graph, path, 0)).toBe(0); // about to walk north
    expect(facingAt(graph, path, 2)).toBe(90); // arrived at Lift A walking east
    expect(facingAt(graph, path, 3)).toBe(270); // out of the lift: about to walk west
    expect(facingAt(graph, path, 5)).toBe(0);
  });
});
