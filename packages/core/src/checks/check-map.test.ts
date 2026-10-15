import { describe, expect, it } from 'vitest';
import { demoMap } from '../test-support';
import { checkMap } from './check-map';

describe('checkMap', () => {
  it('the Demo Hospital is clean', () => {
    expect(checkMap(demoMap())).toEqual([]);
  });

  it('finds places nobody can reach', () => {
    const map = demoMap();
    map.nodes.push({ id: 'G-ISLAND', lvl: 'G', x: 70, y: 70, kind: 'door', landmark: 'Store' });
    expect(checkMap(map)).toContainEqual(
      expect.objectContaining({
        code: 'unreachable',
        severity: 'error',
        target: { node: 'G-ISLAND' },
      }),
    );
  });

  it('respects one-way lines when checking reachability', () => {
    const map = demoMap();
    // Make the only way to the Blood bank door one-way OUT of it.
    const edge = map.edges.find((e) => e.a === 'G-C42' && e.b === 'G-S42');
    if (edge) Object.assign(edge, { a: 'G-S42', b: 'G-C42', oneWay: true });
    expect(checkMap(map).map((i) => i.code)).toContain('unreachable');
  });

  it('warns about turns and junctions with no landmark, and unnamed doors', () => {
    const map = demoMap();
    for (const n of map.nodes) {
      if (n.id === 'G-C18' || n.id === 'G-N42') delete n.landmark;
    }
    const issues = checkMap(map);
    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'unnamed-decision-point', target: { node: 'G-C18' } }),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'unnamed-door', target: { node: 'G-N42' } }),
    );
  });

  it('does not ask for a name on a dot in the middle of a straight corridor', () => {
    const map = demoMap();
    map.nodes.push({ id: 'G-MID', lvl: 'G', x: 36, y: 15, kind: 'junction' });
    const edge = map.edges.find((e) => e.a === 'G-C30' && e.b === 'G-C42');
    if (edge) edge.b = 'G-MID';
    map.edges.push({ a: 'G-MID', b: 'G-C42' });
    expect(checkMap(map)).toEqual([]);
  });

  it('warns about stretches longer than 30 m', () => {
    const map = demoMap();
    map.nodes.push({ id: 'G-FAR', lvl: 'G', x: 55, y: 60, kind: 'junction', landmark: 'Garden' });
    map.edges.push({ a: 'G-ST', b: 'G-FAR' });
    expect(checkMap(map)).toContainEqual(
      expect.objectContaining({ code: 'long-line', target: { edge: ['G-ST', 'G-FAR'] } }),
    );
  });

  it('finds lift stops not joined to a corridor', () => {
    const map = demoMap();
    map.edges = map.edges.filter((e) => !(e.a === '1-LOB' && e.b === '1-LA'));
    expect(checkMap(map)).toContainEqual(
      expect.objectContaining({
        code: 'stop-not-connected',
        target: { node: '1-LA' },
        severity: 'error',
      }),
    );
  });

  it('asks for an entrance on a map without one', () => {
    const map = demoMap();
    for (const n of map.nodes) if (n.kind === 'entrance') n.kind = 'junction';
    expect(checkMap(map).map((i) => i.code)).toContain('no-entrance');
  });

  it('lists errors before warnings', () => {
    const map = demoMap();
    map.nodes.push({ id: 'G-ISLAND', lvl: 'G', x: 70, y: 70, kind: 'door' });
    const severities = checkMap(map).map((i) => i.severity);
    expect(severities).toEqual(
      [...severities].sort((a, b) => Number(a === 'warning') - Number(b === 'warning')),
    );
  });
});
