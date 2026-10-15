import type { Destination } from '@innermap/core';
import { buildDirections, findRoute, loadSite } from '@innermap/core';
import type { MapFile } from '@innermap/schema';
import { validateMapFile } from '@innermap/schema/validate';
import { describe, expect, it } from 'vitest';
import demo from '../../../../samples/demo-hospital/map.json';
import {
  addDoorToRoom,
  addPathPoint,
  change,
  createRoom,
  deleteConnector,
  deleteItems,
  hitTest,
  placeConnector,
  placeDoor,
  renameConnector,
  setConnectorLevels,
  splitEdge,
  updateEdge,
  updateNode,
  updateRoom,
} from './drawing';
import { newProject } from './project';

const demoDoc = (): MapFile => JSON.parse(JSON.stringify(demo)) as MapFile;
const at = (doc: MapFile, lvl: string, x: number, y: number) => {
  const hit = hitTest(doc, lvl, { x, y }, 0.01);
  return hit.type === 'node' ? hit.id : undefined;
};

/** One empty floor with a straight 20 m corridor: A(0,0) — B(20,0). */
function corridor(): { doc: MapFile; a: string; b: string } {
  let doc = newProject();
  const a = addPathPoint(doc, 'G', null, { x: 0, y: 0 }, { type: 'none' });
  const b = addPathPoint(a.doc, 'G', a.id, { x: 20, y: 0 }, { type: 'none' });
  doc = b.doc;
  return { doc, a: a.id, b: b.id };
}

describe('Path tool', () => {
  it('click, click draws two dots joined by a line', () => {
    const { doc, a, b } = corridor();
    expect(doc.nodes.map((n) => [n.id, n.x, n.y, n.kind])).toEqual([
      [a, 0, 0, 'junction'],
      [b, 20, 0, 'junction'],
    ]);
    expect(doc.edges).toEqual([{ a, b }]);
  });

  it('clicking near an existing dot snaps to it (joins paths)', () => {
    const { doc, a } = corridor();
    const hit = hitTest(doc, 'G', { x: 0.2, y: 0.1 }, 0.5);
    expect(hit).toEqual({ type: 'node', id: a });
    const branch = addPathPoint(doc, 'G', null, { x: 0.2, y: 0.1 }, hit);
    expect(branch.id).toBe(a);
    expect(branch.doc.nodes).toHaveLength(2);
  });

  it('clicking on a line splits it — a T-junction', () => {
    const { doc, a, b } = corridor();
    const hit = hitTest(doc, 'G', { x: 8, y: 0.3 }, 0.5);
    expect(hit).toMatchObject({ type: 'edge', point: { x: 8, y: 0 } });
    const t = addPathPoint(doc, 'G', null, { x: 8, y: 0.3 }, hit);
    const side = addPathPoint(t.doc, 'G', t.id, { x: 8, y: 6 }, { type: 'none' });
    expect(side.doc.edges).toEqual([
      { a, b: t.id },
      { a: t.id, b },
      { a: t.id, b: side.id },
    ]);
    expect(side.doc.nodes.find((n) => n.id === t.id)).toMatchObject({ x: 8, y: 0 });
  });

  it('splitting keeps the line settings on both halves', () => {
    const { doc, a, b } = corridor();
    const ramp = updateEdge(doc, a, b, { kind: 'ramp', tags: ['covered'] });
    const split = splitEdge(ramp, a, b, { x: 5, y: 0 });
    expect(split.doc.edges.every((e) => e.kind === 'ramp' && e.tags?.[0] === 'covered')).toBe(true);
  });

  it('dots on other floors are never hit', () => {
    const { doc } = corridor();
    expect(hitTest(doc, '1', { x: 0, y: 0 }, 1)).toEqual({ type: 'none' });
  });
});

describe('Door tool', () => {
  it('joins the door to the nearest point of the corridor, splitting it', () => {
    const { doc } = corridor();
    const door = placeDoor(doc, 'G', { x: 12, y: 3 });
    const node = door.doc.nodes.find((n) => n.id === door.id);
    expect(node).toMatchObject({ kind: 'door', x: 12, y: 3 });
    const junction = door.doc.nodes.find((n) => n.x === 12 && n.y === 0);
    expect(junction?.kind).toBe('junction');
    expect(door.doc.edges).toContainEqual({ a: junction?.id, b: door.id });
  });

  it('uses an existing corridor dot when the door is right next to it', () => {
    const { doc, b } = corridor();
    const door = placeDoor(doc, 'G', { x: 19.6, y: 3 });
    expect(door.doc.nodes).toHaveLength(3);
    expect(door.doc.edges).toContainEqual({ a: b, b: door.id });
  });
});

describe('rooms, lifts and deleting', () => {
  it('a room is made from a door and can get more doors', () => {
    const { doc } = corridor();
    const d1 = placeDoor(doc, 'G', { x: 4, y: 3 });
    const d2 = placeDoor(d1.doc, 'G', { x: 16, y: 3 });
    const room = createRoom(d2.doc, d1.id);
    const two = addDoorToRoom(room.doc, room.id, d2.id);
    const named = updateRoom(two, room.id, { name: 'Library', number: '12', category: 'office' });
    expect(named.rooms).toEqual([
      { id: room.id, name: 'Library', number: '12', category: 'office', doors: [d1.id, d2.id] },
    ]);
    expect(updateRoom(named, room.id, { number: null }).rooms[0]).not.toHaveProperty('number');
  });

  it('a lift gets a stop on every chosen floor, and floors can be changed later', () => {
    let doc: MapFile = { ...newProject(), levels: demoDoc().levels };
    const lift = placeConnector(doc, 'lift', { x: 10, y: 10 }, ['G', '1', '2']);
    doc = lift.doc;
    expect(doc.connectors[0]).toMatchObject({ kind: 'lift', name: 'Lift A' });
    expect(Object.keys(doc.connectors[0]?.stops ?? {}).sort()).toEqual(['1', '2', 'G']);
    expect(
      doc.nodes.every((n) => n.kind === 'lift-stop' && n.x === 10 && n.landmark === 'Lift A'),
    ).toBe(true);

    doc = setConnectorLevels(doc, lift.id, ['G', '2']); // skip Floor 1
    expect(Object.keys(doc.connectors[0]?.stops ?? {}).sort()).toEqual(['2', 'G']);
    expect(doc.nodes.filter((n) => n.lvl === '1')).toHaveLength(0);
    doc = setConnectorLevels(doc, lift.id, ['G', '1', '2']);
    expect(doc.nodes.find((n) => n.lvl === '1')).toMatchObject({ x: 10, y: 10, kind: 'lift-stop' });

    doc = renameConnector(doc, lift.id, 'Service lift');
    expect(doc.connectors[0]?.name).toBe('Service lift');
    expect(deleteConnector(doc, lift.id)).toMatchObject({ connectors: [], nodes: [] });
  });

  it('deleting a dot cleans up lines, room doors, amenities and QR stickers', () => {
    const doc = demoDoc();
    const next = deleteItems(doc, new Set(['2-N30']), []);
    expect(next.nodes.some((n) => n.id === '2-N30')).toBe(false);
    expect(next.edges.some((e) => e.a === '2-N30' || e.b === '2-N30')).toBe(false);
    expect(next.rooms.find((r) => r.id === 'radiology')?.doors).toEqual(['2-N18']);
    expect(validateMapFile(next).ok).toBe(true);

    const noToilet = deleteItems(doc, new Set(['G-E']), []);
    expect(noToilet.amenities.some((a) => a.node === 'G-E')).toBe(false);
    expect(noToilet.qr.some((q) => q.node === 'G-E')).toBe(false);
    expect(validateMapFile(noToilet).ok).toBe(true);
  });

  it('deleting a line keeps its dots', () => {
    const { doc, a, b } = corridor();
    const next = deleteItems(doc, new Set(), [[b, a]]);
    expect(next.edges).toEqual([]);
    expect(next.nodes).toHaveLength(2);
  });

  it('every drawing change is one exact undo step', () => {
    const { doc } = corridor();
    const after = placeDoor(doc, 'G', { x: 12, y: 3 }).doc;
    const command = change('Add door', doc, after);
    expect(command.apply(doc)).toEqual(after);
    expect(command.revert(after)).toEqual(doc);
  });
});

/**
 * The Phase 7 "done when": the Demo Hospital, drawn from scratch with ONLY the editor's tools
 * (in the order an admin would), gives visitors exactly the same directions as the hand-made file.
 */
describe('drawing the Demo Hospital from scratch', () => {
  function drawDemoWithTools(): { doc: MapFile; idOf: (demoId: string) => string } {
    const source = demoDoc();
    const pos = new Map(source.nodes.map((n) => [n.id, n]));
    let doc: MapFile = { ...newProject(), site: source.site, levels: source.levels };

    // 1. Lift and Stairs tools.
    for (const c of source.connectors) {
      const first = pos.get(Object.values(c.stops)[0] ?? '');
      if (!first) throw new Error('stop');
      const placed = placeConnector(doc, c.kind, first, Object.keys(c.stops));
      doc = renameConnector(placed.doc, placed.id, c.name);
    }
    const isDoor = (id: string) => pos.get(id)?.kind === 'door';
    const drawLine = (aId: string, bId: string) => {
      const a = pos.get(aId);
      const b = pos.get(bId);
      if (!a || !b) throw new Error('edge');
      const start = addPathPoint(doc, a.lvl, null, a, hitTest(doc, a.lvl, a, 0.3));
      doc = addPathPoint(start.doc, b.lvl, start.id, b, hitTest(start.doc, b.lvl, b, 0.3)).doc;
    };
    // 2. Path tool along every corridor.
    for (const e of source.edges) if (!isDoor(e.a) && !isDoor(e.b)) drawLine(e.a, e.b);
    // 3. Door tool.
    for (const n of source.nodes) if (n.kind === 'door') doc = placeDoor(doc, n.lvl, n).doc;
    // 4. Path tool for door lines the Door tool didn't make (emergency door → ambulance entrance).
    const drawnAt = (id: string) => {
      const n = pos.get(id);
      return n ? at(doc, n.lvl, n.x, n.y) : undefined;
    };
    const joined = (aId: string, bId: string) => {
      const [a, b] = [drawnAt(aId), drawnAt(bId)];
      return (
        !!a && !!b && doc.edges.some((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a))
      );
    };
    for (const e of source.edges)
      if ((isDoor(e.a) || isDoor(e.b)) && !joined(e.a, e.b)) drawLine(e.a, e.b);

    const idOf = (demoId: string) => {
      const n = pos.get(demoId);
      const id = n && at(doc, n.lvl, n.x, n.y);
      if (!id) throw new Error(`not drawn: ${demoId}`);
      return id;
    };
    // 5. Properties panel: kinds, landmarks, the ramp.
    for (const n of source.nodes)
      doc = updateNode(doc, idOf(n.id), { kind: n.kind, landmark: n.landmark ?? null });
    for (const e of source.edges)
      if (e.kind) doc = updateEdge(doc, idOf(e.a), idOf(e.b), { kind: e.kind });
    // 6. Room tool.
    for (const r of source.rooms) {
      const [first, ...more] = r.doors.map(idOf);
      if (!first) throw new Error('room');
      const room = createRoom(doc, first);
      doc = more.reduce((d, door) => addDoorToRoom(d, room.id, door), room.doc);
      doc = updateRoom(doc, room.id, {
        name: r.name,
        category: r.category,
        number: r.number ?? null,
        visibility: r.visibility ?? null,
      });
    }
    return { doc, idOf };
  }

  const drawn = drawDemoWithTools();
  const original = loadSite(demoDoc());
  const redrawn = loadSite(drawn.doc);
  const roomId = (site: typeof original, name: string) =>
    site.map.rooms.find((r) => r.name === name)?.id ?? '';

  it('produces a valid map with exactly the same dots and lines', () => {
    expect(validateMapFile(drawn.doc).ok).toBe(true);
    expect(drawn.doc.nodes).toHaveLength(demoDoc().nodes.length);
    expect(drawn.doc.edges).toHaveLength(demoDoc().edges.length);
  });

  it.each([
    ['G-ENT', 'Radiology'],
    ['G-ENT2', 'General Medicine'],
    ['2-W', 'CT scan'],
    ['G-W', "Doctors' lounge"],
    ['1-E', 'Pharmacy'],
    ['2-LOB', 'Emergency'],
  ])('%s → %s: identical directions', (from, roomName) => {
    const steps = (site: typeof original, start: string) => {
      const to: Destination = { type: 'room', roomId: roomId(site, roomName) };
      const route = findRoute(site, { from: start, to });
      if (!route.ok) throw new Error(route.error.code);
      return buildDirections(site, route.value).map((s) => `${s.icon} | ${s.text}`);
    };
    expect(steps(redrawn, drawn.idOf(from))).toEqual(steps(original, from));
  });
});
