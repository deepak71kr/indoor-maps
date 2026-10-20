import { buildDirections, checkMap, findRoute, loadSite } from '@innermap/core';
import type { MapFile } from '@innermap/schema';
import { validateMapFile } from '@innermap/schema/validate';
import { describe, expect, it } from 'vitest';
import { addNode } from './drawing';
import {
  autoConnect,
  copyFloor,
  DEFAULT_BUILDING,
  floorTag,
  generateBuilding,
  importRoomList,
  kindFromText,
  parseTable,
} from './generate';
import { newProject, nextLevel } from './project';

const clean = (doc: MapFile) => {
  const result = validateMapFile(doc);
  expect(result.ok ? result.warnings : result.issues).toEqual([]);
  expect(checkMap(doc)).toEqual([]);
};

describe('building wizard', () => {
  it('draws a whole building that passes every check and routes across floors', () => {
    const { doc, levelIds } = generateBuilding(newProject(), 'G', DEFAULT_BUILDING);
    expect(levelIds).toHaveLength(3);
    // 6 rooms each side on 3 floors, numbered per floor.
    expect(doc.rooms).toHaveLength(36);
    expect(doc.rooms.map((r) => r.number)).toContain('G01');
    expect(doc.rooms.map((r) => r.number)).toContain('212');
    expect(doc.connectors.map((c) => c.kind).sort()).toEqual(['lift', 'stairs']);
    expect(doc.qr).toHaveLength(1);
    clean(doc);
    const site = loadSite(doc);
    const room = doc.rooms.find((r) => r.number === '207');
    const route = findRoute(site, {
      from: doc.qr[0]?.node ?? '',
      to: { type: 'room', roomId: room?.id ?? '' },
    });
    if (!route.ok) throw new Error(route.error.code);
    const steps = buildDirections(site, route.value, {});
    expect(steps.some((s) => s.kind === 'ride')).toBe(true);
    expect(steps.at(-1)?.text).toMatch(/Room 207/);
  });

  it('a one-floor building has no lift or stairs, and goes beside what is drawn', () => {
    const first = generateBuilding(newProject(), 'G', { ...DEFAULT_BUILDING, floors: 1 }).doc;
    expect(first.connectors).toHaveLength(0);
    const second = generateBuilding(first, 'G', { ...DEFAULT_BUILDING, floors: 1, name: 'Annex' });
    const xs = (doc: MapFile, from: number) => doc.nodes.slice(from).map((n) => n.x);
    expect(Math.min(...xs(second.doc, first.nodes.length))).toBeGreaterThan(
      Math.max(...xs(first, 0)),
    );
    clean(second.doc);
  });
});

describe('copy a floor', () => {
  it('copies the plan, renumbers rooms and extends lifts and stairs', () => {
    const one = generateBuilding(newProject(), 'G', { ...DEFAULT_BUILDING, floors: 2 }).doc;
    const level = nextLevel(one);
    const doc = copyFloor({ ...one, levels: [...one.levels, level] }, '1', level.id);
    expect(floorTag(level)).toBe('2');
    expect(doc.rooms.filter((r) => r.number?.startsWith('2'))).toHaveLength(12);
    expect(doc.rooms.find((r) => r.number === '203')?.name).toBe('Room 203');
    expect(doc.connectors.every((c) => c.stops[level.id])).toBe(true);
    expect(doc.levels.find((l) => l.id === level.id)?.shapes?.length).toBe(
      doc.levels.find((l) => l.id === '1')?.shapes?.length,
    );
    clean(doc);
  });

  it('turns the ground floor entrance into a plain corridor dot', () => {
    const ground = generateBuilding(newProject(), 'G', { ...DEFAULT_BUILDING, floors: 1 }).doc;
    const level = nextLevel(ground);
    const doc = copyFloor({ ...ground, levels: [...ground.levels, level] }, 'G', level.id);
    expect(doc.nodes.filter((n) => n.lvl === level.id && n.kind === 'entrance')).toHaveLength(0);
  });
});

describe('room list from a spreadsheet', () => {
  it('reads CSV with quotes and tab-separated text', () => {
    expect(parseTable('G01,"Exam section, main",Admin\n')).toEqual([
      ['G01', 'Exam section, main', 'Admin'],
    ]);
    expect(parseTable('G01\tLibrary\tlibrary')).toEqual([['G01', 'Library', 'library']]);
  });

  it('understands everyday words for kinds of room', () => {
    expect(kindFromText('Laboratory')).toBe('lab');
    expect(kindFromText('Lecture hall')).toBe('classroom');
    expect(kindFromText('Accounts')).toBe('billing');
    expect(kindFromText('HOD')).toBe('office');
    expect(kindFromText('lab')).toBe('lab');
  });

  it('names rooms by number, with or without a header row', () => {
    const doc = generateBuilding(newProject(), 'G', DEFAULT_BUILDING).doc;
    const withHeader = importRoomList(
      doc,
      'Room No,Name,Type,Popular\nG01,Admission office,Admin,yes\nG-02,Physics lab,Laboratory,\nZ99,Nowhere,,',
    );
    expect(withHeader.updated).toBe(2);
    expect(withHeader.notFound).toEqual(['Z99']);
    const g01 = withHeader.doc.rooms.find((r) => r.number === 'G01');
    expect(g01).toMatchObject({ name: 'Admission office', category: 'admin', popular: true });
    expect(withHeader.doc.rooms.find((r) => r.number === 'G02')?.category).toBe('lab');
    // The door is renamed with its room, so directions say the new name.
    expect(withHeader.doc.nodes.find((n) => n.id === g01?.doors[0])?.landmark).toBe(
      'Admission office',
    );
    const plain = importRoomList(doc, '101\tDean office\toffice');
    expect(plain.doc.rooms.find((r) => r.number === '101')?.name).toBe('Dean office');
    clean(withHeader.doc);
  });
});

describe('auto-connect', () => {
  it('joins lone doors to the corridor and names the new turning spots', () => {
    const doc = generateBuilding(newProject(), 'G', { ...DEFAULT_BUILDING, floors: 1 }).doc;
    const corridor = doc.nodes.filter((n) => n.lvl === 'G' && n.kind === 'junction');
    const y = corridor[0]?.y ?? 0;
    // A new door off the corridor, not joined to anything, and a room on it.
    const added = addNode(doc, 'G', { x: 22, y: y + 6 }, 'door'); // between two corridor dots
    const withDoor: MapFile = {
      ...added.doc,
      nodes: added.doc.nodes.map((n) => (n.id === added.id ? { ...n, landmark: 'Store' } : n)),
      rooms: [
        ...added.doc.rooms,
        { id: 'store', name: 'Store', category: 'utility', doors: [added.id] },
      ],
    };
    const result = autoConnect(withDoor, 'G');
    expect(result.connected).toBe(1);
    expect(result.named).toBeGreaterThanOrEqual(1);
    clean(result.doc);
    // Nothing left to do the second time.
    expect(autoConnect(result.doc, 'G').connected).toBe(0);
  });
});
