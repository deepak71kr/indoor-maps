import type { Position, State, Target } from './state';

/** A trip saved on the phone so closing the browser doesn't lose it (LLD §6). */
export interface SavedTrip {
  readonly v: 1;
  readonly site: string;
  readonly position: Position;
  readonly target: Target;
  readonly step: number;
  readonly stepFree: boolean;
  readonly savedAt: number;
}

/** Old hospital visits must not come back next week. */
export const TRIP_TTL_MS = 3 * 60 * 60 * 1000;
const KEY = 'im.trip';

/** Storage can be missing or throw (private mode, blocked site data) — never crash. */
export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function loadTrip(storage: KeyValue | null, site: string, now: number): SavedTrip | null {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return null;
    const trip = JSON.parse(raw) as Partial<SavedTrip>;
    if (trip.v !== 1 || trip.site !== site || !trip.position || !trip.target) return null;
    if (typeof trip.savedAt !== 'number' || now - trip.savedAt > TRIP_TTL_MS) return null;
    return trip as SavedTrip;
  } catch {
    return null;
  }
}

/** Saves while a trip is in progress; clears once it ends. */
export function persistTrip(
  storage: KeyValue | null,
  site: string,
  state: State,
  now: number,
): void {
  try {
    const { screen, position, target } = state;
    const active = screen.name === 'navigate' || screen.name === 'lost';
    if (!active || !position || !target) {
      storage?.removeItem(KEY);
      return;
    }
    const trip: SavedTrip = {
      v: 1,
      site,
      position,
      target,
      step: screen.step,
      stepFree: state.stepFree,
      savedAt: now,
    };
    storage?.setItem(KEY, JSON.stringify(trip));
  } catch {
    // Storage full or blocked: the trip just won't survive a reload.
  }
}
