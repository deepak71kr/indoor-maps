import type { MapFile } from '@innermap/schema';
import { validateMapFile } from '@innermap/schema/validate';
import { describe, expect, it } from 'vitest';
import big from '../../../../samples/demo-mesra/map.json';
import { checkMap } from '../checks/check-map';
import { buildDirections } from '../directions/build-directions';
import { findRoute } from '../usecases/find-route';
import { loadSite } from './site';

const map = big as MapFile;
const site = loadSite(map);
const room = (name: string) => {
  const r = map.rooms.find((x) => x.name === name);
  if (!r) throw new Error(`no room ${name}`);
  return { type: 'room' as const, roomId: r.id };
};

describe('big demo campus (samples/demo-mesra, stress test)', () => {
  it('is big, valid and has nothing for the editor to complain about', () => {
    expect(map.buildings?.length).toBeGreaterThanOrEqual(30);
    expect(map.rooms.length).toBeGreaterThan(500);
    const result = validateMapFile(map);
    expect(result.ok ? result.warnings : result.issues).toEqual([]);
    expect(checkMap(map)).toEqual([]);
  });

  it('every room can be reached from the main gate', () => {
    const gate = site.nodeForQr('MAIN-GATE') ?? '';
    const missing = map.rooms.filter(
      (r) => !findRoute(site, { from: gate, to: { type: 'room', roomId: r.id } }).ok,
    );
    expect(missing.map((r) => r.name)).toEqual([]);
  });

  it('gate → a lab on a department floor: few, clear steps outdoors', () => {
    const gate = site.nodeForQr('MAIN-GATE') ?? '';
    const result = findRoute(site, { from: gate, to: room('Digital library') });
    if (!result.ok) throw new Error(result.error.code);
    const steps = buildDirections(site, result.value, { startFacing: 0 });
    expect(steps.length).toBeLessThan(14);
    expect(steps.some((s) => s.kind === 'ride')).toBe(true);
    expect(steps.at(-1)?.text).toMatch(/^Digital library is/);
  });
});
