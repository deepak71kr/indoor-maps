/**
 * Drawing operations behind the editor's tools. Pure: each takes the document and returns the
 * changed document (plus ids the tool needs); `change()` turns that into an exact-undo Command.
 * The canvas only translates clicks into these calls, so all of this is unit-tested.
 */
import type { Amenity, Connector, Edge, MapFile, MapNode, Room } from '@innermap/schema';
import type { Command } from './commands';

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** What is under the pointer: a dot, a line (with the closest point on it), or nothing. */
export type Hit =
  | { readonly type: 'node'; readonly id: string }
  | { readonly type: 'edge'; readonly a: string; readonly b: string; readonly point: Point }
  | { readonly type: 'none' };

/** A Command that swaps whichever top-level lists changed (exact undo, since history is LIFO). */
export function change(label: string, before: MapFile, after: MapFile): Command {
  const keys = (Object.keys(after) as Array<keyof MapFile>).filter((k) => after[k] !== before[k]);
  const take = (doc: MapFile, from: MapFile): MapFile => ({
    ...doc,
    ...Object.fromEntries(keys.map((k) => [k, from[k]])),
  });
  return { label, apply: (d) => take(d, after), revert: (d) => take(d, before) };
}

export function newId(prefix: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  for (let n = 1; ; n++) if (!used.has(`${prefix}${n}`)) return `${prefix}${n}`;
}

const distance = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y);

/** Closest point to `p` on segment a–b, and how far along it is (0..1). */
export function project(p: Point, a: Point, b: Point): { point: Point; t: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return { point: { x: a.x + t * dx, y: a.y + t * dy }, t };
}

/** Dots win over lines; only things on `levelId` within `tolerance` meters count. */
export function hitTest(doc: MapFile, levelId: string, p: Point, tolerance: number): Hit {
  let best: Hit = { type: 'none' };
  let bestDistance = tolerance;
  for (const n of doc.nodes) {
    if (n.lvl !== levelId) continue;
    const d = distance(n, p);
    if (d <= bestDistance) {
      best = { type: 'node', id: n.id };
      bestDistance = d;
    }
  }
  if (best.type === 'node') return best;
  const nodes = nodeMap(doc);
  for (const e of doc.edges) {
    const a = nodes.get(e.a);
    const b = nodes.get(e.b);
    if (!a || !b || a.lvl !== levelId) continue;
    const { point } = project(p, a, b);
    const d = distance(point, p);
    if (d <= bestDistance) {
      best = { type: 'edge', a: e.a, b: e.b, point };
      bestDistance = d;
    }
  }
  return best;
}

const nodeMap = (doc: MapFile) => new Map(doc.nodes.map((n) => [n.id, n]));
const sameEdge = (e: Edge, a: string, b: string) =>
  (e.a === a && e.b === b) || (e.a === b && e.b === a);
const round = (v: number) => Math.round(v * 100) / 100; // centimeters are plenty

export function addNode(
  doc: MapFile,
  levelId: string,
  p: Point,
  kind: MapNode['kind'],
): { doc: MapFile; id: string } {
  const id = newId(
    `${levelId}-`,
    doc.nodes.map((n) => n.id),
  );
  const node: MapNode = { id, lvl: levelId, x: round(p.x), y: round(p.y), kind };
  return { doc: { ...doc, nodes: [...doc.nodes, node] }, id };
}

export function addEdge(doc: MapFile, a: string, b: string): MapFile {
  if (a === b || doc.edges.some((e) => sameEdge(e, a, b))) return doc;
  return { ...doc, edges: [...doc.edges, { a, b }] };
}

/** Insert a dot on line a–b at `p` (kept on the line); the two halves keep the line's settings. */
export function splitEdge(
  doc: MapFile,
  a: string,
  b: string,
  p: Point,
): { doc: MapFile; id: string } {
  const edge = doc.edges.find((e) => sameEdge(e, a, b));
  const nodes = nodeMap(doc);
  const na = nodes.get(a);
  const nb = nodes.get(b);
  if (!edge || !na || !nb) throw new Error(`No line ${a}–${b}`);
  const added = addNode(doc, na.lvl, project(p, na, nb).point, 'junction');
  const { a: from, b: to, ...settings } = edge;
  const edges = added.doc.edges.flatMap((e) =>
    e === edge
      ? [
          { ...settings, a: from, b: added.id },
          { ...settings, a: added.id, b: to },
        ]
      : [e],
  );
  return { doc: { ...added.doc, edges }, id: added.id };
}

/** One click of the Path tool: snap to a dot, split a line, or add a dot; join from the previous one. */
export function addPathPoint(
  doc: MapFile,
  levelId: string,
  previous: string | null,
  p: Point,
  hit: Hit,
): { doc: MapFile; id: string } {
  const target =
    hit.type === 'node'
      ? { doc, id: hit.id }
      : hit.type === 'edge'
        ? splitEdge(doc, hit.a, hit.b, hit.point)
        : addNode(doc, levelId, p, 'junction');
  return { doc: previous ? addEdge(target.doc, previous, target.id) : target.doc, id: target.id };
}

/** How close (meters) a door can be to a corridor dot before it simply uses that dot. */
const SNAP_TO_DOT = 1;
/** How far (meters) the Door tool looks for a corridor to connect to. */
const DOOR_REACH = 20;

/** Door tool: a door dot at `p`, joined to the nearest corridor (splitting it if needed). */
export function placeDoor(doc: MapFile, levelId: string, p: Point): { doc: MapFile; id: string } {
  const nodes = nodeMap(doc);
  let anchor: { point: Point; edge?: Edge; node?: string } | null = null;
  let best = DOOR_REACH;
  for (const e of doc.edges) {
    const a = nodes.get(e.a);
    const b = nodes.get(e.b);
    if (!a || !b || a.lvl !== levelId || a.kind === 'door' || b.kind === 'door') continue;
    const { point, t } = project(p, a, b);
    const d = distance(point, p);
    if (d < best) {
      best = d;
      const end = t < 0.5 ? a : b;
      anchor =
        distance(point, end) <= SNAP_TO_DOT ? { point: end, node: end.id } : { point, edge: e };
    }
  }
  if (!anchor) {
    for (const n of doc.nodes) {
      if (n.lvl !== levelId) continue;
      const d = distance(n, p);
      if (d < best) {
        best = d;
        anchor = { point: n, node: n.id };
      }
    }
  }
  let next = doc;
  let anchorId: string | null = anchor?.node ?? null;
  if (anchor?.edge) {
    const split = splitEdge(next, anchor.edge.a, anchor.edge.b, anchor.point);
    next = split.doc;
    anchorId = split.id;
  }
  const door = addNode(next, levelId, p, 'door');
  return { doc: anchorId ? addEdge(door.doc, anchorId, door.id) : door.doc, id: door.id };
}

// ---------- rooms ----------

export function roomOfDoor(doc: MapFile, doorId: string): Room | undefined {
  return doc.rooms.find((r) => r.doors.includes(doorId));
}

export function createRoom(doc: MapFile, doorId: string): { doc: MapFile; id: string } {
  const door = doc.nodes.find((n) => n.id === doorId);
  const id = newId(
    'room-',
    doc.rooms.map((r) => r.id),
  );
  const room: Room = { id, name: door?.landmark ?? 'New room', category: 'other', doors: [doorId] };
  return { doc: { ...doc, rooms: [...doc.rooms, room] }, id };
}

export function addDoorToRoom(doc: MapFile, roomId: string, doorId: string): MapFile {
  return {
    ...doc,
    rooms: doc.rooms.map((r) =>
      r.id === roomId && !r.doors.includes(doorId) ? { ...r, doors: [...r.doors, doorId] } : r,
    ),
  };
}

export type RoomPatch = Partial<Pick<Room, 'name' | 'category'>> & {
  readonly number?: string | null;
  readonly visibility?: Room['visibility'] | null;
};

export function updateRoom(doc: MapFile, roomId: string, patch: RoomPatch): MapFile {
  return { ...doc, rooms: doc.rooms.map((r) => (r.id === roomId ? withPatch(r, patch) : r)) };
}

// ---------- lifts & stairs ----------

/** Lift / Stairs tool: one connector with a stop dot at `p` on every chosen floor. */
export function placeConnector(
  doc: MapFile,
  kind: Connector['kind'],
  p: Point,
  levelIds: readonly string[],
): { doc: MapFile; id: string } {
  const sameKind = doc.connectors.filter((c) => c.kind === kind).length;
  const name =
    kind === 'lift'
      ? `Lift ${String.fromCharCode(65 + (sameKind % 26))}`
      : `Staircase ${sameKind + 1}`;
  const id = newId(
    `${kind}-`,
    doc.connectors.map((c) => c.id),
  );
  let next = doc;
  const stops: Record<string, string> = {};
  for (const levelId of levelIds) {
    const stop = addNode(next, levelId, p, kind === 'lift' ? 'lift-stop' : 'stairs-stop');
    next = {
      ...stop.doc,
      nodes: stop.doc.nodes.map((n) => (n.id === stop.id ? { ...n, landmark: name } : n)),
    };
    stops[levelId] = stop.id;
  }
  return { doc: { ...next, connectors: [...next.connectors, { id, kind, name, stops }] }, id };
}

/** Choose which floors a lift/staircase serves: adds stops (same spot) or removes them. */
export function setConnectorLevels(
  doc: MapFile,
  connectorId: string,
  levelIds: readonly string[],
): MapFile {
  const connector = doc.connectors.find((c) => c.id === connectorId);
  if (!connector) return doc;
  const anchor = doc.nodes.find((n) => Object.values(connector.stops).includes(n.id));
  if (!anchor) return doc;
  const wanted = new Set(levelIds);
  const removed = Object.entries(connector.stops)
    .filter(([lvl]) => !wanted.has(lvl))
    .map(([, node]) => node);
  let next = deleteItems(doc, new Set(removed), []);
  const stops: Record<string, string> = Object.fromEntries(
    Object.entries(connector.stops).filter(([lvl]) => wanted.has(lvl)),
  );
  for (const levelId of levelIds) {
    if (stops[levelId]) continue;
    const stop = addNode(next, levelId, anchor, anchor.kind);
    next = {
      ...stop.doc,
      nodes: stop.doc.nodes.map((n) => (n.id === stop.id ? { ...n, landmark: connector.name } : n)),
    };
    stops[levelId] = stop.id;
  }
  return {
    ...next,
    connectors: next.connectors.map((c) => (c.id === connectorId ? { ...c, stops } : c)),
  };
}

export function renameConnector(doc: MapFile, connectorId: string, name: string): MapFile {
  return {
    ...doc,
    connectors: doc.connectors.map((c) => (c.id === connectorId ? { ...c, name } : c)),
  };
}

export function deleteConnector(doc: MapFile, connectorId: string): MapFile {
  const connector = doc.connectors.find((c) => c.id === connectorId);
  if (!connector) return doc;
  const next = deleteItems(doc, new Set(Object.values(connector.stops)), []);
  return { ...next, connectors: next.connectors.filter((c) => c.id !== connectorId) };
}

// ---------- editing & deleting ----------

export type NodePatch = { readonly kind?: MapNode['kind']; readonly landmark?: string | null };

export function updateNode(doc: MapFile, id: string, patch: NodePatch): MapFile {
  return { ...doc, nodes: doc.nodes.map((n) => (n.id === id ? withPatch(n, patch) : n)) };
}

export type EdgePatch = {
  readonly kind?: Edge['kind'] | null;
  readonly tags?: readonly string[] | null;
  readonly oneWay?: boolean | null;
};

export function updateEdge(doc: MapFile, a: string, b: string, patch: EdgePatch): MapFile {
  return { ...doc, edges: doc.edges.map((e) => (sameEdge(e, a, b) ? withPatch(e, patch) : e)) };
}

/**
 * Delete dots and lines, and clean up everything that pointed at them: lines touching deleted
 * dots, room doors, amenities, QR stickers and lift/stair stops (empty rooms/connectors go too).
 */
export function deleteItems(
  doc: MapFile,
  nodeIds: ReadonlySet<string>,
  edges: ReadonlyArray<readonly [string, string]>,
): MapFile {
  const keepNode = (id: string) => !nodeIds.has(id);
  const rooms = doc.rooms
    .map((r) => ({ ...r, doors: r.doors.filter(keepNode) }))
    .filter((r) => r.doors.length > 0);
  const connectors = doc.connectors
    .map((c) => ({
      ...c,
      stops: Object.fromEntries(Object.entries(c.stops).filter(([, n]) => keepNode(n))),
    }))
    .filter((c) => Object.keys(c.stops).length > 0);
  return {
    ...doc,
    nodes: doc.nodes.filter((n) => keepNode(n.id)),
    edges: doc.edges.filter(
      (e) => keepNode(e.a) && keepNode(e.b) && !edges.some(([a, b]) => sameEdge(e, a, b)),
    ),
    rooms: changedList(doc.rooms, rooms),
    connectors: changedList(doc.connectors, connectors),
    amenities: doc.amenities.filter((a) => keepNode(a.node)),
    qr: doc.qr.filter((q) => keepNode(q.node)),
  };
}

export function deleteRoom(doc: MapFile, roomId: string): MapFile {
  return { ...doc, rooms: doc.rooms.filter((r) => r.id !== roomId) };
}

/** Keep the original array when nothing changed (so undo only records real changes). */
function changedList<T>(before: readonly T[], after: T[]): T[] {
  const same =
    before.length === after.length &&
    before.every((item, i) => JSON.stringify(item) === JSON.stringify(after[i]));
  return same ? (before as T[]) : after;
}

/** Shallow patch where `null` removes a field and `undefined` leaves it alone. */
function withPatch<T extends object>(item: T, patch: object): T {
  const given = Object.entries(patch).filter(([, value]) => value !== undefined);
  const merged = { ...item, ...Object.fromEntries(given) };
  return Object.fromEntries(Object.entries(merged).filter(([, value]) => value !== null)) as T;
}

// ---------- amenities ----------

/** How far (meters) a dropped amenity looks for a dot to attach to. */
const AMENITY_REACH = 10;

/** Drop an amenity: it attaches to the nearest dot on the floor (null if none is close). */
export function placeAmenity(
  doc: MapFile,
  levelId: string,
  p: Point,
  kind: Amenity['kind'],
): { doc: MapFile; id: string } | null {
  let best: MapNode | undefined;
  let bestDistance = AMENITY_REACH;
  for (const n of doc.nodes) {
    if (n.lvl !== levelId) continue;
    const d = distance(n, p);
    if (d < bestDistance) {
      best = n;
      bestDistance = d;
    }
  }
  if (!best) return null;
  const id = newId(
    'amenity-',
    doc.amenities.map((a) => a.id),
  );
  return { doc: { ...doc, amenities: [...doc.amenities, { id, kind, node: best.id }] }, id };
}

export type AmenityPatch = { readonly kind?: Amenity['kind']; readonly name?: string | null };

export function updateAmenity(doc: MapFile, id: string, patch: AmenityPatch): MapFile {
  return { ...doc, amenities: doc.amenities.map((a) => (a.id === id ? withPatch(a, patch) : a)) };
}

export function deleteAmenity(doc: MapFile, id: string): MapFile {
  return { ...doc, amenities: doc.amenities.filter((a) => a.id !== id) };
}

// ---------- QR stickers ----------

/** Codes are printed under the QR and typed by visitors: short, uppercase, unique. */
export const QR_CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,15}$/;

export function nextQrCode(doc: MapFile, levelId: string): string {
  const prefix =
    levelId
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 6) || 'Q';
  return newId(
    `${prefix}-`,
    doc.qr.map((q) => q.code),
  );
}

/** Round a facing to the nearest `step` degrees, in 0..359. */
export function snapAngle(degrees: number, step = 15): number {
  return (Math.round(degrees / step) * step + 360) % 360;
}

/** QR tool: a sticker on a dot (or that dot's existing sticker turned to `facing`). */
export function placeQr(
  doc: MapFile,
  nodeId: string,
  facing: number,
): { doc: MapFile; code: string } {
  const existing = doc.qr.find((q) => q.node === nodeId);
  if (existing) return { doc: updateQr(doc, existing.code, { facing }), code: existing.code };
  const node = doc.nodes.find((n) => n.id === nodeId);
  const code = nextQrCode(doc, node?.lvl ?? 'Q');
  return {
    doc: { ...doc, qr: [...doc.qr, { code, node: nodeId, facing: snapAngle(facing, 1) }] },
    code,
  };
}

export function updateQr(
  doc: MapFile,
  code: string,
  patch: { code?: string; facing?: number },
): MapFile {
  return {
    ...doc,
    qr: doc.qr.map((q) =>
      q.code === code
        ? {
            ...q,
            ...(patch.code !== undefined && { code: patch.code }),
            ...(patch.facing !== undefined && { facing: snapAngle(patch.facing, 1) }),
          }
        : q,
    ),
  };
}

export function deleteQr(doc: MapFile, code: string): MapFile {
  return { ...doc, qr: doc.qr.filter((q) => q.code !== code) };
}
