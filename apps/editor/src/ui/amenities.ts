import type { Amenity } from '@innermap/schema';

/** Emoji + label for each amenity kind (decoration only; the data stores the kind). */
export const AMENITIES: ReadonlyArray<{ kind: Amenity['kind']; emoji: string; label: string }> = [
  { kind: 'toilet', emoji: '🚻', label: 'Toilet' },
  { kind: 'toilet-accessible', emoji: '♿', label: 'Accessible toilet' },
  { kind: 'water', emoji: '💧', label: 'Drinking water' },
  { kind: 'atm', emoji: '🏧', label: 'ATM' },
  { kind: 'help-desk', emoji: 'ℹ️', label: 'Help desk' },
  { kind: 'wheelchair', emoji: '🦽', label: 'Wheelchair' },
  { kind: 'prayer-room', emoji: '🛐', label: 'Prayer room' },
  { kind: 'baby-care', emoji: '🍼', label: 'Baby care' },
  { kind: 'charging', emoji: '🔌', label: 'Charging' },
  { kind: 'fire-extinguisher', emoji: '🧯', label: 'Fire extinguisher' },
  { kind: 'aed', emoji: '❤️', label: 'Defibrillator (AED)' },
];

export const amenityEmoji = (kind: Amenity['kind']) =>
  AMENITIES.find((a) => a.kind === kind)?.emoji ?? '📍';

/** Drag-and-drop data type for the palette. */
export const AMENITY_DRAG_TYPE = 'application/x-inner-map-amenity';
