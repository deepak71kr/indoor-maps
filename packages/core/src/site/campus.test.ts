import { validateMapFile } from '@innermap/schema/validate';
import { describe, expect, it } from 'vitest';
import { checkMap } from '../checks/check-map';
import { buildDirections } from '../directions/build-directions';
import { campusMap } from '../test-support';
import { findRoute } from '../usecases/find-route';
import { loadSite } from './site';

const site = loadSite(campusMap());

describe('Demo College campus (Phase 10)', () => {
  it('is a valid map with nothing for the editor to complain about', () => {
    const result = validateMapFile(campusMap());
    expect(result.ok ? result.warnings : result.issues).toEqual([]);
    expect(checkMap(campusMap())).toEqual([]);
  });

  it('gate → a room on Block A Floor 2: road, entrance, lift', () => {
    const result = findRoute(site, { from: 'G-GATE', to: { type: 'room', roomId: 'complab' } });
    if (!result.ok) throw new Error(result.error.code);
    const ids = result.value.nodes.map((n) => n.id);
    expect(ids.slice(0, 5)).toEqual(['G-GATE', 'G-ROAD', 'G-J1', 'G-A-ENT', 'G-A-LOB']);
    expect(ids).toContain('A2-LIFT');
    expect(ids.at(-1)).toBe('A2-CLAB');
    const steps = buildDirections(site, result.value, { startFacing: 0 });
    expect(steps.find((s) => s.kind === 'ride')?.text).toBe('Take Block A lift up to Floor 2.');
  });

  it('counts floors per building: the Library having a Floor 1 does not slow Block A', () => {
    const ride = site.graph.outgoing('G-A-LIFT').find((e) => e.to === 'A2-LIFT');
    expect(ride?.floors).toBe(2);
    const climb = site.graph.outgoing('G-LIB-ST').find((e) => e.to === 'L1-ST');
    expect(climb?.floors).toBe(1);
  });

  it('knows which building a dot is in', () => {
    expect(site.buildingAt('G-A-LOB')?.name).toBe('Block A'); // inside the footprint
    expect(site.buildingAt('A2-CLAB')?.name).toBe('Block A'); // on one of its floors
    expect(site.buildingAt('L1-DIG')?.name).toBe('Library');
    expect(site.buildingAt('G-J1')).toBeUndefined(); // outdoors
  });

  it('step-free: the Library upstairs has only stairs, so there is no route', () => {
    const result = findRoute(site, {
      from: 'G-GATE',
      to: { type: 'room', roomId: 'digital' },
      profile: { stepFree: true },
    });
    expect(result.ok).toBe(false);
  });
});
