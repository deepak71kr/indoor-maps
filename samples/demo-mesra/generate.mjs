/**
 * Generates samples/demo-mesra/map.json — a big demo campus loosely inspired by a large Indian
 * engineering college (BIT Mesra-style): main building, departments, lecture halls, library,
 * hostels, mess and canteens, medical centre, sports, swimming pool, quarters, roads, lawns,
 * a lake and trees, winding roads and footpaths. The Main Building and its twin follow the
 * founder's sketches (images/map-demo-1.png, map-demo-2.png). It is a fictional layout for
 * testing, not a real map of any campus.
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

// ---------------------------------------------------------------- roads and footpaths
/**
 * Roads and footpaths are lines through named spots; a spot shared by two roads is where
 * they meet. Roads bend and run at angles like a real campus that grew over the years.
 * Buildings join the nearest point of their road with a short footpath.
 */
const SPOT = {
  gate: [640, 890, 'Main Gate (security cabin)', 'entrance'],
  gateCircle: [640, 800, 'Gate Circle (fountain)'],
  libChowk: [600, 560, 'Library Chowk (clock tower)'],
  acadChowk: [610, 430, 'Academic Chowk (notice board)'],
  hostelChowk: [660, 300, 'Hostel Chowk (tea stall)'],
  flagPost: [720, 40, 'Flag post, north end of Main Avenue'],
  westJn: [300, 760, 'West Junction (bus stop)'],
  templeEnd: [90, 640, 'West end of Gate Road'],
  eastJn: [920, 740, 'East Junction (letter box)'],
  dispJn: [1060, 470, 'Dispensary Junction (red cross sign)'],
  colonyJn: [1050, 300, 'Staff Colony Junction'],
  backGate: [1030, 60, 'Back Gate', 'entrance'],
  qNW: [305, 310, 'Quad north-west corner'],
  qNE: [415, 310, 'Quad north-east corner'],
  qMW: [305, 420, 'Quad west gate'],
  qME: [415, 420, 'Quad east gate'],
  qSW: [305, 530, 'Quad south-west corner'],
  qSE: [415, 530, 'Quad south-east corner'],
  sportsJn: [200, 400, 'Sports Junction (scoreboard)'],
  hostelJn: [900, 220, 'Hostel Junction'],
  ghGate: [300, 150, 'Girls Hostel Gate'],
};
/**
 * `via`: spot names, [x, y] bends ([x, y, name] where visitors turn), or { on, at } — a point
 * on a road listed earlier.
 */
const ROADS = [
  {
    id: 'main',
    name: 'Main Avenue',
    w: 14,
    via: [
      'gate',
      'gateCircle',
      [620, 690],
      'libChowk',
      'acadChowk',
      'hostelChowk',
      [700, 180],
      'flagPost',
    ],
  },
  {
    id: 'gateW',
    name: 'Gate Road',
    w: 10,
    via: ['gateCircle', [520, 790], 'westJn', [150, 700], 'templeEnd'],
  },
  {
    id: 'east',
    name: 'East Road',
    w: 10,
    via: ['gateCircle', [780, 790], 'eastJn', [1040, 640], 'dispJn', 'colonyJn', 'backGate'],
    // Closed for works (to test detours): drawn red on the map, every route goes around it.
    closed: [1],
  },
  { id: 'quad', name: 'Quad Road', w: 8, via: ['qNW', 'qNE', 'qME', 'qSE', 'qSW', 'qMW', 'qNW'] },
  { id: 'quadMid', name: 'Quad Middle Road', w: 8, via: ['qMW', 'qME'] },
  { id: 'acad', name: 'Academic Avenue', w: 10, via: ['qME', [510, 430], 'acadChowk'] },
  { id: 'lib', name: 'Library Road', w: 8, via: ['qSE', [500, 560], 'libChowk'] },
  { id: 'sports', name: 'Sports Road', w: 8, via: ['qMW', 'sportsJn', [90, 380]] },
  { id: 'college', name: 'College Road', w: 10, via: ['westJn', [305, 640], 'qSW'] },
  {
    id: 'hostel',
    name: 'Hostel Road',
    w: 10,
    via: ['hostelChowk', [780, 270], 'hostelJn', 'colonyJn'],
  },
  {
    id: 'hostelW',
    name: 'Girls Hostel Road',
    w: 8,
    via: [
      'hostelChowk',
      [540, 250, 'Library Lane corner (bench)'],
      [430, 200],
      'ghGate',
      [180, 120],
    ],
  },
  {
    id: 'dept',
    name: 'Department Road',
    w: 8,
    via: ['acadChowk', [760, 420], [900, 430], 'dispJn'],
  },
  { id: 'colony', name: 'Staff Colony Road', w: 8, via: ['eastJn', [1000, 800], [1150, 810]] },
  {
    id: 'workshop',
    name: 'Workshop Road',
    w: 8,
    via: ['sportsJn', [170, 300, 'Workshop Road bend (tool shed)'], [120, 260]],
  },
  // Footpaths: shortcuts across lawns and along the lake.
  {
    id: 'lawnPath',
    name: 'Central Lawn path',
    w: 3,
    path: true,
    via: [
      { on: 'college', at: [305, 600] },
      [385, 615, 'Lawn path crossing (stone bench)'],
      { on: 'lib', at: [450, 545] },
    ],
  },
  {
    id: 'lakeWalk',
    name: 'Lake Walk',
    w: 3,
    path: true,
    via: [
      { on: 'main', at: [604, 588] },
      [690, 588],
      [875, 588],
      [940, 590],
      { on: 'east', at: [1048, 590] },
    ],
  },
  {
    id: 'lakeLane',
    name: 'Lake lane',
    w: 3,
    path: true,
    via: [
      { on: 'dept', at: [670, 426] },
      { on: 'lakeWalk', at: [670, 588] },
    ],
  },
  {
    id: 'libLane',
    name: 'Library Lane',
    w: 3,
    path: true,
    via: [
      { on: 'hostelW', at: [540, 250, 'Library Lane corner (bench)'] },
      { on: 'quad', at: [415, 312] },
    ],
  },
  {
    id: 'gatePath',
    name: 'Gate footpath',
    w: 3,
    path: true,
    via: [
      { on: 'main', at: [640, 850] },
      [560, 840, 'Gate footpath bend (bicycle stand)'],
      { on: 'gateW', at: [500, 787] },
    ],
  },
];

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

/** A band `w` wide along a → b (ends stretched so bends join), first side along the line. */
function band(a, b, w) {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  const n = { x: -u.y * (w / 2), y: u.x * (w / 2) };
  const s = { x: a.x - (u.x * w) / 2, y: a.y - (u.y * w) / 2 };
  const e = { x: b.x + (u.x * w) / 2, y: b.y + (u.y * w) / 2 };
  return [
    s.x + n.x,
    s.y + n.y,
    e.x + n.x,
    e.y + n.y,
    e.x - n.x,
    e.y - n.y,
    s.x - n.x,
    s.y - n.y,
  ].map(r1);
}

/** Lines that dots can be added to later (roads, corridors): each keeps its stops in order. */
function lineNet() {
  const segs = [];
  const nearest = (p, keep = () => true) => {
    let best = null;
    for (const seg of segs) {
      if (!keep(seg)) continue;
      const dx = seg.b.x - seg.a.x;
      const dy = seg.b.y - seg.a.y;
      const len2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((p.x - seg.a.x) * dx + (p.y - seg.a.y) * dy) / len2));
      const q = { x: seg.a.x + dx * t, y: seg.a.y + dy * t };
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (!best || d < best.d) best = { seg, t, q, d, len: Math.sqrt(len2) };
    }
    return best;
  };
  return {
    segs,
    line(a, b, extra = {}) {
      segs.push({
        a,
        b,
        stops: [
          { t: 0, n: a },
          { t: 1, n: b },
        ],
        ...extra,
      });
    },
    /** The dot on the nearest line closest to `p` (an existing end within 2 m, else new). */
    attach(p, make, keep) {
      const hit = nearest(p, keep);
      if (hit.t * hit.len < 2) return hit.seg.a;
      if ((1 - hit.t) * hit.len < 2) return hit.seg.b;
      const near = hit.seg.stops.find((s) => Math.abs(s.t - hit.t) * hit.len < 2);
      if (near) return near.n;
      const n = make(hit.q);
      hit.seg.stops.push({ t: hit.t, n });
      return n;
    },
    /** Walking lines along every line, through its stops in order. */
    finish(kind) {
      for (const seg of segs) {
        const sorted = [...seg.stops].sort((x, y) => x.t - y.t);
        const before = edges.length;
        for (let i = 1; i < sorted.length; i++) edge(sorted[i - 1].n, sorted[i].n, kind);
        if (seg.closed) for (let k = before; k < edges.length; k++) edges[k].tags = ['closed'];
      }
    },
  };
}

const roadNet = lineNet();
const onRoad = (roadId) => (seg) => seg.road === roadId;
for (const road of ROADS) {
  const points = road.via.map((v) => {
    if (typeof v === 'string') {
      const [x, y, landmark, kind] = SPOT[v];
      return roadPoint(x, y, landmark, kind);
    }
    if (Array.isArray(v)) return roadPoint(v[0], v[1], v[2], 'corner');
    const [x, y] = v.at;
    return roadNet.attach(
      { x, y },
      (q) => roadPoint(q.x, q.y, `Where ${road.name} meets the road`),
      onRoad(v.on),
    );
  });
  let longest = 0;
  for (let i = 1; i < points.length; i++) {
    const len = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    if (len > points[longest]?.len || i === 1) longest = i;
    points[i].len = len;
  }
  for (let i = 1; i < points.length; i++) {
    roadNet.line(points[i - 1], points[i], { road: road.id, closed: road.closed?.includes(i - 1) });
    shape(ground, road.path ? 'path' : 'road', band(points[i - 1], points[i], road.w), {
      ...(i === longest && { label: road.name }),
    });
  }
  for (const p of points) delete p.len;
}
const mainGate = pointIds.get('640,890');
qr.push({ code: 'MAIN-GATE', node: mainGate.id, facing: 0 });
qr.push({ code: 'BACK-GATE', node: pointIds.get('1030,60').id, facing: 180 });

/** A building's way in, joined to the nearest point of its road by a short footpath. */
function joinRoad(roadId, entrance, buildingName) {
  const at = roadNet.attach(
    entrance,
    (q) => roadPoint(q.x, q.y, `Path to ${buildingName}`),
    onRoad(roadId),
  );
  if (!at.landmark) at.landmark = `Path to ${buildingName}`;
  edge(at, entrance, 'outdoor');
  shape(ground, 'path', band(entrance, at, 2.5));
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

/**
 * A square block as the founder drew the Main Building (images/map-demo-1.png): rooms round
 * the edge, two staircases and two rooms in the middle, a ring corridor with a cross
 * corridor, washrooms and water dispensers in the corners, four ways in, and numbered
 * checkpoints (QR stickers 1–11). Every floor has the same plan. Sketch units run 0–40
 * across (north up); `scale` turns them into meters.
 */
const SKETCH = {
  // Corridor dots and their names.
  dots: {
    A: [7.8, 0.6, 'Exit 1 lobby'],
    B: [7.8, 6, 'north-west corner'],
    C: [31.5, 6, 'north-east corner'],
    D: [31.5, 0.6, 'Entrance lobby'],
    E: [7.8, 23, 'west cross corridor'],
    F: [18, 23, 'centre crossing'],
    G: [31.5, 23, 'east cross corridor'],
    M: [7.8, 30, 'Exit 2 lobby'],
    H: [7.8, 35.4, 'south-west corner'],
    I: [18, 35.4, 'south crossing'],
    J: [31.5, 35.4, 'south-east corner'],
    K: [31.5, 39.4, 'Entry lobby'],
  },
  corridors: ['AB', 'BC', 'CD', 'BE', 'EM', 'MH', 'EF', 'FG', 'CG', 'FI', 'GJ', 'HI', 'IJ', 'JK'],
  // Rooms in naming order: 01–07, then halls I, II, III. [u0, v0, u1, v1], door [u, v].
  rooms: [
    { n: '01', r: [9.5, 0, 16.3, 5], d: [12.9, 5] },
    { n: '02', r: [16.3, 0, 23.2, 5], d: [19.75, 5] },
    { n: '03', r: [23.2, 0, 30, 5], d: [26.6, 5] },
    { n: '04', r: [33.5, 6.5, 40, 17.5], d: [33.5, 12] },
    { n: '05', r: [33.5, 17.5, 40, 28.5], d: [33.5, 23] },
    { n: '06', r: [12.9, 15.9, 18.4, 21.9], d: [15.6, 21.9] },
    { n: '07', r: [18.4, 15.9, 24.9, 21.9], d: [21.6, 21.9] },
    { n: '-I', r: [0, 21, 6.2, 28.5], d: [6.2, 24.75] },
    { n: '-II', r: [0, 7, 6.2, 13], d: [6.2, 10] },
    { n: '-III', r: [0, 13, 6.2, 21], d: [6.2, 17] },
  ],
  washrooms: [
    { r: [0, 0, 6, 7], d: [6, 4], label: 'Washroom 1' },
    { r: [35.5, 31, 40, 40], d: [35.5, 33], label: 'Washroom 2' },
  ],
  water: [
    { r: [33.5, 0, 40, 5], at: [31.5, 2.5] },
    { r: [0, 31, 5, 40], at: [7.8, 36] },
  ],
  stairs: [
    { r: [18.2, 8, 25.9, 15], stop: [22, 8], label: 'Stairs 1' },
    { r: [21.4, 24, 29.3, 31.2], stop: [21.4, 27.5], label: 'Stairs 2' },
  ],
  // Ways in on the ground floor: wall point, the corridor dot inside, QR facing.
  doors: [
    { key: 'entry', label: 'Entry', at: [31.5, 40], inside: 'K', facing: 0, code: 'ENT' },
    { key: 'entrance', label: 'Entrance', at: [31.5, 0], inside: 'D', facing: 180, code: 'N' },
    { key: 'exit1', label: 'Exit 1', at: [7.8, 0], inside: 'A', facing: 180, code: 'X1' },
    { key: 'exit2', label: 'Exit 2', at: [0, 30], inside: 'M', facing: 90, code: 'X2' },
  ],
  // Checkpoint stickers 1–11 as drawn: a corridor dot, or a point on a corridor.
  checkpoints: ['K', 'H', 'M', [22, 35.4], 'G', [13, 23], 'B', [15, 6], 'A', 'D', 'C'],
};

function sketchBuilding(b) {
  const { id, name, code, x, y, scale = 1.5, floors = 3, names, roads } = b;
  const size = 40 * scale;
  const P = (u, v) => ({ x: x + u * scale, y: y + v * scale });
  const box = ([u0, v0, u1, v1]) => {
    const a = P(u0, v0);
    const c = P(u1, v1);
    return rect(a.x, a.y, c.x - a.x, c.y - a.y);
  };
  buildings.push({ id, name });
  shape(ground, 'building', rect(x, y, size, size), { building: id });
  const stairs = SKETCH.stairs.map((s, i) => ({
    id: `${id}-stairs-${i + 1}`,
    kind: 'stairs',
    name: `${name} ${s.label.toLowerCase()}`,
    stops: {},
  }));

  for (let f = 0; f < floors; f++) {
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
    }
    shape(level, 'floor', rect(x, y, size, size));
    const floorName = f === 0 ? 'Ground' : `Floor ${f}`;
    const tag = f === 0 ? 'G' : String(f);
    const nid = (s) => `${id}-${tag}-${s}`.toLowerCase();

    // Corridors.
    const dots = {};
    for (const [k, [u, v, label]] of Object.entries(SKETCH.dots)) {
      const p = P(u, v);
      dots[k] = node(nid(k), lvlId, p.x, p.y, 'junction', `${name} ${label}, ${floorName}`);
    }
    const net = lineNet();
    for (const [a, c] of SKETCH.corridors) net.line(dots[a], dots[c]);
    let extra = 0;
    const onCorridor = (u, v, landmark) =>
      net.attach(P(u, v), (q) => node(nid(`c${++extra}`), lvlId, q.x, q.y, 'junction', landmark));

    // Rooms and their doors.
    SKETCH.rooms.forEach((slot, i) => {
      const spec = names[f][i];
      const roomId = nid(`r${slot.n.replace('-', 'h')}`);
      shape(level, 'room', box(slot.r), { room: roomId });
      const dp = P(...slot.d);
      const door = node(`${roomId}-d`, lvlId, dp.x, dp.y, 'door', spec.name);
      edge(onCorridor(...slot.d, `Outside ${spec.name}`), door);
      rooms.push({
        id: roomId,
        name: spec.name,
        number: `${tag}${slot.n}`,
        category: spec.category,
        doors: [door.id],
        ...(spec.locked && { visibility: 'locked' }),
      });
    });
    SKETCH.washrooms.forEach((w, i) => {
      shape(level, 'room', box(w.r), { label: w.label });
      const at = onCorridor(...w.d, `Outside ${w.label.toLowerCase()}`);
      amenities.push({ id: nid(`wc${i + 1}`), kind: 'toilet', node: at.id, name: w.label });
    });
    SKETCH.water.forEach((w, i) => {
      shape(level, 'room', box(w.r), { label: 'Water' });
      const at = onCorridor(...w.at, `By the water dispenser`);
      amenities.push({
        id: nid(`water${i + 1}`),
        kind: 'water',
        node: at.id,
        name: 'Water dispenser',
      });
    });
    SKETCH.stairs.forEach((s, i) => {
      shape(level, 'stairs', box(s.r), { label: s.label });
      const sp = P(...s.stop);
      const stop = node(
        nid(`stairs${i + 1}`),
        lvlId,
        sp.x,
        sp.y,
        'stairs-stop',
        `${name} ${s.label.toLowerCase()}`,
      );
      const landing = onCorridor(...s.stop, `${name} ${s.label.toLowerCase()}, ${floorName}`);
      edge(stop, landing);
      stairs[i].stops[lvlId] = stop.id;
    });
    // Checkpoint stickers (every floor), then the corridor lines.
    SKETCH.checkpoints.forEach((c, i) => {
      const at =
        typeof c === 'string' ? dots[c] : onCorridor(...c, `${name} corridor, ${floorName}`);
      qr.push({ code: `${code}-${tag}-${i + 1}`, node: at.id, facing: 0 });
    });
    net.finish();

    // Ways in (ground floor).
    if (f === 0) {
      for (const d of SKETCH.doors) {
        const p = P(...d.at);
        const door = node(`${id}-${d.key}`, 'G', p.x, p.y, 'entrance', `${name} ${d.label}`);
        edge(door, dots[d.inside]);
        joinRoad(roads[d.key], door, `${name} ${d.label}`);
        qr.push({ code: `${code}-${d.code}`, node: door.id, facing: d.facing });
      }
    }
  }
  connectors.push(...stairs);
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
// Not a grid: the academic quad (Main Building and its twin) sits west of a bending Main
// Avenue, hostels spread out to the north-east, workshops and sports far to the west.

const hall = (name, category = 'classroom', locked = false) => r(name, category, locked);
sketchBuilding({
  id: 'mb',
  name: 'Main Building',
  code: 'MB',
  x: 330,
  y: 330,
  roads: { entry: 'quadMid', entrance: 'quad', exit1: 'quad', exit2: 'quad' },
  // Per floor: rooms 01–07, then halls I, II, III (images/map-demo-1.png).
  names: [
    [
      r('Admission office', 'admin'),
      r('Accounts section', 'billing'),
      r('Registrar office', 'admin'),
      r('Exam section', 'admin'),
      r('Fee counter', 'billing'),
      r('Help desk', 'admin'),
      r('Records room', 'staff', true),
      hall('Training room'),
      hall('Visitors lounge', 'other'),
      hall('Scholarship cell', 'admin'),
    ],
    [
      r("Director's office", 'office', true),
      r('Dean Academics', 'office'),
      r('Dean Students', 'office'),
      r('Board room', 'office'),
      r('Conference room', 'office'),
      r('Placement cell', 'admin'),
      r('PA office', 'office'),
      hall('Committee room', 'office'),
      hall('Waiting lounge', 'other'),
      hall('IQAC office', 'office'),
    ],
    [
      r('Language lab', 'lab'),
      r('Physics lab', 'lab'),
      r('Chemistry lab', 'lab'),
      hall('Senate hall'),
      hall('Training & placement hall'),
      r('Interview room 1', 'office'),
      r('Interview room 2', 'office'),
      hall('Mathematics department', 'office'),
      hall('Physics department', 'office'),
      hall('MBA classroom 1'),
    ],
  ],
});
// Its twin just south, across Quad Middle Road (images/map-demo-2.png).
sketchBuilding({
  id: 'sb',
  name: 'Science Block',
  code: 'SB',
  x: 330,
  y: 450,
  roads: { entry: 'quad', entrance: 'quadMid', exit1: 'quadMid', exit2: 'quad' },
  names: [
    [
      r('Biology lab', 'lab'),
      r('Microbiology lab', 'lab'),
      r('Biotech lab', 'lab'),
      r('Instrument room', 'staff', true),
      r('Science office', 'admin'),
      hall('Seminar room'),
      r('Chemical store', 'staff', true),
      hall('Lecture room G-I'),
      hall('Lecture room G-II'),
      hall('Lecture room G-III'),
    ],
    [
      r('Statistics lab', 'lab'),
      r('Computer centre', 'lab'),
      r('Electronics lab', 'lab'),
      hall('Classroom 104'),
      hall('Classroom 105'),
      r('Faculty room', 'office'),
      hall('Tutorial room'),
      hall('Lecture room 1-I'),
      hall('Lecture room 1-II'),
      hall('Lecture room 1-III'),
    ],
    [
      r('Research lab 1', 'lab'),
      r('Research lab 2', 'lab'),
      r('Research lab 3', 'lab'),
      r('Science conference room', 'office'),
      r('Science library corner', 'library'),
      r('Research scholars room', 'office'),
      r('Store room', 'staff', true),
      hall('Lecture room 2-I'),
      hall('Lecture room 2-II'),
      hall('Lecture room 2-III'),
    ],
  ],
});

const DEPARTMENTS = [
  {
    id: 'cse',
    name: 'CSE Department',
    code: 'CSE',
    x: 680,
    y: 445,
    entrance: 'N',
    road: 'dept',
    labs: ['Computer', 'Networks', 'AI & ML', 'Software', 'Database'],
  },
  {
    id: 'ece',
    name: 'ECE Department',
    code: 'ECE',
    x: 880,
    y: 450,
    w: 50,
    h: 120,
    entrance: 'N',
    road: 'dept',
    labs: ['Electronics', 'VLSI', 'Communication', 'Embedded Systems', 'Signal Processing'],
  },
  {
    id: 'me',
    name: 'Mechanical Department',
    code: 'ME',
    x: 60,
    y: 180,
    floors: 2,
    entrance: 'S',
    road: 'workshop',
    labs: ['Workshop', 'Thermal', 'CAD', 'Robotics', 'Fluid Mechanics'],
  },
  {
    id: 'ce',
    name: 'Civil Department',
    code: 'CE',
    x: 120,
    y: 560,
    floors: 2,
    entrance: 'E',
    road: 'college',
    labs: ['Surveying', 'Concrete', 'Soil Mechanics', 'Hydraulics', 'Transport'],
  },
];
for (const d of DEPARTMENTS) {
  corridorBuilding({
    w: 120,
    h: 50,
    floors: 3,
    sideDoors: true,
    ...d,
    rooms: dept(d.code, d.labs),
  });
}
corridorBuilding({
  id: 'lhc',
  name: 'Lecture Hall Complex',
  code: 'LH',
  x: 650,
  y: 600,
  w: 200,
  h: 50,
  floors: 2,
  entrance: 'W',
  road: 'main',
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
  x: 450,
  y: 340,
  w: 130,
  h: 60,
  floors: 2,
  entrance: 'S',
  road: 'acad',
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
  x: 450,
  y: 460,
  w: 90,
  h: 70,
  floors: 1,
  entrance: 'N',
  road: 'acad',
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
  x: 700,
  y: 330,
  w: 110,
  h: 55,
  floors: 1,
  entrance: 'N',
  road: 'hostel',
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
  x: 470,
  y: 600,
  w: 80,
  h: 50,
  floors: 1,
  entrance: 'N',
  road: 'lib',
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
  x: 930,
  y: 130,
  w: 60,
  h: 60,
  floors: 1,
  entrance: 'S',
  road: 'hostel',
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
  x: 1080,
  y: 440,
  w: 90,
  h: 50,
  floors: 2,
  entrance: 'W',
  road: 'east',
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
// Hostels: spread out, each on its own patch (x, y, the side facing its road, the road).
const HOSTELS = [
  [740, 110, 'S', 'hostel'],
  [830, 80, 'S', 'hostel'],
  [1080, 80, 'W', 'east'],
  [1090, 270, 'W', 'east'],
  [600, 40, 'E', 'main'],
];
HOSTELS.forEach(([x, y, entrance, road], i) =>
  corridorBuilding({
    id: `h${i + 1}`,
    name: `Hostel ${i + 1}`,
    code: `H${i + 1}`,
    x,
    y,
    w: 60,
    h: 125,
    floors: 3,
    entrance,
    road,
    rooms: hostel(`Hostel ${i + 1}`),
  }),
);
[
  [330, 20],
  [220, 5],
].forEach(([x, y], i) =>
  corridorBuilding({
    id: `gh${i + 1}`,
    name: `Girls Hostel ${i + 1}`,
    code: `GH${i + 1}`,
    x,
    y,
    w: 56,
    h: 110,
    floors: 3,
    entrance: 'S',
    road: 'hostelW',
    rooms: hostel(`Girls Hostel ${i + 1}`),
  }),
);
corridorBuilding({
  id: 'sports',
  name: 'Sports Complex',
  code: 'SPC',
  x: 40,
  y: 410,
  w: 85,
  h: 60,
  floors: 2,
  entrance: 'N',
  road: 'sports',
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
  x: 140,
  y: 420,
  w: 85,
  h: 35,
  floors: 1,
  entrance: 'N',
  road: 'sports',
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
  x: 400,
  y: 690,
  w: 100,
  h: 40,
  floors: 1,
  entrance: 'S',
  road: 'gateW',
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
  x: 530,
  y: 700,
  w: 60,
  h: 36,
  floors: 1,
  entrance: 'E',
  road: 'main',
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
  name: 'Guest House',
  code: 'GHS',
  x: 1080,
  y: 640,
  w: 90,
  h: 44,
  floors: 2,
  entrance: 'W',
  road: 'east',
  rooms: cycle((f, i) =>
    f === 0 && i === 0
      ? r('Guest house reception', 'admin')
      : f === 0 && i === 1
        ? r('Guest dining', 'food')
        : r(`Guest room ${f}${String(i).padStart(2, '0')}`, 'hostel'),
  ),
});
[
  [960, 830, 70, 'N'],
  [1060, 830, 70, 'N'],
  [1040, 740, 70, 'S'],
  [1130, 735, 60, 'S'],
].forEach(([x, y, w, entrance], i) =>
  corridorBuilding({
    id: `sq${i + 1}`,
    name: `Staff Quarters ${'ABCD'[i]}`,
    code: `SQ${'ABCD'[i]}`,
    x,
    y,
    w,
    h: 40,
    floors: 2,
    entrance,
    road: 'colony',
    rooms: cycle((f, i2) => r(`Quarter ${'ABCD'[i]}-${f}${i2 + 1}`, 'staff')),
  }),
);
corridorBuilding({
  id: 'sec',
  name: 'Security & Visitor Centre',
  code: 'SEC',
  x: 660,
  y: 840,
  w: 48,
  h: 30,
  floors: 1,
  entrance: 'W',
  road: 'main',
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
  x: 40,
  y: 600,
  w: 34,
  h: 34,
  entrance: 'E',
  road: 'gateW',
  category: 'other',
});
singleRoom({
  id: 'sub',
  name: 'Electrical Substation',
  code: 'ESS',
  x: 1100,
  y: 540,
  w: 40,
  h: 30,
  entrance: 'W',
  road: 'east',
  category: 'utility',
  locked: true,
});
singleRoom({
  id: 'pump',
  name: 'Water Pump House',
  code: 'PMP',
  x: 250,
  y: 440,
  w: 20,
  h: 20,
  entrance: 'N',
  road: 'sports',
  category: 'utility',
  locked: true,
});
singleRoom({
  id: 'atm',
  name: 'ATM Kiosk',
  code: 'ATM',
  x: 590,
  y: 760,
  w: 16,
  h: 14,
  entrance: 'E',
  road: 'main',
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
  node: 'mb-entry',
  name: 'Main Building reception',
});
amenities.push({ id: 'lib-charging', kind: 'charging', node: 'lib-ent' });

// Popular places, shown first to new visitors (the first room with each name).
for (const name of [
  'Admission office',
  'Fee counter',
  'Exam section',
  'Help desk',
  'Reading hall',
  'OPD reception',
]) {
  const room = rooms.find((x) => x.name === name);
  if (room) room.popular = true;
}

// ---------------------------------------------------------------- walking lines on roads
roadNet.finish('outdoor');

// ---------------------------------------------------------------- green, water, parking, trees
const green = (x, y, w, h, label) =>
  shape(ground, 'green', rect(x, y, w, h), label ? { label } : {});
green(311, 316, 98, 98);
green(311, 426, 98, 98);
green(320, 560, 130, 110, 'Central Lawn');
green(20, 20, 150, 95, 'Football Ground');
green(10, 480, 100, 100, 'Cricket Ground');
green(690, 505, 150, 70);
green(960, 330, 60, 80, 'Herbal Garden');
green(560, 470, 30, 70);
green(190, 230, 90, 60, 'Workshop Yard');
shape(ground, 'water', rect(700, 512, 130, 56), { label: 'Campus Lake' });
shape(ground, 'water', rect(140, 462, 85, 30), { label: 'Swimming Pool' });
shape(ground, 'parking', rect(680, 690, 110, 70), { label: 'Main Parking' });
shape(ground, 'parking', rect(320, 690, 60, 40), { label: 'Two-wheeler Parking' });
shape(ground, 'parking', rect(830, 290, 70, 50), { label: 'Hostel Parking' });
shape(ground, 'building', rect(1170, 300, 18, 18), { label: 'Water Tank' });

// Trees: avenues along the bigger roads, rows round lawns and grounds (deterministic).
let seed = 7;
const rand = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
const inside = (pts, x, y) => {
  let hit = false;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const [xi, yi, xj, yj] = [pts[i], pts[i + 1], pts[j], pts[j + 1]];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};
const busy = (x, y) =>
  ground.shapes.some((s) => {
    if (!['building', 'water', 'parking', 'road', 'path'].includes(s.kind)) return false;
    // Roads and paths: the band itself plus a little space either side.
    return [
      [0, 0],
      [3, 0],
      [-3, 0],
      [0, 3],
      [0, -3],
    ].some(([dx, dy]) => inside(s.pts, x + dx, y + dy));
  });
const tree = (x, y, rad = 2.5) => {
  if (busy(x, y)) return;
  // Four points are enough: the map draws every tree as a circle in its outline's box.
  shape(ground, 'tree', [x - rad, y, x, y - rad, x + rad, y, x, y + rad].map(r1));
};
for (const seg of roadNet.segs) {
  const road = ROADS.find((x) => x.id === seg.road);
  if (!road || road.w < 10) continue;
  const len = Math.hypot(seg.b.x - seg.a.x, seg.b.y - seg.a.y);
  const u = { x: (seg.b.x - seg.a.x) / len, y: (seg.b.y - seg.a.y) / len };
  const off = road.w / 2 + 5;
  for (let s = 12; s < len - 10; s += 32) {
    const p = { x: seg.a.x + u.x * s, y: seg.a.y + u.y * s };
    tree(p.x - u.y * off, p.y + u.x * off);
    tree(p.x + u.y * off + u.x * 10, p.y - u.x * off + u.y * 10);
  }
}
for (let x = 325; x < 445; x += 16) tree(x, 663 + rand() * 3);
for (let x = 24; x < 170; x += 14) tree(x, 117);
for (let i = 0; i < 16; i++) tree(692 + rand() * 146, 570 + rand() * 4, 2 + rand());
for (let i = 0; i < 12; i++) tree(962 + rand() * 56, 332 + rand() * 76, 2 + rand());

// Draw order: ground cover first, then roads and paths, then buildings, trees on top.
const LAYER = { green: 0, water: 1, parking: 1, road: 2, path: 3, tree: 5 };
ground.shapes = ground.shapes
  .map((s, i) => ({ s, i }))
  .sort((a, b) => (LAYER[a.s.kind] ?? 4) - (LAYER[b.s.kind] ?? 4) || a.i - b.i)
  .map(({ s }) => s);

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
