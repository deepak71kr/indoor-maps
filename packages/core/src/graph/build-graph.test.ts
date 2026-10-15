import { describe, expect, it } from 'vitest';
import { demoMap } from '../test-support';
import { buildGraph } from './build-graph';

const graph = buildGraph(demoMap());
const edgesFrom = (id: string) => graph.outgoing(id);

describe('buildGraph', () => {
  it('sorts levels by order and ranks them', () => {
    expect(graph.levels.map((l) => [l.id, l.rank])).toEqual([
      ['G', 0],
      ['1', 1],
      ['2', 2],
    ]);
  });

  it('computes edge length from positions, in both directions', () => {
    const there = edgesFrom('G-W').find((e) => e.to === 'G-C18');
    const back = edgesFrom('G-C18').find((e) => e.to === 'G-W');
    expect(there?.length).toBe(13);
    expect(back?.length).toBe(13);
  });

  it('keeps the edge kind (ramp at the main entrance)', () => {
    expect(edgesFrom('G-LOB').find((e) => e.to === 'G-ENT')?.kind).toBe('ramp');
  });

  it('joins every pair of lift stops, counting floors travelled', () => {
    const liftA = edgesFrom('G-LA').filter((e) => e.kind === 'lift');
    expect(liftA.map((e) => [e.to, e.floors])).toEqual([
      ['1-LA', 1],
      ['2-LA', 2],
    ]);
  });

  it('counts skipped floors on a lift that skips a level', () => {
    const liftB = edgesFrom('G-LB').filter((e) => e.kind === 'lift');
    expect(liftB).toEqual([
      expect.objectContaining({ to: '2-LB', floors: 2, connector: 'lift-b' }),
    ]);
  });

  it('joins stairs only between neighbouring floors', () => {
    const fromGround = edgesFrom('G-ST').filter((e) => e.kind === 'stairs');
    expect(fromGround.map((e) => e.to)).toEqual(['1-ST']);
    const fromFirst = edgesFrom('1-ST').filter((e) => e.kind === 'stairs');
    expect(fromFirst.map((e) => e.to).sort()).toEqual(['2-ST', 'G-ST']);
  });

  it('respects one-way edges', () => {
    const map = demoMap();
    map.edges.push({ a: 'G-E', b: 'G-S42', oneWay: true });
    const g = buildGraph(map);
    expect(g.outgoing('G-E').some((e) => e.to === 'G-S42')).toBe(true);
    expect(g.outgoing('G-S42').some((e) => e.to === 'G-E')).toBe(false);
  });
});
