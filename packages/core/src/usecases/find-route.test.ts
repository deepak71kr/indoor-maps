import { describe, expect, it } from 'vitest';
import { avoidTagsRule, edgeKey, penalizeTagsRule, stepFreeRule } from '../routing/cost';
import type { Site } from '../site/site';
import { loadSite } from '../site/site';
import { demoMap } from '../test-support';
import type { Destination, Route, RouteRequest } from './find-route';
import { findRoute } from './find-route';

const site = loadSite(demoMap());

function route(request: RouteRequest, on: Site = site): Route {
  const result = findRoute(on, request);
  if (!result.ok) throw new Error(`expected a route, got ${result.error.code}`);
  return result.value;
}
const ids = (r: Route) => r.nodes.map((n) => n.id);
const room = (roomId: string): Destination => ({ type: 'room', roomId });

describe('golden routes on the Demo Hospital', () => {
  it('same floor: Main Entrance → Pharmacy', () => {
    const r = route({ from: 'G-ENT', to: room('pharmacy') });
    expect(ids(r)).toEqual(['G-ENT', 'G-LOB', 'G-C30', 'G-N30']);
    expect(r.walkingMeters).toBe(16);
    expect(r.cost).toBeCloseTo(17.2); // 6 m of ramp costs ×1.2
    expect(r.floorChanges).toBe(0);
  });

  it('other floor: Main Entrance → Radiology takes Lift A to the CLOSER door', () => {
    const r = route({ from: 'G-ENT', to: room('radiology') });
    expect(ids(r)).toEqual(['G-ENT', 'G-LOB', 'G-LA', '2-LA', '2-LOB', '2-C30', '2-N30']);
    expect(r.arrival).toMatchObject({ nodeId: '2-N30', room: { id: 'radiology' } });
    expect(r.floorChanges).toBe(1);
  });

  it('uses the lift that skips a floor when it is the better way', () => {
    const r = route({ from: 'G-W', to: room('doctors-lounge') });
    expect(ids(r)).toEqual(['G-W', 'G-LB', '2-LB', '2-W', '2-SW']);
  });

  it('never boards a lift on a floor where it does not stop', () => {
    const r = route({ from: '1-W', to: { type: 'node', nodeId: '2-W' } });
    expect(ids(r)).not.toContain('1-LB');
    expect(r.edges.find((e) => e.kind === 'lift')?.connector).toBe('lift-a');
  });

  it('takes the stairs for one short floor change', () => {
    const r = route({ from: '1-E', to: { type: 'node', nodeId: '2-E' } });
    expect(ids(r)).toEqual(['1-E', '1-ST', '2-ST', '2-E']);
  });

  it('starting at the destination is a zero-length route', () => {
    const r = route({ from: 'G-N30', to: room('pharmacy') });
    expect(ids(r)).toEqual(['G-N30']);
    expect(r.cost).toBe(0);
  });
});

describe('step-free routes', () => {
  it('avoids stairs even when they are shorter', () => {
    const r = route({
      from: '1-E',
      to: { type: 'node', nodeId: '2-E' },
      profile: { stepFree: true },
    });
    expect(r.edges.some((e) => e.kind === 'stairs')).toBe(false);
    expect(r.edges.some((e) => e.kind === 'lift')).toBe(true);
  });

  it('avoids same-floor edges tagged "steps"', () => {
    const map = demoMap();
    map.edges.push({ a: 'G-C18', b: 'G-LOB', tags: ['steps'] }); // a shortcut with 3 steps
    const s = loadSite(map);
    const normal = route({ from: 'G-C18', to: { type: 'node', nodeId: 'G-LOB' } }, s);
    const stepFree = route(
      { from: 'G-C18', to: { type: 'node', nodeId: 'G-LOB' }, profile: { stepFree: true } },
      s,
    );
    expect(ids(normal)).toEqual(['G-C18', 'G-LOB']);
    expect(ids(stepFree)).toEqual(['G-C18', 'G-C30', 'G-LOB']);
  });
});

describe('nearest amenity', () => {
  it('finds the nearest toilet by walking, across floors', () => {
    const r = route({ from: '2-C30', to: { type: 'amenity', kinds: ['toilet'] } });
    expect(r.arrival.nodeId).toBe('1-E');
    expect(r.arrival.amenity?.id).toBe('1-toilet');
  });

  it('includes accessible toilets when asked', () => {
    const r = route({
      from: '2-C30',
      to: { type: 'amenity', kinds: ['toilet', 'toilet-accessible'] },
    });
    expect(r.arrival.nodeId).toBe('2-W');
  });

  it('picks the nearest by WALKING, not by straight line', () => {
    const map = demoMap();
    // A toilet directly above G-C30: 0 m away as the crow flies, but a lift ride on foot.
    map.amenities.push({ id: '1-toilet-above', kind: 'toilet', node: '1-C30' });
    const r = route({ from: 'G-C30', to: { type: 'amenity', kinds: ['toilet'] } }, loadSite(map));
    expect(r.arrival.amenity?.id).toBe('g-toilet');
    expect(ids(r)).toEqual(['G-C30', 'G-C42', 'G-E']);
  });

  it('a step-free visitor gets a toilet reachable without stairs', () => {
    const r = route({
      from: '2-E',
      to: { type: 'amenity', kinds: ['toilet'] },
      profile: { stepFree: true },
    });
    expect(r.edges.some((e) => e.kind === 'stairs')).toBe(false);
  });
});

describe('industry rules', () => {
  it('avoid-tags forbids hazard edges', () => {
    const map = demoMap();
    const edge = map.edges.find((e) => e.a === 'G-C30' && e.b === 'G-C42');
    if (edge) edge.tags = ['hazard'];
    const s = loadSite(map, { rules: [stepFreeRule, avoidTagsRule(['hazard'])] });
    // The only way to X-Ray on the ground floor is through the hazard → detour via another floor.
    const r = route({ from: 'G-C30', to: room('xray') }, s);
    expect(r.edges.some((e) => e.tags.includes('hazard'))).toBe(false);
    expect(r.floorChanges).toBeGreaterThan(0);
    expect(r.arrival.nodeId).toBe('G-N42');
  });

  it('penalize-tags makes a path less attractive without forbidding it', () => {
    const map = demoMap();
    const edge = map.edges.find((e) => e.a === 'G-C30' && e.b === 'G-C42');
    if (edge) edge.tags = ['ppe-required'];
    const s = loadSite(map, { rules: [penalizeTagsRule(['ppe-required'], 3)] });
    const r = route({ from: 'G-C30', to: { type: 'node', nodeId: 'G-C42' } }, s);
    expect(ids(r)).toEqual(['G-C30', 'G-C42']);
    expect(r.cost).toBe(36);
  });
});

describe('errors', () => {
  it('unknown start', () => {
    expect(findRoute(site, { from: 'NOPE', to: room('pharmacy') })).toEqual({
      ok: false,
      error: { code: 'unknown-start', from: 'NOPE' },
    });
  });

  it('unknown destination', () => {
    const result = findRoute(site, { from: 'G-ENT', to: room('cafeteria') });
    expect(result).toEqual({ ok: false, error: { code: 'unknown-destination' } });
  });

  it('no route to an unconnected place', () => {
    const map = demoMap();
    map.nodes.push({ id: 'G-ISLAND', lvl: 'G', x: 70, y: 70, kind: 'door' });
    const result = findRoute(loadSite(map), {
      from: 'G-ENT',
      to: { type: 'node', nodeId: 'G-ISLAND' },
    });
    expect(result).toEqual({ ok: false, error: { code: 'no-route' } });
  });
});

describe('site lookups', () => {
  it('resolves QR codes case-insensitively', () => {
    expect(site.nodeForQr('g-main')).toBe('G-ENT');
    expect(site.nodeForQr('NOPE')).toBeUndefined();
  });

  it('finds rooms by id, number or name', () => {
    expect(site.findRoom('radiology')?.id).toBe('radiology');
    expect(site.findRoom('201')?.id).toBe('radiology');
    expect(site.findRoom('  Pathology Lab ')?.id).toBe('pathology');
  });
});

describe('performance', () => {
  it('answers 1,000 random routes in well under a second', () => {
    const nodeIds = [...site.graph.nodes.keys()];
    let seed = 42;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const pick = () => nodeIds[Math.floor(random() * nodeIds.length)] as string;

    const started = Date.now();
    for (let i = 0; i < 1000; i++) {
      const result = findRoute(site, { from: pick(), to: { type: 'node', nodeId: pick() } });
      expect(result.ok).toBe(true);
    }
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('fastest, shortest, closed and blocked lines', () => {
  const ride = (r: Route) => r.edges.find((e) => e.kind === 'lift' || e.kind === 'stairs')?.kind;

  it('a corridor closed for works (tag "closed") is never used', () => {
    const map = demoMap();
    for (const e of map.edges) if ([e.a, e.b].includes('G-C30')) e.tags = ['closed'];
    const r = route({ from: 'G-C18', to: { type: 'node', nodeId: 'G-C42' } }, loadSite(map));
    expect(ids(r)).not.toContain('G-C30');
  });

  it('a line the visitor reports blocked is avoided on the new route', () => {
    const open = route({ from: 'G-ENT', to: room('pharmacy') });
    expect(ids(open)).toContain('G-C30');
    const detour = findRoute(site, {
      from: 'G-ENT',
      to: room('pharmacy'),
      profile: { blocked: [edgeKey('G-LOB', 'G-C30')] },
    });
    if (!detour.ok) throw new Error(detour.error.code);
    const path = detour.value.nodes.map((n) => n.id);
    expect(path.slice(0, 2)).toEqual(['G-ENT', 'G-LOB']);
    expect(path[2]).not.toBe('G-C30');
  });

  it('shortest counts meters; fastest counts the lift wait and slow stairs', () => {
    const fastest = route({ from: 'G-E', to: { type: 'node', nodeId: '1-E' } });
    const shortest = route({
      from: 'G-E',
      to: { type: 'node', nodeId: '1-E' },
      profile: { preference: 'shortest' },
    });
    expect(ride(shortest)).toBe('stairs'); // the stairs are right there
    expect(shortest.walkingMeters).toBeLessThanOrEqual(fastest.walkingMeters);
  });
});
