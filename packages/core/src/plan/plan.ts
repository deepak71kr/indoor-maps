/**
 * Floor plan geometry for the 2D map (Phase 9). Pure helpers shared by the visitor map view
 * and the editor: shape points, label positions, door gaps in walls, the route line per floor
 * and which way the visitor is facing. Routing never depends on any of this.
 */
import type { Shape } from '@innermap/schema';
import type { Point } from '../directions/geometry';
import { heading } from '../directions/geometry';
import type { Graph } from '../graph/types';

export interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** A straight line from (x1, y1) to (x2, y2), e.g. a door gap. */
export type Segment = readonly [number, number, number, number];

/** Shapes drawn as closed outlines whose edges are walls with possible door gaps. */
const WALLED = new Set<Shape['kind']>(['floor', 'room', 'lift', 'stairs']);

/** How far (m) a door dot may sit from a wall and still open a gap in it. */
const DOOR_SNAP_METERS = 0.4;

export function shapePoints(shape: Shape): Point[] {
  const points: Point[] = [];
  for (let i = 0; i + 1 < shape.pts.length; i += 2) {
    points.push({ x: shape.pts[i] ?? 0, y: shape.pts[i + 1] ?? 0 });
  }
  return points;
}

/** The sides of a shape: every consecutive pair, plus the closing side for outlines. */
export function shapeSides(shape: Shape): Array<[Point, Point]> {
  const points = shapePoints(shape);
  const sides: Array<[Point, Point]> = [];
  const count = shape.kind === 'wall' ? points.length - 1 : points.length;
  for (let i = 0; i < count; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (a && b) sides.push([a, b]);
  }
  return sides;
}

export function boundsOf(points: Iterable<Point>): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return minX === Infinity ? null : { minX, minY, maxX, maxY };
}

/** Where to put a room's label: the area centroid (bounding-box centre if degenerate). */
export function labelPoint(shape: Shape): Point {
  const points = shapePoints(shape);
  let area = 0;
  let cx = 0;
  let cy = 0;
  points.forEach((a, i) => {
    const b = points[(i + 1) % points.length] ?? a;
    const cross = a.x * b.y - b.x * a.y;
    area += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  });
  if (Math.abs(area) > 1e-9) return { x: cx / (3 * area), y: cy / (3 * area) };
  const box = boundsOf(points) ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
}

/** Even-odd test: is the point inside the outline? */
export function containsPoint(shape: Shape, p: Point): boolean {
  const points = shapePoints(shape);
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    if (!a || !b) continue;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** Closest point on segment a–b to p, and how far along it is (0…1). */
export function projectOnSegment(p: Point, a: Point, b: Point): { point: Point; t: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length2 = dx * dx + dy * dy;
  const t =
    length2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2));
  return { point: { x: a.x + t * dx, y: a.y + t * dy }, t };
}

/**
 * Openings to cut into walls: for every door-like dot lying on an outline's side, a short
 * segment centred on it along that side. Drawn in the corridor color over the wall stroke,
 * so plans need no separate door data — the routing dots already say where doors are.
 */
export function doorGaps(
  shapes: readonly Shape[],
  doors: readonly Point[],
  width = 1.2,
): Segment[] {
  const gaps: Segment[] = [];
  for (const shape of shapes) {
    if (!WALLED.has(shape.kind)) continue;
    for (const [a, b] of shapeSides(shape)) {
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (length < 1e-6) continue;
      const half = Math.min(width, length * 0.8) / 2;
      const ux = (b.x - a.x) / length;
      const uy = (b.y - a.y) / length;
      for (const door of doors) {
        const { point } = projectOnSegment(door, a, b);
        if (Math.hypot(point.x - door.x, point.y - door.y) > DOOR_SNAP_METERS) continue;
        gaps.push([
          point.x - ux * half,
          point.y - uy * half,
          point.x + ux * half,
          point.y + uy * half,
        ]);
      }
    }
  }
  return gaps;
}

/** The route as polylines, grouped by floor (a lift ride ends one line and starts another). */
export function routeLines(graph: Graph, path: readonly string[]): Map<string, Point[][]> {
  const lines = new Map<string, Point[][]>();
  let current: Point[] | null = null;
  let currentLevel = '';
  for (const id of path) {
    const node = graph.nodes.get(id);
    if (!node) continue;
    if (!current || node.level !== currentLevel) {
      current = [];
      currentLevel = node.level;
      const list = lines.get(node.level) ?? [];
      list.push(current);
      lines.set(node.level, list);
    }
    current.push({ x: node.x, y: node.y });
  }
  return lines;
}

/**
 * Which way the visitor faces while standing at `path[index]`: the direction they walked in
 * (so "Turn RIGHT" turns right on a map drawn facing-up), else the way they are about to walk,
 * else `fallback` (a QR sticker's facing). Null when nothing is known.
 */
export function facingAt(
  graph: Graph,
  path: readonly string[],
  index: number,
  fallback?: number,
): number | null {
  const at = graph.nodes.get(path[index] ?? '');
  if (!at) return fallback ?? null;
  if (index === 0 && fallback !== undefined) return fallback;
  const before = graph.nodes.get(path[index - 1] ?? '');
  if (before && before.level === at.level) {
    const arrived = heading(before, at);
    if (arrived !== null) return arrived;
  }
  for (let i = index + 1; i < path.length; i++) {
    const next = graph.nodes.get(path[i] ?? '');
    if (!next || next.level !== at.level) break;
    const leaving = heading(at, next);
    if (leaving !== null) return leaving;
  }
  return fallback ?? null;
}
