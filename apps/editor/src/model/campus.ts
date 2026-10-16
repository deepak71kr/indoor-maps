/**
 * Campus (Phase 10): buildings, and which building each floor belongs to. Pure functions on the
 * document like plan.ts; the UI runs them through `store.edit`, so undo works.
 *
 * The model: levels without a building are shared by the whole site (usually one "Ground" level
 * holding the outdoors and every building's ground floor); upper floors belong to one building.
 * Floor order must be unique within a building, counting the shared levels.
 */
import type { Building, Level, MapFile } from '@innermap/schema';

/** A copy without `key` (optional fields are left out, never set to undefined). */
function omit<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  return Object.fromEntries(Object.entries(value).filter(([k]) => k !== key)) as Omit<T, K>;
}

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'building';

export function addBuilding(doc: MapFile, name: string): { doc: MapFile; id: string } {
  const ids = new Set((doc.buildings ?? []).map((b) => b.id));
  const base = slug(name);
  let id = base;
  for (let n = 2; ids.has(id); n++) id = `${base}-${n}`;
  const building: Building = { id, name: name.trim() || 'Building' };
  return { doc: { ...doc, buildings: [...(doc.buildings ?? []), building] }, id };
}

export function renameBuilding(doc: MapFile, id: string, name: string): MapFile {
  const trimmed = name.trim();
  if (!trimmed) return doc;
  return {
    ...doc,
    buildings: (doc.buildings ?? []).map((b) => (b.id === id ? { ...b, name: trimmed } : b)),
  };
}

/** Floors that belong to a building (its footprint on the campus is not counted). */
export function floorsOf(doc: MapFile, id: string): Level[] {
  return doc.levels.filter((l) => l.building === id);
}

/** Removes a building with no floors of its own; its footprint stays, unlinked. */
export function deleteBuilding(doc: MapFile, id: string): MapFile {
  if (floorsOf(doc, id).length > 0) return doc;
  const buildings = (doc.buildings ?? []).filter((b) => b.id !== id);
  const rest = omit(doc, 'buildings');
  return {
    ...(buildings.length > 0 ? { ...rest, buildings } : rest),
    levels: doc.levels.map((level) =>
      level.shapes?.some((s) => s.building === id)
        ? {
            ...level,
            shapes: level.shapes.map((s) => {
              if (s.building !== id) return s;
              return omit(s, 'building');
            }),
          }
        : level,
    ),
  };
}

/** Levels that share floor numbering with `building`: its own and the shared ones. */
export function stackOf(doc: MapFile, building: string | undefined): Level[] {
  return doc.levels.filter(
    (l) => building === undefined || l.building === undefined || l.building === building,
  );
}

/**
 * Moves a floor into a building (or back to shared). If its order is taken there, it moves
 * up to the next free one, so the file stays valid.
 */
export function setLevelBuilding(doc: MapFile, levelId: string, building: string | null): MapFile {
  const level = doc.levels.find((l) => l.id === levelId);
  if (!level || (level.building ?? null) === building) return doc;
  const others = stackOf(doc, building ?? undefined).filter((l) => l.id !== levelId);
  let ord = level.ord;
  while (others.some((l) => l.ord === ord)) ord += 1;
  return {
    ...doc,
    levels: doc.levels.map((l) => {
      if (l.id !== levelId) return l;
      const rest = omit(l, 'building');
      return building ? { ...rest, ord, building } : { ...rest, ord };
    }),
  };
}

/** "Block A · Floor 2" on a campus, "Floor 2" otherwise. */
export function levelLabel(doc: MapFile, level: Level): string {
  const building = level.building ? doc.buildings?.find((b) => b.id === level.building) : undefined;
  return building ? `${building.name} · ${level.name}` : level.name;
}

/** The building a new footprint most likely belongs to: the first one without a footprint. */
export function buildingForFootprint(doc: MapFile): string | undefined {
  const drawn = new Set(doc.levels.flatMap((l) => (l.shapes ?? []).map((s) => s.building)));
  return doc.buildings?.find((b) => !drawn.has(b.id))?.id;
}
