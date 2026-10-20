/**
 * Quick build: the four time-savers that turn hours of clicking into minutes.
 *
 * - `generateBuilding`: a corridor building (rooms both sides, lift and stairs, toilets,
 *   an entrance) on one or more floors, with its walking path, doors, rooms and checkpoints.
 * - `copyFloor`: the same plan on another floor (rooms renumbered G01 → 101, lifts and
 *   stairs extended to it).
 * - `importRoomList`: names, kinds and "popular" for many rooms at once from a pasted
 *   spreadsheet (CSV or tab-separated), matched by room number.
 * - `autoConnect`: joins every door that has no line to the nearest corridor, and names the
 *   corridor spots where visitors turn from the rooms beside them.
 *
 * All pure (document in, document out) so the editor can undo them in one step.
 */
import type { Amenity, Connector, Level, MapFile, MapNode, Room, Shape } from '@innermap/schema';
import { ROOM_CATEGORIES } from '@innermap/schema';
import type { Point } from './drawing';
import { addEdge, addNode, newId, nextQrCode, project, splitEdge } from './drawing';
import { nextLevel } from './project';

// ---------------------------------------------------------------- floor tags

/** "G" for the ground floor, "1", "2"… above, "B1" below: the start of room numbers. */
export function floorTag(level: Pick<Level, 'ord'>): string {
  if (level.ord === 0) return 'G';
  return level.ord < 0 ? `B${-level.ord}` : String(level.ord);
}

// ---------------------------------------------------------------- building wizard

export interface BuildingSpec {
  readonly name: string;
  /** Meters along the corridor. */
  readonly length: number;
  readonly roomsPerSide: number;
  /** Floors in all, the current one first. */
  readonly floors: number;
  readonly roomDepth: number;
  readonly corridorWidth: number;
  /** Lift and stairs at the start (west) end, the far end, or none (one floor). */
  readonly core: 'start' | 'end' | 'none';
  /** Where the way in is on the ground floor. */
  readonly entrance: 'start' | 'end';
}

export const DEFAULT_BUILDING: BuildingSpec = {
  name: 'Main block',
  length: 48,
  roomsPerSide: 6,
  floors: 3,
  roomDepth: 7,
  corridorWidth: 2.5,
  core: 'start',
  entrance: 'start',
};

const r2 = (v: number) => Math.round(v * 100) / 100;

/** A copy of `value` without `key` (as in plan.ts). */
function without<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  return Object.fromEntries(Object.entries(value).filter(([k]) => k !== key)) as Omit<T, K>;
}
const rect = (x: number, y: number, w: number, h: number): number[] =>
  [x, y, x + w, y, x + w, y + h, x, y + h].map(r2);

/** Where to draw something new on a floor: to the right of what is already there. */
function freeSpot(doc: MapFile, levelId: string): Point {
  const level = doc.levels.find((l) => l.id === levelId);
  const xs = [
    ...doc.nodes.filter((n) => n.lvl === levelId).map((n) => n.x),
    ...(level?.shapes ?? []).flatMap((s) => s.pts.filter((_, i) => i % 2 === 0)),
  ];
  return { x: xs.length ? Math.ceil(Math.max(...xs) + 10) : 0, y: 0 };
}

/**
 * A corridor building on the current floor and new floors above it: rooms on both sides
 * numbered per floor (G01…, 101…), toilets at the far end, lift and stairs at one end joining
 * every floor, the entrance with a QR sticker on the ground floor. Everything gets a name, so
 * the checks pass and Test route gives clean steps straight away.
 */
export function generateBuilding(
  doc: MapFile,
  levelId: string,
  spec: BuildingSpec,
): { doc: MapFile; levelIds: string[] } {
  const base = doc.levels.find((l) => l.id === levelId);
  if (!base) return { doc, levelIds: [] };
  let next = doc;

  // The floors: this one, then new ones on top.
  const levelIds = [levelId];
  for (let f = 1; f < spec.floors; f++) {
    const level = nextLevel(next, base.building);
    next = { ...next, levels: [...next.levels, level] };
    levelIds.push(level.id);
  }

  const origin = freeSpot(doc, levelId);
  const { length: L, roomDepth: rd, corridorWidth: cw } = spec;
  const depth = 2 * rd + cw;
  const cy = origin.y + rd + cw / 2; // corridor centre line
  const yA = origin.y + rd; // side A doors (north)
  const yB = origin.y + rd + cw; // side B doors (south)
  const hasCore = spec.core !== 'none' && spec.floors > 1;
  const CORE = 8;
  const TOILETS = 4;
  // Side A: the core (if any) at one end, then rooms. Side B: rooms, toilets at the far end.
  const coreAt = spec.core === 'end' ? L - CORE : 0;
  const aFrom = hasCore && spec.core === 'start' ? CORE : 0;
  const aTo = hasCore && spec.core === 'end' ? L - CORE : L;
  const toiletsAt = spec.core === 'end' ? 0 : L - TOILETS;
  const bFrom = spec.core === 'end' ? TOILETS : 0;
  const bTo = spec.core === 'end' ? L : L - TOILETS;
  const slots = (from: number, to: number, n: number) =>
    Array.from({ length: n }, (_, i) => ({
      u0: from + ((to - from) * i) / n,
      u1: from + ((to - from) * (i + 1)) / n,
    }));
  const sideA = slots(aFrom, aTo, spec.roomsPerSide);
  const sideB = slots(bFrom, bTo, spec.roomsPerSide);

  const lift: Connector = {
    id: newId(
      'lift-',
      next.connectors.map((c) => c.id),
    ),
    kind: 'lift',
    name: `${spec.name} lift`,
    stops: {},
  };
  const stairs: Connector = {
    id: newId(
      'stairs-',
      next.connectors.map((c) => c.id),
    ),
    kind: 'stairs',
    name: `${spec.name} stairs`,
    stops: {},
  };

  levelIds.forEach((lvl, f) => {
    const level = next.levels.find((l) => l.id === lvl);
    if (!level) return;
    const tag = floorTag(level);
    const floorName = level.name;
    const shapes: Shape[] = [{ kind: 'floor', pts: rect(origin.x, origin.y, L, depth) }];
    const node = (x: number, y: number, kind: MapNode['kind'], landmark?: string) => {
      const added = addNode(next, lvl, { x, y }, kind);
      next = landmark
        ? {
            ...added.doc,
            nodes: added.doc.nodes.map((n) => (n.id === added.id ? { ...n, landmark } : n)),
          }
        : added.doc;
      return added.id;
    };

    // Corridor dots: one where each door meets the corridor (shared when two face each other).
    const spots = new Map<number, { id: string; near: string[] }>();
    const spotAt = (u: number) => {
      const key = Math.round(u * 2) / 2;
      for (const [k, v] of spots) if (Math.abs(k - key) < 1.5) return v;
      const spot = { id: node(origin.x + u, cy, 'junction'), near: [] as string[] };
      spots.set(key, spot);
      return spot;
    };

    // Rooms.
    let n = 0;
    const addRoom = (slot: { u0: number; u1: number }, side: 'A' | 'B') => {
      n += 1;
      const number = `${tag}${String(n).padStart(2, '0')}`;
      const name = `Room ${number}`;
      const u = (slot.u0 + slot.u1) / 2;
      const door = node(origin.x + u, side === 'A' ? yA : yB, 'door', name);
      const roomId = newId(
        'room-',
        next.rooms.map((r) => r.id),
      );
      const room: Room = { id: roomId, name, number, category: 'classroom', doors: [door] };
      next = { ...next, rooms: [...next.rooms, room] };
      shapes.push({
        kind: 'room',
        room: roomId,
        pts:
          side === 'A'
            ? rect(origin.x + slot.u0, origin.y, slot.u1 - slot.u0, rd)
            : rect(origin.x + slot.u0, yB, slot.u1 - slot.u0, rd),
      });
      const spot = spotAt(u);
      spot.near.push(name);
      next = addEdge(next, spot.id, door);
    };
    for (const slot of sideA) addRoom(slot, 'A');
    for (const slot of sideB) addRoom(slot, 'B');

    // Toilets at the far end, side B.
    shapes.push({
      kind: 'room',
      label: 'Toilets',
      pts: rect(origin.x + toiletsAt, yB, TOILETS, rd),
    });
    const wc = spotAt(toiletsAt + TOILETS / 2);
    wc.near.push('the toilets');
    const amenity: Amenity = {
      id: newId(
        'am-',
        next.amenities.map((a) => a.id),
      ),
      kind: 'toilet',
      node: wc.id,
    };
    next = { ...next, amenities: [...next.amenities, amenity] };

    // Lift and stairs, with a stop on every floor.
    if (hasCore) {
      shapes.push(
        { kind: 'lift', pts: rect(origin.x + coreAt, origin.y + rd - 4, 3.5, 4), label: 'Lift' },
        { kind: 'stairs', pts: rect(origin.x + coreAt + 4, origin.y + rd - 5, 4, 5) },
      );
      const liftStop = node(origin.x + coreAt + 1.75, yA - 0.4, 'lift-stop', `${spec.name} lift`);
      const stairStop = node(origin.x + coreAt + 6, yA - 0.4, 'stairs-stop', `${spec.name} stairs`);
      const liftLobby = spotAt(coreAt + 1.75);
      liftLobby.near.push(`${spec.name} lift`);
      const stairLanding = spotAt(coreAt + 6);
      stairLanding.near.push(`${spec.name} stairs`);
      next = addEdge(addEdge(next, liftLobby.id, liftStop), stairLanding.id, stairStop);
      lift.stops[lvl] = liftStop;
      stairs.stops[lvl] = stairStop;
    }

    // The way in (ground floor of the new building), with a QR sticker.
    if (f === 0) {
      const atStart = spec.entrance === 'start';
      const inside = spotAt(atStart ? 0.5 : L - 0.5);
      inside.near.push(`${spec.name} entrance`);
      const door = node(origin.x + (atStart ? 0 : L), cy, 'entrance', `${spec.name} entrance`);
      next = addEdge(next, door, inside.id);
      next = {
        ...next,
        qr: [...next.qr, { code: nextQrCode(next, lvl), node: door, facing: atStart ? 90 : 270 }],
      };
    }

    // The corridor line, in order, and a name for every corridor dot.
    const ordered = [...spots.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
    for (let i = 1; i < ordered.length; i++) {
      const a = ordered[i - 1];
      const b = ordered[i];
      if (a && b) next = addEdge(next, a.id, b.id);
    }
    for (const spot of ordered) {
      const near = [...new Set(spot.near)];
      const landmark =
        near.length >= 2
          ? `Between ${near[0]} and ${near[1]}`
          : near.length === 1
            ? `Outside ${near[0]}`
            : `${spec.name} corridor, ${floorName}`;
      next = {
        ...next,
        nodes: next.nodes.map((m) => (m.id === spot.id ? { ...m, landmark } : m)),
      };
    }

    next = {
      ...next,
      levels: next.levels.map((l) =>
        l.id === lvl ? { ...l, shapes: [...(l.shapes ?? []), ...shapes] } : l,
      ),
    };
  });

  if (hasCore) next = { ...next, connectors: [...next.connectors, lift, stairs] };
  return { doc: next, levelIds };
}

// ---------------------------------------------------------------- copy a floor

/**
 * Copies one floor's plan (outlines, dots, lines, rooms, amenities) onto another, empty
 * floor: room numbers move to the new floor ("G01" → "101"), entrances become plain corridor
 * dots (the ways in are on the ground floor), and every lift or staircase on the first floor
 * gets a stop on the new one. QR stickers are not copied: each floor gets its own codes.
 */
export function copyFloor(doc: MapFile, fromId: string, toId: string): MapFile {
  const from = doc.levels.find((l) => l.id === fromId);
  const to = doc.levels.find((l) => l.id === toId);
  if (!from || !to || fromId === toId) return doc;
  const fromTag = floorTag(from);
  const toTag = floorTag(to);
  // "G01" → "101", "MB-G03" → "MB-103"; names and landmarks that mention a number follow.
  const renumber = (text: string) =>
    text.replace(new RegExp(`(^|[^A-Za-z0-9])${fromTag}(\\d{2,3})\\b`, 'g'), `$1${toTag}$2`);

  let next = doc;
  const ids = new Map<string, string>();
  for (const n of doc.nodes) {
    if (n.lvl !== fromId) continue;
    const added = addNode(next, toId, n, n.kind === 'entrance' ? 'junction' : n.kind);
    ids.set(n.id, added.id);
    next = added.doc;
    if (n.landmark) {
      const landmark = renumber(n.landmark);
      next = {
        ...next,
        nodes: next.nodes.map((m) => (m.id === added.id ? { ...m, landmark } : m)),
      };
    }
  }
  for (const e of doc.edges) {
    const a = ids.get(e.a);
    const b = ids.get(e.b);
    if (a && b) next = { ...next, edges: [...next.edges, { ...e, a, b }] };
  }
  const roomIds = new Map<string, string>();
  for (const room of doc.rooms) {
    const doors = room.doors.map((d) => ids.get(d)).filter((d): d is string => !!d);
    if (doors.length === 0 || doors.length !== room.doors.length) continue;
    const id = newId(
      'room-',
      next.rooms.map((r) => r.id),
    );
    roomIds.set(room.id, id);
    const rest = without(room, 'popular');
    next = {
      ...next,
      rooms: [
        ...next.rooms,
        {
          ...rest,
          id,
          doors,
          name: renumber(room.name),
          ...(room.number !== undefined && { number: renumber(room.number) }),
        },
      ],
    };
  }
  for (const a of doc.amenities) {
    const node = ids.get(a.node);
    if (node) {
      const id = newId(
        'am-',
        next.amenities.map((x) => x.id),
      );
      next = { ...next, amenities: [...next.amenities, { ...a, id, node }] };
    }
  }
  next = {
    ...next,
    connectors: next.connectors.map((c) => {
      const stop = c.stops[fromId];
      const copy = stop ? ids.get(stop) : undefined;
      return copy && !c.stops[toId] ? { ...c, stops: { ...c.stops, [toId]: copy } } : c;
    }),
    levels: next.levels.map((l) =>
      l.id === toId
        ? {
            ...l,
            shapes: [
              ...(l.shapes ?? []),
              ...(from.shapes ?? []).map((s) => {
                const room = s.room ? roomIds.get(s.room) : undefined;
                const plain = without(s, 'room');
                return room ? { ...plain, room } : plain;
              }),
            ],
          }
        : l,
    ),
  };
  return next;
}

// ---------------------------------------------------------------- room list from a spreadsheet

/** Splits CSV or tab-separated text into rows of cells ("quoted, values" allowed). */
export function parseTable(text: string): string[][] {
  const tab = text.includes('\t');
  const rows: string[][] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (tab) {
      rows.push(line.split('\t').map((c) => c.trim()));
      continue;
    }
    const cells: string[] = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && quoted && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = !quoted;
      else if (ch === ',' && !quoted) {
        cells.push(cell.trim());
        cell = '';
      } else cell += ch;
    }
    cells.push(cell.trim());
    rows.push(cells);
  }
  return rows;
}

/** Words people use in their room lists, mapped to the map's kinds of room. */
const KIND_WORDS: ReadonlyArray<readonly [RegExp, Room['category']]> = [
  [/emergen|casualty|trauma/, 'emergency'],
  [/opd|clinic|doctor|consult/, 'opd'],
  [/ward|bed/, 'ward'],
  [/x.?ray|scan|radiolog|mri|ct\b|diagnos|patholog/, 'diagnostics'],
  [/pharma|chemist|medicine/, 'pharmacy'],
  [/fee|account|cash|billing|bank/, 'billing'],
  [/canteen|cafe|mess|food|dining/, 'food'],
  [/libr|reading/, 'library'],
  [/hostel|dorm/, 'hostel'],
  [/sport|gym|court|pool/, 'sports'],
  [/lab/, 'lab'],
  [/class|lecture|seminar|tutorial/, 'classroom'],
  [/admin|admission|exam|registrar|reception|enquir/, 'admin'],
  [/office|hod|dean|principal|director|faculty|cabin/, 'office'],
  [/store|electric|server|pump|utility/, 'utility'],
  [/staff/, 'staff'],
];

export function kindFromText(text: string): Room['category'] | undefined {
  const t = text.trim().toLowerCase();
  if ((ROOM_CATEGORIES as readonly string[]).includes(t)) return t as Room['category'];
  return KIND_WORDS.find(([re]) => re.test(t))?.[1];
}

const YES = /^(y|yes|true|1|✓|x|popular)$/i;

/**
 * Names, kinds and "popular" for rooms from a pasted spreadsheet. A header row is optional
 * (number / name / type or category / popular, in any order); without one the columns are
 * number, name, type. Rooms are matched by number (any floor), else by their current name.
 */
export function importRoomList(
  doc: MapFile,
  text: string,
): { doc: MapFile; updated: number; notFound: string[] } {
  const rows = parseTable(text);
  const head = (rows[0] ?? []).map((c) => c.toLowerCase());
  const hasHeader = head.some((c) =>
    /^(no\.?|number|room|name|type|kind|category|popular)/.test(c),
  );
  const col = (re: RegExp, fallback: number) => {
    const i = hasHeader ? head.findIndex((c) => re.test(c)) : -1;
    return i >= 0 ? i : hasHeader ? -1 : fallback;
  };
  const cNumber = col(/^(no\.?|number|room no|room number|room)$/, 0);
  const cName = col(/name/, 1);
  const cKind = col(/^(type|kind|category)/, 2);
  const cPopular = col(/popular/, 3);
  let next = doc;
  let updated = 0;
  const notFound: string[] = [];
  for (const row of hasHeader ? rows.slice(1) : rows) {
    const number = cNumber >= 0 ? (row[cNumber] ?? '').trim() : '';
    const name = cName >= 0 ? (row[cName] ?? '').trim() : '';
    if (!number && !name) continue;
    const key = (s: string) => s.replace(/[\s-]/g, '').toLowerCase();
    const room =
      (number && next.rooms.find((r) => r.number && key(r.number) === key(number))) ||
      (name && next.rooms.find((r) => r.name.toLowerCase() === name.toLowerCase()));
    if (!room) {
      notFound.push(number || name);
      continue;
    }
    const kind = cKind >= 0 ? kindFromText(row[cKind] ?? '') : undefined;
    const popular = cPopular >= 0 ? YES.test((row[cPopular] ?? '').trim()) : undefined;
    const rest = without(room, 'popular');
    const changed: Room = {
      ...rest,
      ...(name && { name }),
      ...(kind && { category: kind }),
      ...((popular ?? room.popular) && { popular: true as const }),
    };
    next = { ...next, rooms: next.rooms.map((r) => (r.id === room.id ? changed : r)) };
    // A door named after the room follows its new name.
    if (name) {
      next = {
        ...next,
        nodes: next.nodes.map((n) =>
          room.doors.includes(n.id) && (!n.landmark || n.landmark === room.name)
            ? { ...n, landmark: name }
            : n,
        ),
      };
    }
    updated += 1;
  }
  return { doc: next, updated, notFound };
}

// ---------------------------------------------------------------- auto-connect

/** How far (meters) a lone door looks for a corridor. */
const REACH = 20;

/**
 * On `levelId`: every door, lift or stairs stop without a line is joined to the nearest
 * corridor line (split there) or dot; then every corridor dot where visitors turn and that
 * has no name is named from the rooms beside it ("Outside Exam section", "Between A and B").
 */
export function autoConnect(
  doc: MapFile,
  levelId: string,
): { doc: MapFile; connected: number; named: number } {
  let next = doc;
  let connected = 0;
  const degree = (d: MapFile, id: string) => d.edges.filter((e) => e.a === id || e.b === id).length;
  const lone = doc.nodes.filter(
    (n) =>
      n.lvl === levelId &&
      (n.kind === 'door' || n.kind === 'lift-stop' || n.kind === 'stairs-stop') &&
      degree(doc, n.id) === 0,
  );
  for (const door of lone) {
    const nodes = new Map(next.nodes.map((n) => [n.id, n]));
    let best: { d: number; point: Point; a?: string; b?: string; node?: string } | null = null;
    for (const e of next.edges) {
      const a = nodes.get(e.a);
      const b = nodes.get(e.b);
      if (!a || !b || a.lvl !== levelId || a.kind === 'door' || b.kind === 'door') continue;
      const { point, t } = project(door, a, b);
      const d = Math.hypot(point.x - door.x, point.y - door.y);
      if (d < (best?.d ?? REACH)) {
        const end = t < 0.5 ? a : b;
        best =
          Math.hypot(point.x - end.x, point.y - end.y) <= 1
            ? { d, point: end, node: end.id }
            : { d, point, a: e.a, b: e.b };
      }
    }
    if (!best) {
      for (const n of next.nodes) {
        if (n.lvl !== levelId || n.id === door.id || n.kind === 'door') continue;
        const d = Math.hypot(n.x - door.x, n.y - door.y);
        if (d < (best?.d ?? REACH)) best = { d, point: n, node: n.id };
      }
    }
    if (!best) continue;
    let anchor = best.node;
    if (!anchor && best.a && best.b) {
      const split = splitEdge(next, best.a, best.b, best.point);
      next = split.doc;
      anchor = split.id;
    }
    if (anchor) {
      next = addEdge(next, anchor, door.id);
      connected += 1;
    }
  }

  // Names for the corridor dots where visitors turn.
  let named = 0;
  const nodes = new Map(next.nodes.map((n) => [n.id, n]));
  const roomName = new Map<string, string>();
  for (const room of next.rooms) for (const d of room.doors) roomName.set(d, room.name);
  next = {
    ...next,
    nodes: next.nodes.map((n) => {
      if (n.lvl !== levelId || n.landmark || (n.kind !== 'junction' && n.kind !== 'corner'))
        return n;
      const links = next.edges
        .filter((e) => e.a === n.id || e.b === n.id)
        .map((e) => nodes.get(e.a === n.id ? e.b : e.a))
        .filter((m): m is MapNode => !!m);
      if (links.length < 3) return n;
      const near = [
        ...new Set(
          links
            .map(
              (m) =>
                roomName.get(m.id) ??
                (m.kind !== 'junction' && m.kind !== 'corner' ? m.landmark : undefined),
            )
            .filter((t): t is string => !!t),
        ),
      ];
      if (near.length === 0) return n;
      named += 1;
      const landmark =
        near.length >= 2 ? `Between ${near[0]} and ${near[1]}` : `Outside ${near[0]}`;
      return { ...n, landmark };
    }),
  };
  return { doc: next, connected, named };
}
