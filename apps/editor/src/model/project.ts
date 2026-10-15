import type { Level, MapFile } from '@innermap/schema';
import { FORMAT_VERSION, LEVEL_COLORS } from '@innermap/schema';

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

/** The next floor above the current top one, with an unused id and the next color. */
export function nextLevel(doc: MapFile): Level {
  const top = Math.max(-1, ...doc.levels.map((l) => l.ord));
  const ord = Math.floor(top) + 1;
  const ids = new Set(doc.levels.map((l) => l.id));
  let id = String(ord);
  for (let n = 2; ids.has(id); n++) id = `${ord}-${n}`;
  const color = LEVEL_COLORS[doc.levels.length % LEVEL_COLORS.length] ?? 'slate';
  return { id, name: `Floor ${ord}`, ord, color };
}

export function sortedLevels(doc: MapFile): Level[] {
  return [...doc.levels].sort((a, b) => a.ord - b.ord);
}

export function isLevelEmpty(doc: MapFile, levelId: string): boolean {
  return !doc.nodes.some((n) => n.lvl === levelId);
}

/** Pixels per meter used to draw a floor's image (its scale, or the default until set). */
export function pxPerMeter(level: Level | undefined): number {
  return level?.pxPerMeter ?? DEFAULT_PX_PER_METER;
}
