import { describe, expect, it } from 'vitest';
import { compassHeading, northOffset, smoothHeading, toMapHeading } from './heading';

describe('phone heading', () => {
  it('reads iPhone compass headings and Android absolute alpha', () => {
    expect(compassHeading({ alpha: 10, webkitCompassHeading: 45 })).toBe(45);
    expect(compassHeading({ alpha: 90, absolute: true })).toBe(270); // alpha is counter-clockwise
    expect(compassHeading({ alpha: 0, absolute: true })).toBe(0);
  });

  it('ignores readings that are not relative to north', () => {
    expect(compassHeading({ alpha: 90, absolute: false })).toBeNull();
    expect(compassHeading({ alpha: null, absolute: true })).toBeNull();
  });

  it('accounts for a phone held sideways', () => {
    expect(compassHeading({ alpha: 0, absolute: true }, 90)).toBe(90);
  });

  it('smooths the short way round', () => {
    expect(smoothHeading(null, 370)).toBe(10);
    const s = smoothHeading(350, 10, 0.5);
    expect(s).toBeCloseTo(0, 5);
    expect(smoothHeading(10, 20, 0.5)).toBe(15);
  });

  it('learns the map direction from a QR sticker', () => {
    // The sticker faces "right" on the map (90°); the compass said 30° while scanning it.
    const offset = northOffset(90, 30);
    expect(offset).toBe(60);
    expect(toMapHeading(30, offset)).toBe(90);
    expect(toMapHeading(330, offset)).toBe(30); // turned 60° left
  });
});
