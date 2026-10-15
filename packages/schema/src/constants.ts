/**
 * Map file format version this package reads and writes.
 * Prototype format is 0; production starts at 1 (see docs/LOW_LEVEL_DESIGN.md §4.3).
 */
export const FORMAT_VERSION = 0;

/** Each floor gets a color used everywhere in the UI (badge, step card, map sketch). */
export const LEVEL_COLORS = [
  'teal',
  'amber',
  'violet',
  'blue',
  'rose',
  'green',
  'orange',
  'slate',
] as const;

/** What a path dot represents. Only dots with a `landmark` are shown to visitors as steps. */
export const NODE_KINDS = [
  'junction',
  'corner',
  'entrance',
  'door',
  'lift-stop',
  'stairs-stop',
] as const;

/** Walkable lines on one floor. Movement between floors goes through connectors. */
export const EDGE_KINDS = ['walk', 'ramp', 'outdoor'] as const;

/** Objects that span several floors. */
export const CONNECTOR_KINDS = ['lift', 'stairs'] as const;

export const ROOM_CATEGORIES = [
  'emergency',
  'opd',
  'lab',
  'diagnostics',
  'pharmacy',
  'billing',
  'food',
  'admin',
  'ward',
  'classroom',
  'office',
  'staff',
  'other',
] as const;

export const AMENITY_KINDS = [
  'toilet',
  'toilet-accessible',
  'water',
  'atm',
  'wheelchair',
  'help-desk',
  'prayer-room',
  'baby-care',
  'charging',
  'fire-extinguisher',
  'aed',
] as const;

/** `public` = anyone can navigate there; `locked` = shown with 🔒, route ends at the door. */
export const VISIBILITIES = ['public', 'locked'] as const;
