/**
 * The phone's compass (no hardware, no app): Android sends `deviceorientationabsolute` with no
 * permission; iPhone sends `deviceorientation` with `webkitCompassHeading` after the visitor
 * allows it once (that request must come from a tap). Needs HTTPS (or localhost).
 */
import type { OrientationReading } from '../app/heading';
import { compassHeading, smoothHeading } from '../app/heading';

interface PermissionAware {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

export interface Compass {
  /** A permission prompt exists (iPhone needs it; offer a button until readings arrive). */
  readonly needsPermission: boolean;
  /** Ask (from a tap) and start; resolves false if refused or unsupported. */
  enable(): Promise<boolean>;
}

/** Starts listening where no permission is needed; calls back with smoothed headings. */
export function startCompass(onHeading: (compass: number) => void): Compass | null {
  if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) return null;
  const ctor = window.DeviceOrientationEvent as unknown as PermissionAware;
  const needsPermission = typeof ctor.requestPermission === 'function';
  let smoothed: number | null = null;
  let listening = false;

  const onReading = (event: Event) => {
    const reading = event as unknown as OrientationReading;
    const screenAngle = screen.orientation?.angle ?? 0;
    const heading = compassHeading(reading, screenAngle);
    if (heading === null) return;
    smoothed = smoothHeading(smoothed, heading);
    onHeading(smoothed);
  };
  const listen = () => {
    if (listening) return;
    listening = true;
    // Android Chrome: absolute (relative to north). iPhone: webkitCompassHeading on this one.
    const target: EventTarget = window;
    const absolute = 'ondeviceorientationabsolute' in target;
    target.addEventListener(
      absolute ? 'deviceorientationabsolute' : 'deviceorientation',
      onReading,
    );
  };

  // Always listen: Android sends readings without asking (newer Chrome also has
  // requestPermission, but doesn't need it); iPhone stays silent until enable() is tapped.
  listen();
  return {
    needsPermission,
    async enable() {
      try {
        if (ctor.requestPermission && (await ctor.requestPermission()) !== 'granted') return false;
        listen();
        return true;
      } catch {
        return false;
      }
    },
  };
}
