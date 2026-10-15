/** Points use plan coordinates: x grows east, y grows south. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

export type Turn = 'straight' | 'slight-left' | 'slight-right' | 'left' | 'right' | 'u-turn';

/** Compass heading in degrees, clockwise from "up" (0 = north, 90 = east). Null if a == b. */
export function heading(from: Point, to: Point): number | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.hypot(dx, dy) < 1e-6) return null;
  return ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
}

/** Signed change of direction in (-180, 180]; positive = turning right (clockwise). */
export function turnAngle(fromHeading: number, toHeading: number): number {
  let delta = (toHeading - fromHeading) % 360;
  if (delta > 180) delta -= 360;
  if (delta <= -180) delta += 360;
  return delta;
}

/** Thresholds from docs/LOW_LEVEL_DESIGN.md §5.3. */
export function classifyTurn(angle: number): Turn {
  const size = Math.abs(angle);
  if (size < 30) return 'straight';
  if (size > 150) return 'u-turn';
  const side = angle > 0 ? 'right' : 'left';
  return size < 60 ? `slight-${side}` : side;
}
