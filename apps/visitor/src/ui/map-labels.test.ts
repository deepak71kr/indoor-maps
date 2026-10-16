import { describe, expect, it } from 'vitest';
import { initials, shortPlace, tierOpacity } from './map-view';

describe('map label text', () => {
  it('shortens a landmark to its name for a map tag', () => {
    expect(shortPlace('Reception desk (blue board), Lift A lobby')).toBe('Reception desk');
    expect(shortPlace('Lift A')).toBe('Lift A');
  });

  it('abbreviates building names that do not fit their block', () => {
    expect(initials('Girls Hostel 1')).toBe('GH1');
    expect(initials('Medical Centre (Dispensary)')).toBe('MC');
  });
});

describe('zoom levels (Google-style, faded)', () => {
  it('campus: buildings when zoomed out, rooms when zoomed in, a smooth fade between', () => {
    const far = tierOpacity(1.5, true);
    expect(far).toMatchObject({ in: 0, bname: 1, room: 0, entrance: 0, detail: 0 });
    const between = tierOpacity(5.8, true);
    expect(between.room).toBeGreaterThan(0);
    expect(between.room).toBeLessThan(1);
    expect(between.bname).toBeGreaterThan(0);
    const near = tierOpacity(10, true);
    expect(near).toMatchObject({ in: 1, bname: 0, room: 1, entrance: 1, detail: 1 });
  });

  it('one building: rooms always show; only small details wait for zooming in', () => {
    expect(tierOpacity(3, false)).toMatchObject({ in: 1, room: 1, detail: 0 });
    expect(tierOpacity(9, false).detail).toBe(1);
  });
});
