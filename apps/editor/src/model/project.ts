import type { Level, MapFile } from '@innermap/schema';
import { FORMAT_VERSION, LEVEL_COLORS } from '@innermap/schema';
import { stackOf } from './campus';

/** Until a floor's scale is set, its image is shown at this many pixels per meter. */
export const DEFAULT_PX_PER_METER = 10;

export function newProject(): MapFile {
  return {
    fmt: FORMAT_VERSION,
    site: { id: 'my-site', name: 'New site' },
    levels: [{ id: 'G', name: 'Ground', ord: 0, color: 'teal' }],
    nodes: [],
    edges: [],
    connectors: [],
    rooms: [],
    amenities: [],
    qr: [],
  };
}

/**
 * The next floor above the current top one, with an unused id and the next color. On a campus,
 * pass a building to add a floor on top of that building (shared levels count too).
 */
export function nextLevel(doc: MapFile, building?: string): Level {
  const top = Math.max(-1, ...stackOf(doc, building).map((l) => l.ord));
  const ord = Math.floor(top) + 1;
  const ids = new Set(doc.levels.map((l) => l.id));
  const base = building ? `${building}${ord}` : String(ord);
  let id = base;
  for (let n = 2; ids.has(id); n++) id = `${base}-${n}`;
  const color = LEVEL_COLORS[doc.levels.length % LEVEL_COLORS.length] ?? 'slate';
  return { id, name: `Floor ${ord}`, ord, color, ...(building !== undefined && { building }) };
}

/** Shared levels first, then each building's floors in the order the buildings are listed. */
export function sortedLevels(doc: MapFile): Level[] {
  const rank = new Map((doc.buildings ?? []).map((b, i) => [b.id, i]));
  const group = (l: Level) => (l.building === undefined ? -1 : (rank.get(l.building) ?? -1));
  return [...doc.levels].sort((a, b) => group(a) - group(b) || a.ord - b.ord);
}

export function isLevelEmpty(doc: MapFile, levelId: string): boolean {
  const level = doc.levels.find((l) => l.id === levelId);
  return !doc.nodes.some((n) => n.lvl === levelId) && !level?.shapes?.length;
}

/** Pixels per meter used to draw a floor's image (its scale, or the default until set). */
export function pxPerMeter(level: Level | undefined): number {
  return level?.pxPerMeter ?? DEFAULT_PX_PER_METER;
}
