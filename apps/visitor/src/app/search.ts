import type { Destination, Site } from '@innermap/core';
import type { Amenity, Room } from '@innermap/schema';
import type { Position, Target } from './state';

export interface RoomResult {
  readonly room: Room;
  readonly levelId: string;
  /** Building name on a campus ("Block A"), so a search for it lists its rooms. */
  readonly building?: string;
  readonly target: Target;
}

/** Rooms whose name, number, category or building matches; all rooms when the query is empty. */
export function searchRooms(
  site: Site,
  query: string,
  categoryLabel: (c: Room['category']) => string,
): RoomResult[] {
  const q = query.trim().toLowerCase();
  const levelOrder = new Map(site.graph.levels.map((l) => [l.id, l.rank]));
  return site.map.rooms
    .map((room): RoomResult => {
      const door = room.doors[0] ?? '';
      const levelId = site.graph.nodes.get(door)?.level ?? '';
      const building = site.buildingAt(door)?.name;
      const destination: Destination = { type: 'room', roomId: room.id };
      return {
        room,
        levelId,
        ...(building !== undefined && { building }),
        target: { destination, label: room.name },
      };
    })
    .filter(({ room, building }) => {
      if (!q) return true;
      const texts = [room.name, room.number ?? '', room.id, categoryLabel(room.category)];
      return [...texts, building ?? ''].some((text) => text.toLowerCase().includes(q));
    })
    .sort(
      (a, b) =>
        (a.building ?? '').localeCompare(b.building ?? '') ||
        (levelOrder.get(a.levelId) ?? 0) - (levelOrder.get(b.levelId) ?? 0) ||
        a.room.name.localeCompare(b.room.name),
    );
}

export interface AmenityChip {
  readonly emoji: string;
  readonly labelKey: 'chip.toilet' | 'chip.water' | 'chip.atm' | 'chip.help';
  readonly kinds: readonly Amenity['kind'][];
}

const CHIPS: readonly AmenityChip[] = [
  { emoji: '🚻', labelKey: 'chip.toilet', kinds: ['toilet', 'toilet-accessible'] },
  { emoji: '💧', labelKey: 'chip.water', kinds: ['water'] },
  { emoji: '🏧', labelKey: 'chip.atm', kinds: ['atm'] },
  { emoji: 'ℹ️', labelKey: 'chip.help', kinds: ['help-desk'] },
];

/**
 * "Nearest …" chips for amenities this site actually has.
 * Step-free visitors asking for a toilet only get accessible ones (PHASES.md Phase 2 decision).
 */
export function amenityChips(site: Site, stepFree: boolean): AmenityChip[] {
  return CHIPS.map((chip) =>
    stepFree && chip.labelKey === 'chip.toilet'
      ? { ...chip, kinds: ['toilet-accessible'] as const }
      : chip,
  ).filter((chip) => site.amenitiesOfKind(chip.kinds).length > 0);
}

/** Text typed in "where are you?": a QR short code, a room number/name, or a node id. */
export function resolvePosition(site: Site, text: string): Position | null {
  const value = text.trim();
  if (!value) return null;
  const qr = site.findQr(value);
  if (qr) return { node: qr.node, facing: qr.facing, source: 'typed' };
  const room = site.findRoom(value);
  const door = room?.doors[0];
  if (door) return { node: door, source: 'typed' };
  if (site.graph.nodes.has(value)) return { node: value, source: 'typed' };
  return null;
}

/** Named landmarks closest to a node on the same floor (for "Do you see any of these?"). */
export function nearbyLandmarks(
  site: Site,
  nodeId: string | null,
  count = 5,
): Array<{ id: string; landmark: string }> {
  const origin = nodeId ? site.graph.nodes.get(nodeId) : undefined;
  if (!origin) return [];
  return [...site.graph.nodes.values()]
    .filter((n) => n.level === origin.level && n.landmark !== undefined)
    .map((n) => ({
      id: n.id,
      landmark: n.landmark ?? '',
      d: Math.hypot(n.x - origin.x, n.y - origin.y),
    }))
    .sort((a, b) => a.d - b.d)
    .slice(0, count)
    .map(({ id, landmark }) => ({ id, landmark }));
}

/** QR content is either our link (…?at=G-MAIN) or a bare code. */
export function codeFromQr(content: string): string {
  try {
    return new URL(content).searchParams.get('at') ?? content;
  } catch {
    return content;
  }
}
