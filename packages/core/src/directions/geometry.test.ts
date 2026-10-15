import { describe, expect, it } from 'vitest';
import { classifyTurn, heading, turnAngle } from './geometry';

describe('heading', () => {
  it('uses compass degrees with y pointing south', () => {
    const o = { x: 0, y: 0 };
    expect(heading(o, { x: 0, y: -1 })).toBe(0); // north
    expect(heading(o, { x: 1, y: 0 })).toBe(90); // east
    expect(heading(o, { x: 0, y: 1 })).toBe(180); // south
    expect(heading(o, { x: -1, y: 0 })).toBe(270); // west
    expect(heading(o, o)).toBeNull();
  });
});

describe('turns', () => {
  it('positive angles turn right, negative left, across the 0/360 seam', () => {
    expect(turnAngle(0, 90)).toBe(90);
    expect(turnAngle(90, 0)).toBe(-90);
    expect(turnAngle(350, 10)).toBe(20);
    expect(turnAngle(10, 350)).toBe(-20);
    expect(turnAngle(0, 180)).toBe(180);
  });

  it.each([
    [0, 'straight'],
    [29, 'straight'],
    [-45, 'slight-left'],
    [45, 'slight-right'],
    [90, 'right'],
    [-90, 'left'],
    [150, 'right'],
    [151, 'u-turn'],
    [180, 'u-turn'],
  ] as const)('%d° → %s', (angle, turn) => {
    expect(classifyTurn(angle)).toBe(turn);
  });
});
