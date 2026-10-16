/**
 * Floor plan outlines (Phase 9): rooms, the walkable floor, lifts, stairs, voids and walls,
 * drawn over the floor-plan image. Pure like drawing.ts — the canvas only turns gestures into
 * these calls. Shapes have no ids; they are addressed by (floor, index in `level.shapes`).
 */
import type { Point } from '@innermap/core';
import { containsPoint, projectOnSegment, shapePoints, shapeSides } from '@innermap/core';
import type { Level, MapFile, Shape } from '@innermap/schema';
import { buildingForFootprint } from './campus';

export type ShapeKind = Shape['kind'];

/** Plans snap to a half-meter grid unless a nearby corner or wall is closer. */
export const GRID = 0.5;

const round = (v: number) => Math.round(v * 100) / 100;
const onGrid = (v: number) => round(Math.round(v / GRID) * GRID);

/** A copy without `key` (optional fields are left out, never set to undefined). */
function omit<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  return Object.fromEntries(Object.entries(value).filter(([k]) => k !== key)) as Omit<T, K>;
}

function levelShapes(doc: MapFile, levelId: string): readonly Shape[] {
  return doc.levels.find((l) => l.id === levelId)?.shapes ?? [];
}

function withShapes(doc: MapFile, levelId: string, shapes: Shape[]): MapFile {
  return {
    ...doc,
    levels: doc.levels.map((l): Level => {
      if (l.id !== levelId) return l;
      return shapes.length > 0 ? { ...l, shapes } : omit(l, 'shapes');
    }),
  };
}

/**
 * Where a click lands on the plan: an existing corner within `tolerance` (so rooms share
 * corners), else a point on an existing wall (so a new wall meets it), else the grid.
 */
export function snapToPlan(
  doc: MapFile,
  levelId: string,
  p: Point,
  tolerance: number,
  skip?: { index: number; point: number },
): Point {
  const shapes = levelShapes(doc, levelId);
  let best: Point | null = null;
  let bestDistance = tolerance;
  shapes.forEach((shape, index) =>
    shapePoints(shape).forEach((corner, point) => {
      if (skip && skip.index === index && skip.point === point) return;
      const d = Math.hypot(corner.x - p.x, corner.y - p.y);
      if (d <= bestDistance) {
        best = corner;
        bestDistance = d;
      }
    }),
  );
  if (best) return best;
  for (const [index, shape] of shapes.entries()) {
    if (skip?.index === index) continue;
    for (const [a, b] of shapeSides(shape)) {
      const { point } = projectOnSegment(p, a, b);
      const d = Math.hypot(point.x - p.x, point.y - p.y);
      if (d <= bestDistance) {
        // Along a straight horizontal / vertical wall the grid still applies.
        if (a.y === b.y) best = { x: onGrid(point.x), y: a.y };
        else if (a.x === b.x) best = { x: a.x, y: onGrid(point.y) };
        else best = { x: round(point.x), y: round(point.y) };
        bestDistance = d;
      }
    }
  }
  return best ?? { x: onGrid(p.x), y: onGrid(p.y) };
}

/** Corners of the rectangle spanned by two opposite corners, clockwise from top-left. */
export function rectangle(a: Point, b: Point): number[] {
  const [x1, x2] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
  const [y1, y2] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
  return [x1, y1, x2, y1, x2, y2, x1, y2];
}

/**
 * The room an outline most likely belongs to: one without an outline yet whose door lies on
 * or inside it (doors usually sit on the room's wall).
 */
export function roomForOutline(
  doc: MapFile,
  levelId: string,
  pts: readonly number[],
): string | undefined {
  const outline: Shape = { kind: 'room', pts: [...pts] };
  const linked = new Set(doc.levels.flatMap((l) => (l.shapes ?? []).map((s) => s.room)));
  const nodes = new Map(doc.nodes.map((n) => [n.id, n]));
  const touches = (p: Point) =>
    containsPoint(outline, p) ||
    shapeSides(outline).some(([a, b]) => {
      const { point } = projectOnSegment(p, a, b);
      return Math.hypot(point.x - p.x, point.y - p.y) <= 0.5;
    });
  return doc.rooms.find(
    (room) =>
      !linked.has(room.id) &&
      room.doors.some((id) => {
        const door = nodes.get(id);
        return door?.lvl === levelId && touches(door);
      }),
  )?.id;
}

/**
 * Drawing order, bottom to top: the ground (roads, lawns, parking), building footprints, the
 * walkable floor, then rooms and everything else on top.
 */
const LAYER: Partial<Record<ShapeKind, number>> = {
  road: 0,
  green: 0,
  parking: 0,
  water: 0,
  tree: 0,
  building: 1,
  floor: 2,
};
const layerOf = (kind: ShapeKind) => LAYER[kind] ?? 3;

export function addShape(
  doc: MapFile,
  levelId: string,
  kind: ShapeKind,
  pts: readonly number[],
): { doc: MapFile; index: number } {
  const room = kind === 'room' ? roomForOutline(doc, levelId, pts) : undefined;
  const building = kind === 'building' ? buildingForFootprint(doc) : undefined;
  const shape: Shape = {
    kind,
    pts: pts.map(round),
    ...(room !== undefined && { room }),
    ...(building !== undefined && { building }),
  };
  const shapes = [...levelShapes(doc, levelId)];
  const above = shapes.findIndex((s) => layerOf(s.kind) > layerOf(kind));
  const index = above === -1 ? shapes.length : above;
  shapes.splice(index, 0, shape);
  return { doc: withShapes(doc, levelId, shapes), index };
}

/** `null` removes the room link or label. */
export interface ShapePatch {
  readonly kind?: ShapeKind;
  readonly room?: string | null;
  readonly building?: string | null;
  readonly label?: string | null;
}

export function updateShape(
  doc: MapFile,
  levelId: string,
  index: number,
  patch: ShapePatch,
): MapFile {
  const shapes = [...levelShapes(doc, levelId)];
  const shape = shapes[index];
  if (!shape) return doc;
  const merged: Record<string, unknown> = { ...shape, ...patch };
  if (merged['kind'] !== 'room') merged['room'] = null;
  if (merged['kind'] !== 'building') merged['building'] = null;
  shapes[index] = Object.fromEntries(
    Object.entries(merged).filter(([, v]) => v !== null && v !== undefined && v !== ''),
  ) as Shape;
  return withShapes(doc, levelId, shapes);
}

export function moveShapePoint(
  doc: MapFile,
  levelId: string,
  index: number,
  point: number,
  to: Point,
): MapFile {
  const shapes = [...levelShapes(doc, levelId)];
  const shape = shapes[index];
  if (!shape || point * 2 + 1 >= shape.pts.length) return doc;
  const pts = [...shape.pts];
  pts[point * 2] = round(to.x);
  pts[point * 2 + 1] = round(to.y);
  shapes[index] = { ...shape, pts };
  return withShapes(doc, levelId, shapes);
}

export function deleteShape(doc: MapFile, levelId: string, index: number): MapFile {
  const shapes = levelShapes(doc, levelId).filter((_, i) => i !== index);
  return withShapes(doc, levelId, shapes);
}

/** Which shape a click picks: a wall within `tolerance`, else the smallest outline around it. */
export function shapeAt(doc: MapFile, levelId: string, p: Point, tolerance: number): number | null {
  const shapes = levelShapes(doc, levelId);
  let best: number | null = null;
  let bestArea = Infinity;
  shapes.forEach((shape, index) => {
    if (shape.kind === 'wall') {
      const near = shapeSides(shape).some(([a, b]) => {
        const { point } = projectOnSegment(p, a, b);
        return Math.hypot(point.x - p.x, point.y - p.y) <= tolerance;
      });
      if (near) {
        best = index;
        bestArea = 0;
      }
      return;
    }
    if (!containsPoint(shape, p)) return;
    const area = Math.abs(
      shapeSides(shape).reduce((sum, [a, b]) => sum + a.x * b.y - b.x * a.y, 0) / 2,
    );
    if (area < bestArea) {
      best = index;
      bestArea = area;
    }
  });
  return best;
}

/** Outlines must not point at deleted rooms: drop those links (same array when unchanged). */
export function unlinkMissingRooms(doc: MapFile): MapFile {
  const rooms = new Set(doc.rooms.map((r) => r.id));
  let changed = false;
  const levels = doc.levels.map((level) => {
    if (!level.shapes?.some((s) => s.room !== undefined && !rooms.has(s.room))) return level;
    changed = true;
    return {
      ...level,
      shapes: level.shapes.map((s) => {
        return s.room === undefined || rooms.has(s.room) ? s : omit(s, 'room');
      }),
    };
  });
  return changed ? { ...doc, levels } : doc;
}
