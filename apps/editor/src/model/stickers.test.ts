import type { MapFile } from '@innermap/schema';
import { validateMapFile } from '@innermap/schema/validate';
import { describe, expect, it } from 'vitest';
import demo from '../../../../samples/demo-hospital/map.json';
import {
  deleteAmenity,
  deleteQr,
  nextQrCode,
  placeAmenity,
  placeQr,
  QR_CODE_PATTERN,
  snapAngle,
  updateAmenity,
  updateQr,
} from './drawing';

const demoDoc = (): MapFile => JSON.parse(JSON.stringify(demo)) as MapFile;

describe('amenities', () => {
  it('a dropped amenity attaches to the nearest dot on that floor', () => {
    const placed = placeAmenity(demoDoc(), '2', { x: 29, y: 13 }, 'water');
    expect(placed?.doc.amenities.at(-1)).toEqual({ id: placed?.id, kind: 'water', node: '2-N30' });
    expect(validateMapFile(placed?.doc).ok).toBe(true);
  });

  it('is refused when no dot is within 10 m', () => {
    expect(placeAmenity(demoDoc(), 'G', { x: 200, y: 200 }, 'atm')).toBeNull();
  });

  it('can be renamed, re-kinded and deleted', () => {
    const doc = demoDoc();
    const renamed = updateAmenity(doc, 'g-atm', { name: 'SBI ATM', kind: 'atm' });
    expect(renamed.amenities.find((a) => a.id === 'g-atm')).toMatchObject({ name: 'SBI ATM' });
    expect(
      updateAmenity(renamed, 'g-atm', { name: null }).amenities.find((a) => a.id === 'g-atm'),
    ).not.toHaveProperty('name');
    expect(deleteAmenity(doc, 'g-atm').amenities.some((a) => a.id === 'g-atm')).toBe(false);
  });
});

describe('QR stickers', () => {
  it('codes follow the floor and never repeat', () => {
    const doc = demoDoc();
    const first = nextQrCode(doc, '2');
    expect(first).toMatch(QR_CODE_PATTERN);
    const placed = placeQr(doc, '2-C42', 90);
    expect(placed.code).toBe(first);
    expect(nextQrCode(placed.doc, '2')).not.toBe(first);
  });

  it('placing on a dot that already has a sticker just turns it', () => {
    const doc = demoDoc();
    const turned = placeQr(doc, 'G-ENT', 180);
    expect(turned.code).toBe('G-MAIN');
    expect(turned.doc.qr).toHaveLength(doc.qr.length);
    expect(turned.doc.qr.find((q) => q.code === 'G-MAIN')?.facing).toBe(180);
  });

  it('facing stays within 0..359 and snaps for dragging', () => {
    expect(snapAngle(-90)).toBe(270);
    expect(snapAngle(359)).toBe(0);
    expect(snapAngle(97)).toBe(90);
    expect(snapAngle(97, 1)).toBe(97);
    const doc = updateQr(demoDoc(), 'G-MAIN', { facing: 361 });
    expect(doc.qr.find((q) => q.code === 'G-MAIN')?.facing).toBe(1);
  });

  it('codes can be renamed; the result stays a valid map', () => {
    const doc = updateQr(demoDoc(), 'G-MAIN', { code: 'ENTRY' });
    expect(doc.qr.some((q) => q.code === 'ENTRY')).toBe(true);
    expect(validateMapFile(doc).ok).toBe(true);
    expect(deleteQr(doc, 'ENTRY').qr.some((q) => q.code === 'ENTRY')).toBe(false);
  });
});
