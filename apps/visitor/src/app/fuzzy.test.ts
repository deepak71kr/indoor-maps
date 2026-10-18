import { describe, expect, it } from 'vitest';
import { matchScore, normalize, squash, typos } from './fuzzy';

describe('forgiving search', () => {
  it('normalizes case, accents, punctuation and spaces', () => {
    expect(normalize('  X-Ray (Room G04) ')).toBe('x ray room g04');
    expect(squash('G-03')).toBe('g3');
    expect(squash('g 3')).toBe('g3');
    expect(squash('203')).toBe('203');
  });

  it('counts typos, with swapped letters as one', () => {
    expect(typos('libary', 'library', 2)).toBe(1);
    expect(typos('radiolgy', 'radiology', 2)).toBe(1);
    expect(typos('pahrmacy', 'pharmacy', 2)).toBe(1);
    expect(typos('canteen', 'library', 2)).toBe(3);
  });

  it('finds places from misspelled, partial or differently spaced words', () => {
    const library = ['Central Library', 'Library'];
    expect(matchScore('liberary', library)).toBeGreaterThan(0.5);
    expect(matchScore('lib', library)).toBeGreaterThan(0.8);
    expect(matchScore('xray', ['X-Ray', 'Scans & X-ray'])).toBe(1);
    expect(matchScore('x ray', ['X-Ray'])).toBe(1);
    expect(matchScore('computerlab', ['Computer Lab', 'Lab'])).toBeGreaterThan(0.8);
    expect(matchScore('comp lab', ['Computer Lab', 'Lab'])).toBeGreaterThan(0.8);
    expect(matchScore('g3', ['Pharmacy', 'G03'])).toBe(1);
  });

  it('understands words that mean the same', () => {
    expect(matchScore('washroom', ['Toilets'])).toBeGreaterThan(0.8);
    expect(matchScore('canteen', ['Food Court', 'Food'])).toBeGreaterThan(0.8);
    expect(matchScore('elevator', ['Lift A'])).toBeGreaterThan(0.8);
    expect(matchScore('second floor', ['Language lab', 'Floor 2'])).toBeGreaterThan(0.8);
  });

  it('does not match unrelated places', () => {
    expect(matchScore('pharmacy', ['Central Library', 'Library'])).toBe(0);
    expect(matchScore('xyz', ['Radiology'])).toBe(0);
  });
});
