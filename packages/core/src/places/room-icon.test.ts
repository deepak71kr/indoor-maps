import { describe, expect, it } from 'vitest';
import big from '../../../../samples/demo-mesra/map.json';
import { roomIcon } from './room-icon';

const icon = (name: string, own?: string) =>
  roomIcon(own === undefined ? { name } : { name, icon: own }, '📍');

describe('room icons from their names', () => {
  it('picks a specific icon before a general one', () => {
    expect(icon('Computer Lab')).toBe('💻');
    expect(icon('AI & ML Lab')).toBe('🤖');
    expect(icon('Physics lab')).toBe('⚛️');
    expect(icon('Pathology lab')).toBe('🩸');
    expect(icon('Concrete Lab')).toBe('🏗️');
    expect(icon('Lecture Hall 101')).toBe('🎓');
    expect(icon('Main hall')).toBe('🎭');
    expect(icon('Dining hall A')).toBe('🍽️');
  });

  it('covers hospital and campus places', () => {
    expect(icon('Pharmacy')).toBe('💊');
    expect(icon('Dental clinic')).toBe('🦷');
    expect(icon('Badminton court')).toBe('🏸');
    expect(icon('Swimming pool entry')).toBe('🏊');
    expect(icon('Hostel 3 Rooms 101–104')).toBe('🛏️');
    expect(icon('Bank branch')).toBe('🧾');
    expect(icon('ATM Kiosk')).toBe('🏧');
    expect(icon('Electrical Substation')).toBe('⚡');
    expect(icon("Director's office")).toBe('🗂️');
  });

  it("the room's own icon wins; unknown names get the fallback", () => {
    expect(icon('Computer Lab', '🖥️')).toBe('🖥️');
    expect(icon('Room of requirement')).toBe('📍');
  });

  it('gives most rooms of the big demo campus a specific icon', () => {
    const rooms = (big as { rooms: Array<{ name: string }> }).rooms;
    const generic = rooms.filter((r) => icon(r.name) === '📍');
    expect(generic.length / rooms.length).toBeLessThan(0.1);
  });
});
