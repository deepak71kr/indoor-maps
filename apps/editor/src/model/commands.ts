/**
 * Every change to the map is a Command (docs/PHASES.md Phase 6), so undo/redo works for
 * everything. Commands are created against the current document and remember exactly what
 * they changed, so `revert` restores it precisely (no floating-point drift).
 */
import type { Level, MapFile } from '@innermap/schema';

export interface Command {
  readonly label: string;
  apply(doc: MapFile): MapFile;
  revert(doc: MapFile): MapFile;
}

/** Several commands as one undo step (applied in order, reverted in reverse). */
export function composite(label: string, commands: readonly Command[]): Command {
  return {
    label,
    apply: (doc) => commands.reduce((d, c) => c.apply(d), doc),
    revert: (doc) => [...commands].reverse().reduce((d, c) => c.revert(d), doc),
  };
}

/** Replace the whole document (new project, import, load sample). */
export function replaceDocument(label: string, before: MapFile, after: MapFile): Command {
  return { label, apply: () => after, revert: () => before };
}

// ---------- site ----------

export function renameSite(doc: MapFile, name: string): Command {
  const before = doc.site.name;
  const set = (d: MapFile, value: string): MapFile => ({ ...d, site: { ...d.site, name: value } });
  return { label: 'Rename site', apply: (d) => set(d, name), revert: (d) => set(d, before) };
}

// ---------- levels ----------

/** `null` removes an optional field (image, pxPerMeter). */
export type LevelPatch = {
  readonly name?: string;
  readonly ord?: number;
  readonly color?: Level['color'];
  readonly image?: string | null;
  readonly pxPerMeter?: number | null;
  readonly shapes?: Level['shapes'] | null;
};

function patchLevel(level: Level, patch: LevelPatch): Level {
  const given = Object.entries(patch).filter(([, value]) => value !== undefined);
  const merged: Record<string, unknown> = { ...level, ...Object.fromEntries(given) };
  // `null` in a patch means "remove this optional field".
  return Object.fromEntries(
    Object.entries(merged).filter(([, value]) => value !== null && value !== undefined),
  ) as Level;
}

function mapLevel(doc: MapFile, id: string, fn: (level: Level) => Level): MapFile {
  return { ...doc, levels: doc.levels.map((l) => (l.id === id ? fn(l) : l)) };
}

export function updateLevel(
  doc: MapFile,
  id: string,
  patch: LevelPatch,
  label = 'Edit floor',
): Command {
  const level = doc.levels.find((l) => l.id === id);
  if (!level) throw new Error(`Unknown level ${id}`);
  const undo: Record<string, unknown> = {};
  for (const key of Object.keys(patch) as Array<keyof LevelPatch>) {
    undo[key] = level[key] ?? null;
  }
  return {
    label,
    apply: (d) => mapLevel(d, id, (l) => patchLevel(l, patch)),
    revert: (d) => mapLevel(d, id, (l) => patchLevel(l, undo as LevelPatch)),
  };
}

export function addLevel(level: Level): Command {
  return {
    label: `Add ${level.name}`,
    apply: (d) => ({ ...d, levels: [...d.levels, level] }),
    revert: (d) => ({ ...d, levels: d.levels.filter((l) => l.id !== level.id) }),
  };
}

/** Removes an EMPTY floor (the UI only offers this when nothing is drawn on it). */
export function removeLevel(doc: MapFile, id: string): Command {
  const index = doc.levels.findIndex((l) => l.id === id);
  const level = doc.levels[index];
  if (!level) throw new Error(`Unknown level ${id}`);
  if (doc.nodes.some((n) => n.lvl === id)) throw new Error(`Level ${id} is not empty`);
  return {
    label: `Delete ${level.name}`,
    apply: (d) => ({ ...d, levels: d.levels.filter((l) => l.id !== id) }),
    revert: (d) => {
      const levels = [...d.levels];
      levels.splice(index, 0, level);
      return { ...d, levels };
    },
  };
}

/** Swap floor order with the neighbour above (+1) or below (-1). */
export function moveLevel(doc: MapFile, id: string, direction: 1 | -1): Command | null {
  const sorted = [...doc.levels].sort((a, b) => a.ord - b.ord);
  const index = sorted.findIndex((l) => l.id === id);
  const self = sorted[index];
  const other = sorted[index + direction];
  if (!self || !other) return null;
  return composite(direction > 0 ? 'Move floor up' : 'Move floor down', [
    updateLevel(doc, self.id, { ord: other.ord }),
    updateLevel(doc, other.id, { ord: self.ord }),
  ]);
}

// ---------- nodes ----------

export interface NodeMove {
  readonly id: string;
  readonly from: { readonly x: number; readonly y: number };
  readonly to: { readonly x: number; readonly y: number };
}

export function moveNodes(moves: readonly NodeMove[], label = 'Move'): Command {
  const place = (d: MapFile, pick: (m: NodeMove) => { x: number; y: number }): MapFile => {
    const byId = new Map(moves.map((m) => [m.id, pick(m)]));
    return { ...d, nodes: d.nodes.map((n) => (byId.has(n.id) ? { ...n, ...byId.get(n.id) } : n)) };
  };
  return { label, apply: (d) => place(d, (m) => m.to), revert: (d) => place(d, (m) => m.from) };
}

/**
 * Set a floor's scale. Dots are stored in meters but drawn on the image, so when the scale
 * changes, the dots on that floor are rescaled too — they stay exactly where they were drawn.
 */
export function setScale(
  doc: MapFile,
  levelId: string,
  pxPerMeter: number,
  defaultPxPerMeter: number,
): Command {
  const level = doc.levels.find((l) => l.id === levelId);
  if (!level) throw new Error(`Unknown level ${levelId}`);
  const factor = (level.pxPerMeter ?? defaultPxPerMeter) / pxPerMeter;
  const moves: NodeMove[] = doc.nodes
    .filter((n) => n.lvl === levelId)
    .map((n) => ({ id: n.id, from: { x: n.x, y: n.y }, to: { x: n.x * factor, y: n.y * factor } }));
  // Outlines are drawn on the image too: rescale them with the dots.
  const shapes = level.shapes?.map((shape) => ({
    ...shape,
    pts: shape.pts.map((v) => Math.round(v * factor * 100) / 100),
  }));
  return composite('Set scale', [
    updateLevel(doc, levelId, shapes ? { pxPerMeter, shapes } : { pxPerMeter }),
    moveNodes(moves),
  ]);
}
