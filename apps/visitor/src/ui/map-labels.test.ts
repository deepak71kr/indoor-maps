import { describe, expect, it } from 'vitest';
import { initials, shortPlace } from './map-view';

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
