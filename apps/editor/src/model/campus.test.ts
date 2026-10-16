import { validateMapFile } from '@innermap/schema/validate';
import { describe, expect, it } from 'vitest';
import campus from '../../../../samples/demo-campus/map.json';
import { parseDraft } from '../infra/autosave';
import {
  addBuilding,
  deleteBuilding,
  levelLabel,
  renameBuilding,
  setLevelBuilding,
} from './campus';
import { addShape, updateShape } from './plan';
import { newProject, nextLevel, sortedLevels } from './project';

const demo = () => {
  const doc = parseDraft(campus);
  if (!doc) throw new Error('campus sample did not load');
  return doc;
};
const valid = (doc: unknown) => validateMapFile(doc).ok;

describe('campus editing (Phase 10)', () => {
  it('adds buildings with unique ids and renames them', () => {
    const one = addBuilding(newProject(), 'Block A');
    const two = addBuilding(one.doc, 'Block A');
    expect([one.id, two.id]).toEqual(['block-a', 'block-a-2']);
    const renamed = renameBuilding(two.doc, 'block-a-2', 'Block B');
    expect(renamed.buildings?.map((b) => b.name)).toEqual(['Block A', 'Block B']);
  });

  it('a new floor goes on top of its own building', () => {
    const doc = demo();
    const level = nextLevel(doc, 'lib');
    expect(level).toMatchObject({ ord: 2, building: 'lib', name: 'Floor 2' });
    expect(valid({ ...doc, levels: [...doc.levels, level] })).toBe(true);
    expect(nextLevel(doc)).toMatchObject({ ord: 3 }); // a shared level clears every building
  });

  it('moving a floor into another building bumps its order if that one is taken', () => {
    const moved = setLevelBuilding(demo(), 'L1', 'a');
    expect(moved.levels.find((l) => l.id === 'L1')).toMatchObject({ building: 'a', ord: 3 });
    expect(valid(moved)).toBe(true);
    const shared = setLevelBuilding(demo(), 'L1', null);
    expect(shared.levels.find((l) => l.id === 'L1')?.building).toBeUndefined();
    expect(valid(shared)).toBe(true);
  });

  it('lists floors by building and labels them with it', () => {
    const doc = demo();
    expect(sortedLevels(doc).map((l) => levelLabel(doc, l))).toEqual([
      'Ground',
      'Block A · Floor 1',
      'Block A · Floor 2',
      'Library · Floor 1',
    ]);
  });

  it('deletes only a building without floors, unlinking its footprint', () => {
    const doc = demo();
    expect(deleteBuilding(doc, 'a')).toBe(doc); // Block A still has floors
    const gone = deleteBuilding(doc, 'admin');
    expect(gone.buildings?.map((b) => b.id)).toEqual(['a', 'lib']);
    expect(gone.levels[0]?.shapes?.some((s) => s.building === 'admin')).toBe(false);
    expect(valid(gone)).toBe(true);
  });

  it('draws ground under buildings and buildings under rooms, and links footprints', () => {
    let doc = addBuilding(newProject(), 'Hostel').doc;
    doc = addShape(doc, 'G', 'room', [2, 2, 4, 2, 4, 4]).doc;
    const footprint = addShape(doc, 'G', 'building', [0, 0, 10, 0, 10, 10, 0, 10]);
    expect(footprint.index).toBe(0);
    const road = addShape(footprint.doc, 'G', 'road', [0, 12, 10, 12, 10, 14]);
    expect(road.index).toBe(0);
    const kinds = road.doc.levels[0]?.shapes?.map((s) => s.kind);
    expect(kinds).toEqual(['road', 'building', 'room']);
    expect(road.doc.levels[0]?.shapes?.[1]?.building).toBe('hostel');
    // Turning the footprint into a plain room drops the building link.
    const room = updateShape(road.doc, 'G', 1, { kind: 'room' });
    expect(room.levels[0]?.shapes?.[1]?.building).toBeUndefined();
  });
});
