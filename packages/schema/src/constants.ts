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

/**
 * What a drawn shape on the floor plan is (Phase 9 — the 2D map). Shapes are drawing only:
 * routing never reads them, so a floor without shapes still navigates (text + sketch).
 * - `floor`: walkable area outline (corridors, lobbies) — drawn white with walls.
 * - `room`: a room outline; linked to a `rooms[]` entry for its color and label.
 * - `lift` / `stairs`: shaft or stairwell box.
 * - `void`: courtyard, atrium, shaft — not walkable, drawn grey.
 * - `wall`: an extra wall line (open polyline) not covered by an outline.
 *
 * Outdoors (Phase 10 — campus view), drawn on a shared level:
 * - `building`: a building footprint; linked to a `buildings[]` entry for its name and floors.
 * - `road`: roads and paved paths.  `green`: lawns, gardens.  `parking`: parking areas.
 */
export const SHAPE_KINDS = [
  'floor',
  'room',
  'lift',
  'stairs',
  'void',
  'wall',
  'building',
  'road',
  'green',
  'parking',
] as const;

/** Shape kinds that describe the outdoors (campus view) rather than a building's inside. */
export const OUTDOOR_SHAPE_KINDS: ReadonlySet<string> = new Set([
  'building',
  'road',
  'green',
  'parking',
]);

/** `public` = anyone can navigate there; `locked` = shown with 🔒, route ends at the door. */
export const VISIBILITIES = ['public', 'locked'] as const;
