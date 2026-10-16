/**
 * Which way the phone points, on the map (pure maths, tested without a phone).
 *
 * The phone's compass gives degrees clockwise from north. Our maps don't know where north is
 * (a plan's "up" is whatever way it was traced), so we learn the difference from QR stickers:
 * a sticker's `facing` is the map direction a person looks while scanning it, and the phone is
 * pointing the same way at that moment. map heading = compass heading + offset.
 */

/** The parts of a DeviceOrientationEvent we use (iOS adds webkitCompassHeading). */
export interface OrientationReading {
  readonly alpha: number | null;
  readonly absolute?: boolean;
  readonly webkitCompassHeading?: number;
}

const norm = (deg: number) => ((deg % 360) + 360) % 360;

/**
 * Compass heading (degrees clockwise from north) of the top of the SCREEN, or null when the
 * reading is not relative to north (Android's plain `deviceorientation` is not).
 */
export function compassHeading(reading: OrientationReading, screenAngle = 0): number | null {
  if (typeof reading.webkitCompassHeading === 'number' && reading.webkitCompassHeading >= 0) {
    return norm(reading.webkitCompassHeading + screenAngle);
  }
  if (reading.absolute && typeof reading.alpha === 'number') {
    // alpha grows counter-clockwise from north; headings grow clockwise.
    return norm(360 - reading.alpha + screenAngle);
  }
  return null;
}

/** Smooths a wobbly heading the short way round (350° → 10° passes through 0°, not 180°). */
export function smoothHeading(previous: number | null, next: number, keep = 0.8): number {
  if (previous === null) return norm(next);
  let delta = norm(next - previous);
  if (delta > 180) delta -= 360;
  return norm(previous + delta * (1 - keep));
}

/** Learned at a QR sticker: what to add to the compass to get the map direction. */
export function northOffset(stickerFacing: number, compass: number): number {
  return norm(stickerFacing - compass);
}

export function toMapHeading(compass: number, offset: number): number {
  return norm(compass + offset);
}

/** A scan counts for calibration this long (the phone still points the way the sticker faces). */
export const CALIBRATE_WINDOW_MS = 30_000;
