import { describe, expect, it } from 'vitest';
import demo from '../../../samples/demo-hospital/demo.json';
import type { MapFile } from './format-v0';
import type { Issue } from './validate';
import { formatIssues, validateMapFile } from './validate';

/** A fresh, mutable copy of the demo map for each test. */
function demoMap(): MapFile {
  return JSON.parse(JSON.stringify(demo)) as MapFile;
}

function issuesOf(input: unknown): Issue[] {
  const result = validateMapFile(input);
  return result.ok ? result.warnings : result.issues;
}

describe('demo hospital sample', () => {
  it('is valid with no warnings', () => {
    const result = validateMapFile(demo);
    expect(result.ok ? result.warnings : result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('has the shape the docs promise', () => {
    const map = demoMap();
    expect(map.levels.map((l) => l.id)).toEqual(['G', '1', '2']);
    expect(map.rooms.length).toBeGreaterThanOrEqual(15);
    expect(map.qr.length).toBeGreaterThanOrEqual(8);
    const liftB = map.connectors.find((c) => c.id === 'lift-b');
    expect(Object.keys(liftB?.stops ?? {}).sort()).toEqual(['2', 'G']); // skips Floor 1
    expect(map.rooms.some((r) => r.doors.length > 1)).toBe(true);
  });
});

describe('shape errors', () => {
  it('rejects a different format version', () => {
    const map = { ...demoMap(), fmt: 1 };
    expect(issuesOf(map)).toMatchObject([{ code: 'invalid-shape', path: 'fmt' }]);
  });

  it('rejects unknown properties (typos)', () => {
    const map = demoMap();
    Object.assign(map.nodes[0] as object, { landmrk: 'oops' });
    expect(issuesOf(map)).toMatchObject([{ code: 'invalid-shape', path: 'nodes[0]' }]);
  });

  it('rejects a bad enum value with its path', () => {
    const map = demoMap();
    (map.levels[1] as { color: string }).color = 'pink';
    expect(issuesOf(map)).toMatchObject([{ code: 'invalid-shape', path: 'levels[1].color' }]);
  });

  it('rejects QR facing outside 0–359', () => {
    const map = demoMap();
    (map.qr[0] as { facing: number }).facing = 360;
    expect(issuesOf(map)).toMatchObject([{ code: 'invalid-shape', path: 'qr[0].facing' }]);
  });
});

describe('reference errors', () => {
  it('flags a node on an unknown level', () => {
    const map = demoMap();
    (map.nodes[0] as { lvl: string }).lvl = 'B1';
    expect(issuesOf(map)).toContainEqual(
      expect.objectContaining({ code: 'unknown-level', path: 'nodes[0].lvl' }),
    );
  });

  it('flags an edge to a missing node', () => {
    const map = demoMap();
    map.edges.push({ a: 'G-W', b: 'G-NOPE' });
    const index = map.edges.length - 1;
    expect(issuesOf(map)).toEqual([
      expect.objectContaining({ code: 'unknown-node', path: `edges[${index}].b` }),
    ]);
  });

  it('flags an edge between floors', () => {
    const map = demoMap();
    map.edges.push({ a: 'G-W', b: '1-W' });
    expect(issuesOf(map)).toContainEqual(expect.objectContaining({ code: 'cross-level-edge' }));
  });

  it('flags self-loops and duplicate edges (either direction)', () => {
    const map = demoMap();
    map.edges.push({ a: 'G-W', b: 'G-W' }, { a: 'G-C18', b: 'G-W' });
    const codes = issuesOf(map).map((i) => i.code);
    expect(codes).toEqual(['self-loop', 'duplicate-edge']);
  });

  it('flags duplicate node ids and QR codes', () => {
    const map = demoMap();
    map.nodes.push({ ...(map.nodes[0] as MapFile['nodes'][number]) });
    map.qr.push({ code: 'G-MAIN', node: 'G-W', facing: 0 });
    const codes = issuesOf(map).map((i) => i.code);
    expect(codes).toContain('duplicate-id');
    expect(codes).toContain('duplicate-qr-code');
  });

  it('flags duplicate floor order', () => {
    const map = demoMap();
    (map.levels[2] as { ord: number }).ord = 1;
    expect(issuesOf(map)).toContainEqual(
      expect.objectContaining({ code: 'duplicate-level-order', path: 'levels[2].ord' }),
    );
  });

  it('flags a lift with a single stop', () => {
    const map = demoMap();
    map.connectors.push({ id: 'lift-c', kind: 'lift', name: 'Lift C', stops: { G: 'G-W' } });
    expect(issuesOf(map)).toContainEqual(
      expect.objectContaining({ code: 'connector-too-few-stops' }),
    );
  });

  it('flags a connector stop placed on the wrong floor', () => {
    const map = demoMap();
    const liftA = map.connectors[0] as MapFile['connectors'][number];
    liftA.stops['1'] = '2-LA';
    const codes = issuesOf(map).map((i) => i.code);
    expect(codes).toContain('connector-stop-wrong-level');
    expect(codes).toContain('node-in-many-connectors'); // 2-LA was already Lift A's Floor 2 stop
  });

  it('flags a room door that does not exist', () => {
    const map = demoMap();
    (map.rooms[0] as MapFile['rooms'][number]).doors = ['G-GONE'];
    expect(issuesOf(map)).toContainEqual(
      expect.objectContaining({ code: 'unknown-node', path: 'rooms[0].doors[0]' }),
    );
  });
});

describe('warnings do not block', () => {
  it('accepts a stop with the wrong kind but warns', () => {
    const map = demoMap();
    const node = map.nodes.find((n) => n.id === 'G-LA') as MapFile['nodes'][number];
    node.kind = 'junction';
    const result = validateMapFile(map);
    expect(result.ok).toBe(true);
    expect(result.ok && result.warnings.map((w) => w.code)).toEqual(['connector-stop-kind']);
  });

  it('warns about a floor plan with no scale', () => {
    const map = demoMap();
    (map.levels[0] as MapFile['levels'][number]).image = 'plans/ground.png';
    const result = validateMapFile(map);
    expect(result.ok && result.warnings.map((w) => w.code)).toEqual(['image-without-scale']);
  });
});

describe('formatIssues', () => {
  it('prints one readable line per issue', () => {
    const map = demoMap();
    map.edges.push({ a: 'G-W', b: 'G-NOPE' });
    (map.levels[0] as MapFile['levels'][number]).image = 'plans/ground.png';
    const result = validateMapFile(map);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(formatIssues(result.issues)).toMatchInlineSnapshot(`
      "⚠ levels[0] — level "G" has a floor plan but no scale (pxPerMeter) (image-without-scale)
      ✖ edges[43].b — unknown node "G-NOPE" (unknown-node)"
    `);
  });
});
