/**
 * Generates samples/demo-mesra/map.json — a big demo campus loosely inspired by a large Indian
 * engineering college (BIT Mesra-style): main building, departments, lecture halls, library,
 * hostels, mess and canteens, medical centre, sports, swimming pool, quarters, roads, lawns,
 * a lake and trees. It is a fictional layout for testing, not a real map of any campus.
 *
 *   node samples/demo-mesra/generate.mjs
 *
 * Coordinates are meters (x → east, y → south). One shared Ground level holds the outdoors
 * and every ground floor; upper floors belong to their building (docs/PHASES.md Phase 10).
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('./map.json', import.meta.url));
const FLOOR_COLORS = ['teal', 'amber', 'violet', 'blue', 'rose'];
const MAX_EDGE = 25; // split longer lines (the editor warns past 30 m)

const nodes = [];
const edges = [];
const rooms = [];
const amenities = [];
const qr = [];
const connectors = [];
const buildings = [];
const levels = [{ id: 'G', name: 'Ground', ord: 0, color: 'teal', shapes: [] }];
const ground = levels[0];
const edgeKeys = new Set();
let auto = 0;

const r1 = (v) => Math.round(v * 2) / 2;
const node = (id, lvl, x, y, kind, landmark) => {
  const n = { id, lvl, x: r1(x), y: r1(y), kind, ...(landmark && { landmark }) };
  nodes.push(n);
  return n;
};
/** A line between two dots; longer ones get plain dots in between (straight, so no turns). */
function edge(a, b, kind) {
  const key = [a.id, b.id].sort().join('|');
  if (a.id === b.id || edgeKeys.has(key)) return;
  edgeKeys.add(key);
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const parts = Math.ceil(length / MAX_EDGE);
  let prev = a;
  for (let i = 1; i < parts; i++) {
    const t = i / parts;
    const mid = node(`p${++auto}`, a.lvl, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, 'corner');
    edges.push({ a: prev.id, b: mid.id, ...(kind && { kind }) });
    prev = mid;
  }
  edges.push({ a: prev.id, b: b.id, ...(kind && { kind }) });
}
const rect = (x, y, w, h) => [x, y, x + w, y, x + w, y + h, x, y + h].map(r1);
const shape = (level, kind, pts, extra = {}) => level.shapes.push({ kind, pts, ...extra });

// ---------------------------------------------------------------- roads
const H = [
  { id: 'A', y: 560, x0: 60, x1: 840, w: 10, name: 'Gate Road' },
  { id: 'B', y: 380, x0: 60, x1: 840, w: 10, name: 'Academic Avenue' },
  { id: 'C', y: 200, x0: 60, x1: 840, w: 10, name: 'Hostel Road' },
  { id: 'D', y: 175, x0: 750, x1: 890, w: 8, name: 'Girls Hostel Lane' },
];
const V = [
  { id: 'M', x: 450, y0: 120, y1: 695, w: 14, name: 'Main Avenue' },
  { id: 'W', x: 150, y0: 60, y1: 660, w: 10, name: 'West Road' },
  { id: 'E', x: 750, y0: 40, y1: 640, w: 10, name: 'East Road' },
];
const CROSSING_NAMES = {
  'A:M': 'Gate Circle (fountain)',
  'B:M': 'Library Chowk (clock tower)',
  'C:M': 'Hostel Chowk (tea stall)',
  'A:W': 'West Junction (bus stop)',
  'B:W': 'Sports Junction (scoreboard)',
  'C:W': 'Pool Corner',
  'A:E': 'Quarters Junction (letter box)',
  'B:E': 'Auditorium Junction (notice board)',
  'C:E': 'Dispensary Junction (red cross sign)',
  'D:E': 'Girls Hostel Gate',
};
for (const r of H)
  shape(ground, 'road', rect(r.x0, r.y - r.w / 2, r.x1 - r.x0, r.w), { label: r.name });
for (const r of V)
  shape(ground, 'road', rect(r.x - r.w / 2, r.y0, r.w, r.y1 - r.y0), { label: r.name });

/** Stops along each road: crossings, ends, and where building paths join. */
const stops = new Map([...H, ...V].map((r) => [r.id, []]));
const pointIds = new Map();
function roadPoint(x, y, landmark, kind = 'junction') {
  const key = `${r1(x)},${r1(y)}`;
  let n = pointIds.get(key);
  if (!n) {
    n = node(`r${pointIds.size + 1}`, 'G', x, y, kind, landmark);
    pointIds.set(key, n);
  } else if (landmark && !n.landmark) n.landmark = landmark;
  return n;
}
for (const h of H) {
  for (const v of V) {
    if (v.x < h.x0 || v.x > h.x1 || h.y < v.y0 || h.y > v.y1) continue;
    const n = roadPoint(v.x, h.y, CROSSING_NAMES[`${h.id}:${v.id}`]);
    stops.get(h.id).push(n);
    stops.get(v.id).push(n);
  }
}
const mainGate = roadPoint(450, 695, 'Main Gate (security cabin)', 'entrance');
stops.get('M').push(mainGate);
const backGate = roadPoint(750, 40, 'Back Gate', 'entrance');
stops.get('E').push(backGate);
stops.get('M').push(roadPoint(450, 120, 'Flag post, north end of Main Avenue'));
for (const h of H) {
  if (h.id === 'D') continue;
  stops.get(h.id).push(roadPoint(h.x0, h.y, `West end of ${h.name}`));
  stops.get(h.id).push(roadPoint(h.x1, h.y, `East end of ${h.name}`));
}
stops.get('D').push(roadPoint(890, 175, 'End of Girls Hostel Lane'));
stops.get('W').push(roadPoint(150, 60, 'North end of West Road'));
stops.get('W').push(roadPoint(150, 660, 'South end of West Road'));
stops.get('E').push(roadPoint(750, 640, 'South end of East Road'));
qr.push({ code: 'MAIN-GATE', node: mainGate.id, facing: 0 });
qr.push({ code: 'BACK-GATE', node: backGate.id, facing: 180 });

/** Where a building's path meets its road (perpendicular), as a named stop. */
function joinRoad(roadId, entrance, buildingName) {
  const h = H.find((r) => r.id === roadId);
  const v = V.find((r) => r.id === roadId);
  const at = h ? roadPoint(entrance.x, h.y) : roadPoint(v.x, entrance.y);
  if (!at.landmark) at.landmark = `Path to ${buildingName}`;
  stops.get(roadId).push(at);
  edge(at, entrance, 'outdoor');
}

// ---------------------------------------------------------------- buildings
const ROOM_W = 13; // a room is ~13 m along the corridor
const CORE = 14; // lift + stairs at the start of side A

/**
 * A corridor building: corridor along the long side, rooms on both sides, lift + stairs at
 * one end, toilets at the other. `entrance`: 'N' | 'S' | 'E' | 'W' — the side facing its road.
 * `rooms(floor, slots)` names the rooms of each floor.
 */
function corridorBuilding(b) {
  const { id, name, code, x, y, w, h, floors, entrance, road, rooms: roomsFor, sideDoors } = b;
  const horizontal = w >= h;
  const L = horizontal ? w : h;
  const Wd = horizontal ? h : w;
  const world = (u, v) => (horizontal ? { x: x + u, y: y + v } : { x: x + v, y: y + u });
  const box = (u0, v0, u1, v1) => {
    const a = world(u0, v0);
    const c = world(u1, v1);
    return rect(Math.min(a.x, c.x), Math.min(a.y, c.y), Math.abs(c.x - a.x), Math.abs(c.y - a.y));
  };
  // Which local side the entrance is on.
  const side = horizontal
    ? { W: 'start', E: 'end', N: 'A', S: 'B' }[entrance]
    : { N: 'start', S: 'end', W: 'A', E: 'B' }[entrance];
  const cv0 = Wd / 2 - 2;
  const cv1 = Wd / 2 + 2;

  buildings.push({ id, name });
  shape(ground, 'building', rect(x, y, w, h), { building: id });

  // Room slots along both sides.
  // One-floor buildings need no lift or stairs: their rooms start right at the end wall.
  const core = floors > 1 ? CORE : 0;
  // Long buildings get a second staircase at the far end; very long ones a second lift too.
  const coreEnd = floors > 1 && L >= 100 ? CORE : 0;
  const secondLift = floors > 1 && L >= 200;
  const span = L - core - coreEnd;
  const slotsA = [];
  const nA = Math.max(1, Math.floor(span / ROOM_W));
  for (let i = 0; i < nA; i++) {
    const u0 = core + (span * i) / nA;
    slotsA.push({ side: 'A', u0, u1: core + (span * (i + 1)) / nA });
  }
  const slotsB = [];
  const nB = Math.max(2, Math.floor(L / ROOM_W));
  for (let i = 0; i < nB; i++) slotsB.push({ side: 'B', u0: (L * i) / nB, u1: (L * (i + 1)) / nB });
  const mid = L / 2;
  const lobbySlot =
    side === 'A' || side === 'B'
      ? (side === 'A' ? slotsA : slotsB).find((s) => s.u0 <= mid && mid < s.u1)
      : undefined;
  const toiletSlot = slotsB[slotsB.length - 1];

  const lift = { id: `${id}-lift`, kind: 'lift', name: `${name} lift`, stops: {} };
  const stairs = { id: `${id}-stairs`, kind: 'stairs', name: `${name} stairs`, stops: {} };
  const stairsB = { id: `${id}-stairs-b`, kind: 'stairs', name: `${name} east stairs`, stops: {} };
  const liftB = { id: `${id}-lift-b`, kind: 'lift', name: `${name} lift B`, stops: {} };

  // `floors` counts the ground floor: f = 0 is on the shared Ground level, the rest are
  // the building's own levels.
  const floorCount = floors;
  for (let f = 0; f < floorCount; f++) {
    const lvlId = f === 0 ? 'G' : `${id}${f}`;
    let level = ground;
    if (f > 0) {
      level = {
        id: lvlId,
        name: `Floor ${f}`,
        ord: f,
        color: FLOOR_COLORS[f % FLOOR_COLORS.length],
        building: id,
        shapes: [],
      };
      levels.push(level);
      shape(level, 'floor', rect(x, y, w, h));
    } else {
      shape(level, 'floor', box(0, cv0, L, cv1));
      if (lobbySlot) {
        shape(
          level,
          'floor',
          side === 'A'
            ? box(lobbySlot.u0, 0, lobbySlot.u1, cv0)
            : box(lobbySlot.u0, cv1, lobbySlot.u1, Wd),
        );
      }
    }
    const floorName = f === 0 ? 'Ground' : `Floor ${f}`;
    const tag = f === 0 ? 'G' : String(f);

    // Lift and stairs boxes, then rooms.
    if (core > 0) {
      shape(level, 'lift', box(1, cv0 - 6, 6, cv0), { label: 'Lift' });
      shape(level, 'stairs', box(7, cv0 - 8, 13, cv0));
    }
    if (coreEnd > 0) {
      shape(level, 'stairs', box(L - 13, cv0 - 8, L - 7, cv0));
      if (secondLift) shape(level, 'lift', box(L - 6, cv0 - 6, L - 1, cv0), { label: 'Lift B' });
    }
    const usable = [...slotsA, ...slotsB].filter(
      (s) => !(f === 0 && s === lobbySlot) && s !== toiletSlot,
    );
    const names = roomsFor(f, usable.length);
    const doors = []; // { u, side, node-ish }
    usable.forEach((slot, i) => {
      const spec = names[i];
      if (!spec) return;
      const roomId = `${id}-${tag}-${i + 1}`.toLowerCase();
      const number = `${code}-${tag}${String(i + 1).padStart(2, '0')}`;
      const pts =
        slot.side === 'A' ? box(slot.u0, 0, slot.u1, cv0) : box(slot.u0, cv1, slot.u1, Wd);
      shape(level, 'room', pts, { room: roomId });
      const u = (slot.u0 + slot.u1) / 2;
      const p = world(u, slot.side === 'A' ? cv0 : cv1);
      const door = node(`${roomId}-d`, lvlId, p.x, p.y, 'door', spec.name);
      doors.push({ u, door, name: spec.name });
      rooms.push({
        id: roomId,
        name: spec.name,
        number,
        category: spec.category,
        doors: [door.id],
        ...(spec.locked && { visibility: 'locked' }),
      });
    });
    shape(level, 'room', box(toiletSlot.u0, cv1, toiletSlot.u1, Wd), { label: 'Toilets' });

    // Corridor dots: one per door position, the lift and stairs, the toilets.
    const positions = new Map();
    const at = (u) => {
      const key = Math.round(u * 2) / 2;
      for (const [k, v] of positions) if (Math.abs(k - key) < 1.5) return v;
      const p = world(u, Wd / 2);
      const n = node(
        `${id}-${tag}-c${positions.size + 1}`.toLowerCase(),
        lvlId,
        p.x,
        p.y,
        'junction',
      );
      n.near = [];
      positions.set(key, n);
      return n;
    };
    let liftLobby = null;
    if (core > 0) {
      const liftDoor = world(3.5, cv0);
      const stairsDoor = world(10, cv0);
      const liftStop = node(
        `${id}-${tag}-lift`.toLowerCase(),
        lvlId,
        liftDoor.x,
        liftDoor.y,
        'lift-stop',
        `${name} lift`,
      );
      const stairStop = node(
        `${id}-${tag}-stairs`.toLowerCase(),
        lvlId,
        stairsDoor.x,
        stairsDoor.y,
        'stairs-stop',
        `${name} stairs`,
      );
      liftLobby = at(3.5);
      liftLobby.landmark = `${name} lift lobby, ${floorName}`;
      const stairLanding = at(10);
      stairLanding.landmark = `${name} stairs, ${floorName}`;
      edge(liftStop, liftLobby);
      edge(stairStop, stairLanding);
      lift.stops[lvlId] = liftStop.id;
      stairs.stops[lvlId] = stairStop.id;
    }
    if (coreEnd > 0) {
      const sp = world(L - 10, cv0);
      const stop = node(
        `${id}-${tag}-stairs-b`.toLowerCase(),
        lvlId,
        sp.x,
        sp.y,
        'stairs-stop',
        `${name} east stairs`,
      );
      const landing = at(L - 10);
      landing.landmark = `${name} east stairs, ${floorName}`;
      edge(stop, landing);
      stairsB.stops[lvlId] = stop.id;
      if (secondLift) {
        const lp = world(L - 3.5, cv0);
        const liftStopB = node(
          `${id}-${tag}-lift-b`.toLowerCase(),
          lvlId,
          lp.x,
          lp.y,
          'lift-stop',
          `${name} lift B`,
        );
        const lobbyB = at(L - 3.5);
        lobbyB.landmark = `${name} lift B lobby, ${floorName}`;
        edge(liftStopB, lobbyB);
        liftB.stops[lvlId] = liftStopB.id;
      }
    }
    for (const d of doors) {
      const c = at(d.u);
      c.near.push(d.name);
      edge(c, d.door);
    }
    const toilets = at((toiletSlot.u0 + toiletSlot.u1) / 2);
    toilets.near.push('the toilets');
    amenities.push({ id: `${id}-${tag}-wc`.toLowerCase(), kind: 'toilet', node: toilets.id });
    if (f === 0)
      amenities.push({ id: `${id}-water`, kind: 'water', node: (liftLobby ?? toilets).id });

    // Ground floor: the entrance, its lobby, and the path to the road.

    if (f === 0) {
      const ep =
        side === 'start'
          ? world(0, Wd / 2)
          : side === 'end'
            ? world(L, Wd / 2)
            : side === 'A'
              ? world(mid, 0)
              : world(mid, Wd);
      const entranceNode = node(`${id}-ent`, 'G', ep.x, ep.y, 'entrance', `${name} entrance`);
      const inside = side === 'start' ? at(0.5) : side === 'end' ? at(L - 0.5) : at(mid);
      if (!inside.landmark) inside.landmark = `${name} lobby`;
      edge(entranceNode, inside);
      const facing = { N: 180, S: 0, E: 270, W: 90 }[entrance];
      qr.push({ code: `${code}-ENT`, node: entranceNode.id, facing });
      joinRoad(road, entranceNode, name);

      // Side doors at both ends (west and east) for big buildings: a short path out, then
      // along the end wall to the same road. Routes pick whichever door is nearer.
      if (sideDoors && horizontal && (side === 'A' || side === 'B')) {
        for (const [u, out, label] of [
          [0, -3, 'west'],
          [L, L + 3, 'east'],
        ]) {
          const dp = world(u, Wd / 2);
          const door = node(`${id}-${label}`, 'G', dp.x, dp.y, 'entrance', `${name} ${label} door`);
          const inner = at(u === 0 ? 0.5 : L - 0.5);
          if (!inner.landmark) inner.landmark = `${name} ${label} end`;
          edge(door, inner);
          const op = world(out, Wd / 2);
          const outside = node(
            `${id}-${label}-out`,
            'G',
            op.x,
            op.y,
            'junction',
            `Outside ${name} ${label} door`,
          );
          edge(door, outside, 'outdoor');
          joinRoad(road, outside, `${name} ${label} door`);
          qr.push({
            code: `${code}-${label === 'west' ? 'W' : 'E'}`,
            node: door.id,
            facing: label === 'west' ? 90 : 270,
          });
        }
      }
    }
    if (f > 0 && liftLobby)
      qr.push({ code: `${code}-${f}`, node: liftLobby.id, facing: horizontal ? 90 : 180 });

    // Corridor lines, in order, and names for every corridor dot.
    const ordered = [...positions.entries()].sort((a, c) => a[0] - c[0]).map(([, n]) => n);
    for (let i = 1; i < ordered.length; i++) edge(ordered[i - 1], ordered[i]);
    for (const c of ordered) {
      if (!c.landmark) {
        const near = [...new Set(c.near)];
        c.landmark =
          near.length >= 2
            ? `Between ${near[0]} and ${near[1]}`
            : near.length === 1
              ? `Outside ${near[0]}`
              : `${name} corridor, ${floorName}`;
      }
      delete c.near;
    }
  }
  if (floorCount > 1) connectors.push(lift, stairs);
  if (floorCount > 1 && coreEnd > 0) connectors.push(stairsB);
  if (floorCount > 1 && secondLift) connectors.push(liftB);
}

/** A one-room building (temple, kiosk, substation): the room's door is the entrance. */
function singleRoom(b) {
  const { id, name, code, x, y, w, h, entrance, road, category, locked } = b;
  buildings.push({ id, name });
  shape(ground, 'building', rect(x, y, w, h), { building: id });
  const roomId = `${id}-room`;
  shape(ground, 'room', rect(x + 1, y + 1, w - 2, h - 2), { room: roomId });
  const p = {
    N: { x: x + w / 2, y },
    S: { x: x + w / 2, y: y + h },
    E: { x: x + w, y: y + h / 2 },
    W: { x, y: y + h / 2 },
  }[entrance];
  const door = node(`${id}-ent`, 'G', p.x, p.y, 'entrance', `${name} entrance`);
  rooms.push({
    id: roomId,
    name,
    number: code,
    category,
    doors: [door.id],
    ...(locked && { visibility: 'locked' }),
  });
  qr.push({
    code: `${code}-ENT`,
    node: door.id,
    facing: { N: 180, S: 0, E: 270, W: 90 }[entrance],
  });
  joinRoad(road, door, name);
}

// Room name lists ------------------------------------------------------------------------
const cycle = (list) => (floor, count) =>
  Array.from({ length: count }, (_, i) => list(floor, i)).filter(Boolean);
const dept = (short, labs) =>
  cycle((f, i) => {
    if (f === 0 && i === 0) return { name: `${short} Department office`, category: 'admin' };
    if (f === 1 && i === 0) return { name: `${short} HOD office`, category: 'office' };
    if (f === 0 && i === 1) return { name: `${short} Seminar hall`, category: 'classroom' };
    if (i % 3 === 2) return { name: `${short} Faculty rooms ${f}${i}`, category: 'office' };
    const lab = labs[(f * 3 + i) % labs.length];
    return i % 2 === 0
      ? { name: `${lab} Lab`, category: 'lab' }
      : { name: `${short} Classroom ${f}${String(i).padStart(2, '0')}`, category: 'classroom' };
  });
const hostel = (label) =>
  cycle((f, i) => {
    if (f === 0 && i === 0) return { name: `${label} Warden office`, category: 'office' };
    if (f === 0 && i === 1) return { name: `${label} Common room`, category: 'hostel' };
    if (f === 0 && i === 2) return { name: `${label} Reading room`, category: 'library' };
    const first = f * 100 + i * 4 + 1;
    return { name: `${label} Rooms ${first}–${first + 3}`, category: 'hostel' };
  });
const list = (perFloor) => cycle((f, i) => perFloor[f]?.[i] ?? null);
const r = (name, category, locked) => ({ name, category, ...(locked && { locked: true }) });

// The campus -----------------------------------------------------------------------------
const DEPARTMENTS = [
  {
    id: 'cse',
    name: 'CSE Department',
    code: 'CSE',
    x: 175,
    y: 215,
    labs: ['Computer', 'Networks', 'AI & ML', 'Software', 'Database'],
  },
  {
    id: 'ece',
    name: 'ECE Department',
    code: 'ECE',
    x: 315,
    y: 215,
    labs: ['Electronics', 'VLSI', 'Communication', 'Embedded Systems', 'Signal Processing'],
  },
  {
    id: 'me',
    name: 'Mechanical Department',
    code: 'ME',
    x: 470,
    y: 215,
    floors: 2,
    labs: ['Workshop', 'Thermal', 'CAD', 'Robotics', 'Fluid Mechanics'],
  },
  {
    id: 'ce',
    name: 'Civil Department',
    code: 'CE',
    x: 610,
    y: 215,
    floors: 2,
    labs: ['Surveying', 'Concrete', 'Soil Mechanics', 'Hydraulics', 'Transport'],
  },
];
for (const d of DEPARTMENTS) {
  corridorBuilding({
    ...d,
    sideDoors: true,
    w: 120,
    h: 50,
    floors: d.floors ?? 3,
    entrance: 'N',
    road: 'C',
    rooms: dept(d.code, d.labs),
  });
}
corridorBuilding({
  id: 'mb',
  sideDoors: true,
  name: 'Main Building',
  code: 'MB',
  x: 190,
  y: 400,
  w: 220,
  h: 80,
  floors: 3,
  entrance: 'N',
  road: 'B',
  rooms: list([
    [
      r('Admission office', 'admin'),
      r('Accounts section', 'billing'),
      r('Registrar office', 'admin'),
      r('Exam section', 'admin'),
      r('Fee counter', 'billing'),
      r('Scholarship cell', 'admin'),
      r('Student welfare', 'admin'),
      r('Records room', 'staff', true),
      r('Help desk', 'admin'),
      r('Visitors lounge', 'other'),
      r('Dispatch section', 'office'),
      r('Photocopy room', 'other'),
      r('Stores', 'staff', true),
      r('Security room', 'staff', true),
      r('Bank extension counter', 'billing'),
      r('Lost and found', 'other'),
      r('Training room', 'classroom'),
    ],
    [
      r("Director's office", 'office', true),
      r('Dean Academics', 'office'),
      r('Dean Students', 'office'),
      r('Board room', 'office'),
      r('Conference room', 'office'),
      r('Placement cell', 'admin'),
      r('Alumni office', 'admin'),
      r('International relations', 'admin'),
      r('IQAC office', 'office'),
      r('Research cell', 'office'),
      r('Legal cell', 'office'),
      r('Committee room', 'office'),
      r('PA office', 'office'),
      r('Waiting lounge', 'other'),
      r('Printing room', 'other'),
      r('Archive', 'staff', true),
      r('Pantry', 'food'),
    ],
    [
      r('Senate hall', 'classroom'),
      r('Language lab', 'lab'),
      r('Training & placement hall', 'classroom'),
      r('Interview room 1', 'office'),
      r('Interview room 2', 'office'),
      r('Interview room 3', 'office'),
      r('Mathematics department', 'office'),
      r('Physics department', 'office'),
      r('Chemistry department', 'office'),
      r('Physics lab', 'lab'),
      r('Chemistry lab', 'lab'),
      r('Humanities department', 'office'),
      r('Management department', 'office'),
      r('MBA classroom 1', 'classroom'),
      r('MBA classroom 2', 'classroom'),
      r('Case study room', 'classroom'),
      r('Store room', 'staff', true),
    ],
  ]),
});
corridorBuilding({
  id: 'lhc',
  sideDoors: true,
  name: 'Lecture Hall Complex',
  code: 'LH',
  x: 175,
  y: 300,
  w: 260,
  h: 55,
  floors: 2,
  entrance: 'S',
  road: 'B',
  rooms: cycle((f, i) =>
    i === 0 && f === 0
      ? r('LHC office', 'admin')
      : r(`Lecture Hall ${f + 1}${String(i).padStart(2, '0')}`, 'classroom'),
  ),
});
corridorBuilding({
  id: 'lib',
  sideDoors: true,
  name: 'Central Library',
  code: 'LIB',
  x: 480,
  y: 400,
  w: 130,
  h: 60,
  floors: 2,
  entrance: 'N',
  road: 'B',
  rooms: list([
    [
      r('Issue & return counter', 'library'),
      r('Reading hall', 'library'),
      r('Periodicals section', 'library'),
      r('Reference section', 'library'),
      r('Bag counter', 'other'),
      r('Librarian office', 'office'),
      r('Book bank', 'library'),
      r('Newspaper corner', 'library'),
      r('Photocopy corner', 'other'),
      r('Binding section', 'staff', true),
      r('Rare books', 'library', true),
      r('Thesis section', 'library'),
      r('Help desk', 'library'),
      r('Stack room A', 'library'),
      r('Stack room B', 'library'),
      r('Store', 'staff', true),
    ],
    [
      r('Digital library', 'library'),
      r('E-journals room', 'library'),
      r('Group study room 1', 'library'),
      r('Group study room 2', 'library'),
      r('Silent reading hall', 'library'),
      r('Multimedia room', 'library'),
      r('Stack room C', 'library'),
      r('Stack room D', 'library'),
      r('Research scholars room', 'library'),
      r('Server room', 'utility', true),
      r('Discussion pods', 'library'),
      r('Exhibition corner', 'other'),
      r('Faculty reading room', 'library'),
      r('Archive', 'staff', true),
      r('Store', 'staff', true),
      r('Pantry', 'food'),
    ],
  ]),
});
corridorBuilding({
  id: 'aud',
  name: 'Auditorium',
  code: 'AUD',
  x: 640,
  y: 400,
  w: 90,
  h: 70,
  floors: 1,
  entrance: 'N',
  road: 'B',
  rooms: list([
    [
      r('Main hall', 'other'),
      r('Green room', 'staff', true),
      r('Control room', 'utility', true),
      r('Ticket counter', 'billing'),
      r('Foyer exhibition', 'other'),
      r('VIP lounge', 'office'),
      r('Sound store', 'staff', true),
      r('Rehearsal room', 'other'),
      r('Costume room', 'staff', true),
    ],
  ]),
});
corridorBuilding({
  id: 'mess',
  sideDoors: true,
  name: 'Central Mess',
  code: 'MESS',
  x: 470,
  y: 300,
  w: 110,
  h: 55,
  floors: 1,
  entrance: 'S',
  road: 'B',
  rooms: list([
    [
      r('Dining hall A', 'food'),
      r('Dining hall B', 'food'),
      r('Serving counter', 'food'),
      r('Kitchen', 'staff', true),
      r('Mess office', 'office'),
      r('Wash area', 'other'),
      r('Store room', 'staff', true),
      r('Bakery corner', 'food'),
      r('Cold storage', 'staff', true),
      r('Mess committee room', 'office'),
    ],
  ]),
});
corridorBuilding({
  id: 'fc',
  name: 'Food Court',
  code: 'FC',
  x: 600,
  y: 305,
  w: 80,
  h: 50,
  floors: 1,
  entrance: 'S',
  road: 'B',
  rooms: list([
    [
      r('South Indian counter', 'food'),
      r('Chinese counter', 'food'),
      r('Juice bar', 'food'),
      r('Coffee house', 'food'),
      r('Ice-cream parlour', 'food'),
      r('Seating hall', 'food'),
      r('Billing counter', 'billing'),
    ],
  ]),
});
corridorBuilding({
  id: 'nc',
  name: 'Night Canteen',
  code: 'NC',
  x: 650,
  y: 115,
  w: 60,
  h: 60,
  floors: 1,
  entrance: 'S',
  road: 'C',
  rooms: list([
    [
      r('Snacks counter', 'food'),
      r('Maggi point', 'food'),
      r('Tea stall', 'food'),
      r('Seating area', 'food'),
      r('Kitchen', 'staff', true),
    ],
  ]),
});
corridorBuilding({
  id: 'med',
  name: 'Medical Centre (Dispensary)',
  code: 'MED',
  x: 775,
  y: 215,
  w: 90,
  h: 50,
  floors: 2,
  entrance: 'W',
  road: 'E',
  rooms: list([
    [
      r('OPD reception', 'opd'),
      r("Doctor's chamber 1", 'opd'),
      r("Doctor's chamber 2", 'opd'),
      r('Pharmacy', 'pharmacy'),
      r('Emergency room', 'emergency'),
      r('Dressing room', 'opd'),
      r('Injection room', 'opd'),
      r('Ambulance desk', 'emergency'),
    ],
    [
      r('Observation ward', 'ward'),
      r('Pathology lab', 'diagnostics'),
      r('X-ray room', 'diagnostics'),
      r('Dental clinic', 'opd'),
      r('Eye clinic', 'opd'),
      r('Physiotherapy', 'opd'),
      r('Counselling room', 'opd'),
      r('Medical officer', 'office', true),
    ],
  ]),
});
for (let i = 0; i < 5; i++) {
  const x = i < 3 ? 170 + i * 90 : 470 + (i - 3) * 90;
  corridorBuilding({
    id: `h${i + 1}`,
    name: `Hostel ${i + 1}`,
    code: `H${i + 1}`,
    x,
    y: 50,
    w: 60,
    h: 125,
    floors: 3,
    entrance: 'S',
    road: 'C',
    rooms: hostel(`Hostel ${i + 1}`),
  });
}
for (let i = 0; i < 2; i++) {
  corridorBuilding({
    id: `gh${i + 1}`,
    name: `Girls Hostel ${i + 1}`,
    code: `GH${i + 1}`,
    x: 770 + i * 62,
    y: 40,
    w: 56,
    h: 110,
    floors: 3,
    entrance: 'S',
    road: 'D',
    rooms: hostel(`Girls Hostel ${i + 1}`),
  });
}
corridorBuilding({
  id: 'sports',
  name: 'Sports Complex',
  code: 'SPC',
  x: 40,
  y: 300,
  w: 85,
  h: 60,
  floors: 2,
  entrance: 'E',
  road: 'W',
  rooms: list([
    [
      r('Badminton court', 'sports'),
      r('Table tennis hall', 'sports'),
      r('Gym', 'sports'),
      r('Sports office', 'office'),
      r('Equipment store', 'staff', true),
      r('Changing room (men)', 'sports'),
      r('Changing room (women)', 'sports'),
    ],
    [
      r('Yoga hall', 'sports'),
      r('Chess & carrom room', 'sports'),
      r('Squash court', 'sports'),
      r('Physiotherapy room', 'sports'),
      r('Coaches room', 'office'),
      r('Trophy room', 'other'),
      r('Store', 'staff', true),
    ],
  ]),
});
corridorBuilding({
  id: 'pool',
  name: 'Aquatic Centre',
  code: 'AQ',
  x: 40,
  y: 255,
  w: 85,
  h: 35,
  floors: 1,
  entrance: 'E',
  road: 'W',
  rooms: list([
    [
      r('Swimming pool entry', 'sports'),
      r('Lifeguard room', 'sports'),
      r('Changing rooms', 'sports'),
      r('Showers', 'sports'),
      r('Pool office', 'office'),
    ],
  ]),
});
corridorBuilding({
  id: 'shop',
  sideDoors: true,
  name: 'Shopping Complex',
  code: 'SC',
  x: 220,
  y: 588,
  w: 100,
  h: 40,
  floors: 1,
  entrance: 'N',
  road: 'A',
  rooms: list([
    [
      r('Stationery shop', 'other'),
      r('General store', 'other'),
      r('Photocopy & print', 'other'),
      r('Salon', 'other'),
      r('Juice corner', 'food'),
      r('Bakery', 'food'),
      r('Mobile repair', 'other'),
      r('Laundry', 'other'),
      r('Tailor', 'other'),
      r('Book shop', 'other'),
    ],
  ]),
});
corridorBuilding({
  id: 'bank',
  name: 'Bank & Post Office',
  code: 'BK',
  x: 340,
  y: 588,
  w: 60,
  h: 36,
  floors: 1,
  entrance: 'N',
  road: 'A',
  rooms: list([
    [
      r('Bank branch', 'billing'),
      r('Post office', 'other'),
      r('Bank manager', 'office'),
      r('Locker room', 'staff', true),
      r('Passbook printing', 'billing'),
    ],
  ]),
});
corridorBuilding({
  id: 'guest',
  sideDoors: true,
  name: 'Guest House',
  code: 'GHS',
  x: 620,
  y: 588,
  w: 90,
  h: 44,
  floors: 2,
  entrance: 'N',
  road: 'A',
  rooms: cycle((f, i) =>
    f === 0 && i === 0
      ? r('Guest house reception', 'admin')
      : f === 0 && i === 1
        ? r('Guest dining', 'food')
        : r(`Guest room ${f}${String(i).padStart(2, '0')}`, 'hostel'),
  ),
});
for (let i = 0; i < 4; i++) {
  corridorBuilding({
    id: `sq${i + 1}`,
    name: `Staff Quarters ${'ABCD'[i]}`,
    code: `SQ${'ABCD'[i]}`,
    x: 775,
    y: 400 + i * 58,
    w: 70,
    h: 40,
    floors: 2,
    entrance: 'W',
    road: 'E',
    rooms: cycle((f, i2) => r(`Quarter ${'ABCD'[i]}-${f}${i2 + 1}`, 'staff')),
  });
}
corridorBuilding({
  id: 'sec',
  name: 'Security & Visitor Centre',
  code: 'SEC',
  x: 395,
  y: 630,
  w: 48,
  h: 30,
  floors: 1,
  entrance: 'E',
  road: 'M',
  rooms: list([
    [
      r('Visitor pass desk', 'admin'),
      r('Security office', 'staff', true),
      r('CCTV room', 'utility', true),
      r('Waiting area', 'other'),
    ],
  ]),
});
singleRoom({
  id: 'temple',
  name: 'Campus Temple',
  code: 'TMP',
  x: 100,
  y: 590,
  w: 34,
  h: 34,
  entrance: 'E',
  road: 'W',
  category: 'other',
});
singleRoom({
  id: 'sub',
  name: 'Electrical Substation',
  code: 'ESS',
  x: 775,
  y: 300,
  w: 40,
  h: 30,
  entrance: 'W',
  road: 'E',
  category: 'utility',
  locked: true,
});
singleRoom({
  id: 'pump',
  name: 'Water Pump House',
  code: 'PMP',
  x: 160,
  y: 470,
  w: 20,
  h: 20,
  entrance: 'E',
  road: 'W',
  category: 'utility',
  locked: true,
});
singleRoom({
  id: 'atm',
  name: 'ATM Kiosk',
  code: 'ATM',
  x: 470,
  y: 520,
  w: 16,
  h: 14,
  entrance: 'E',
  road: 'M',
  category: 'billing',
});

// Amenities and help on the way.
amenities.push({ id: 'gate-help', kind: 'help-desk', node: mainGate.id, name: 'Security cabin' });
amenities.push({
  id: 'gate-wheelchair',
  kind: 'wheelchair',
  node: mainGate.id,
  name: 'Wheelchair at the gate',
});
amenities.push({ id: 'atm-kiosk', kind: 'atm', node: 'atm-ent' });
amenities.push({ id: 'bank-atm', kind: 'atm', node: 'bank-ent' });
amenities.push({ id: 'med-aed', kind: 'aed', node: 'med-ent' });
amenities.push({ id: 'sports-aed', kind: 'aed', node: 'sports-ent' });
amenities.push({
  id: 'mb-help',
  kind: 'help-desk',
  node: 'mb-ent',
  name: 'Main Building reception',
});
amenities.push({ id: 'lib-charging', kind: 'charging', node: 'lib-ent' });

// ---------------------------------------------------------------- road lines
for (const [roadId, list2] of stops) {
  const h = H.find((x) => x.id === roadId);
  const sorted = [...new Map(list2.map((n) => [n.id, n])).values()].sort((a, b) =>
    h ? a.x - b.x : a.y - b.y,
  );
  for (let i = 1; i < sorted.length; i++) edge(sorted[i - 1], sorted[i], 'outdoor');
}

// A road closed for works (to test detours): West Road from Sports Junction south to the
// Water Pump House path. Drawn red on the map; every route goes around it.
{
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const e of edges) {
    const a = byId.get(e.a);
    const b = byId.get(e.b);
    if (!a || !b || a.x !== 150 || b.x !== 150) continue;
    if (Math.min(a.y, b.y) >= 380 && Math.max(a.y, b.y) <= 480) e.tags = ['closed'];
  }
}

// ---------------------------------------------------------------- green, water, parking, trees
const green = (x, y, w, h, label) =>
  shape(ground, 'green', rect(x, y, w, h), label ? { label } : {});
green(190, 495, 220, 55, 'Main Lawn');
green(10, 60, 125, 120, 'Football Ground');
green(10, 400, 125, 150, 'Cricket Ground');
green(470, 470, 160, 82);
green(160, 270, 10, 25);
green(890 - 30, 560, 30, 70, 'Herbal Garden');
shape(ground, 'water', rect(480, 478, 140, 60), { label: 'Campus Lake' });
shape(ground, 'water', rect(40, 215, 85, 32), { label: 'Swimming Pool' });
shape(ground, 'parking', rect(470, 590, 120, 80), { label: 'Main Parking' });
shape(ground, 'parking', rect(155, 640, 55, 40), { label: 'Two-wheeler Parking' });
shape(ground, 'parking', rect(650, 40, 75, 60), { label: 'Hostel Parking' });
shape(ground, 'parking', rect(720, 470, 30, 70), { label: 'Staff Parking' });
shape(ground, 'building', rect(840, 300, 18, 18), { label: 'Water Tank' });

// Trees: avenues along the main roads, rows around lawns and grounds (deterministic).
let seed = 7;
const rand = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
const busy = (x, y) =>
  ground.shapes.some((s) => {
    if (!['building', 'water', 'parking', 'road'].includes(s.kind)) return false;
    const xs = s.pts.filter((_, i) => i % 2 === 0);
    const ys = s.pts.filter((_, i) => i % 2 === 1);
    return (
      x > Math.min(...xs) - 3 &&
      x < Math.max(...xs) + 3 &&
      y > Math.min(...ys) - 3 &&
      y < Math.max(...ys) + 3
    );
  });
const tree = (x, y, rad = 2.5) => {
  if (busy(x, y)) return;
  const pts = [];
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI / 3) * k;
    pts.push(r1(x + rad * Math.cos(a)), r1(y + rad * Math.sin(a)));
  }
  shape(ground, 'tree', pts);
};
for (let y = 130; y < 690; y += 18) {
  tree(438, y);
  tree(462, y);
}
for (const h of [H[0], H[1], H[2]]) {
  for (let x = h.x0 + 10; x < h.x1; x += 22) {
    tree(x, h.y - 10);
    tree(x + 11, h.y + 10);
  }
}
for (let x = 195; x < 410; x += 16) tree(x, 498 + rand() * 4);
for (let x = 14; x < 135; x += 14) {
  tree(x, 63);
  tree(x, 547);
}
for (let i = 0; i < 40; i++) tree(472 + rand() * 156, 541 + rand() * 9, 2 + rand());

// ---------------------------------------------------------------- write
const map = {
  fmt: 0,
  site: { id: 'demo-mesra', name: 'Demo Tech Campus (Mesra-style)' },
  buildings,
  levels,
  nodes,
  edges,
  connectors,
  rooms,
  amenities,
  qr,
};
// One item per line: readable diffs, still compact.
const lines = (key, arr) =>
  `  "${key}": [\n${arr.map((x) => `    ${JSON.stringify(x)}`).join(',\n')}\n  ]`;
const json = `{\n  "fmt": 0,\n  "site": ${JSON.stringify(map.site)},\n${[
  lines('buildings', buildings),
  `  "levels": [\n${levels
    .map((l) => {
      const { shapes, ...rest } = l;
      const head = JSON.stringify(rest).slice(0, -1);
      return `    ${head}, "shapes": [\n${shapes.map((s) => `      ${JSON.stringify(s)}`).join(',\n')}\n    ]}`;
    })
    .join(',\n')}\n  ]`,
  lines('nodes', nodes),
  lines('edges', edges),
  lines('connectors', connectors),
  lines('rooms', rooms),
  lines('amenities', amenities),
  lines('qr', qr),
].join(',\n')}\n}\n`;
writeFileSync(OUT, json);
console.log(
  `demo-mesra: ${buildings.length} buildings, ${levels.length} levels, ${nodes.length} dots, ${edges.length} lines, ${rooms.length} rooms, ${ground.shapes.length} shapes on Ground`,
);
