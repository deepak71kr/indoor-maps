import type { Destination, Site } from '@innermap/core';
import type { Amenity, Room } from '@innermap/schema';
import { matchScore } from './fuzzy';
import type { Position, Target } from './state';

export interface RoomResult {
  readonly room: Room;
  readonly levelId: string;
  /** Building name on a campus ("Block A"), so a search for it lists its rooms. */
  readonly building?: string;
  readonly target: Target;
  /** How well it matched the search (1 = exactly); absent when nothing was typed. */
  readonly score?: number;
}

/** Below this a place is not shown as a match. */
const MIN_SCORE = 0.5;

/**
 * Rooms for what was typed — forgiving about spelling, spaces and words (app/fuzzy.ts) —
 * best matches first, and among equal ones the nearest to `near` (the visitor) first.
 * With nothing typed: every room, by building and floor.
 */
export function searchRooms(
  site: Site,
  query: string,
  categoryLabel: (c: Room['category']) => string,
  near?: string | null,
): RoomResult[] {
  const typed = query.trim().length > 0;
  const levels = new Map(site.graph.levels.map((l) => [l.id, l]));
  const here = near ? site.graph.nodes.get(near) : undefined;
  const away = (door: string) => {
    const n = site.graph.nodes.get(door);
    if (!here || !n) return 0;
    // Another floor counts as far: walking there means stairs or a lift.
    return Math.hypot(n.x - here.x, n.y - here.y) + (n.level === here.level ? 0 : 200);
  };
  const results = site.map.rooms.flatMap((room): RoomResult[] => {
    const door = room.doors[0] ?? '';
    const levelId = site.graph.nodes.get(door)?.level ?? '';
    const building = site.buildingAt(door)?.name;
    const level = levels.get(levelId);
    const score = typed
      ? matchScore(query, [
          room.name,
          room.number ?? '',
          categoryLabel(room.category),
          building ?? '',
          level?.name ?? '',
        ])
      : undefined;
    if (score !== undefined && score < MIN_SCORE) return [];
    const destination: Destination = { type: 'room', roomId: room.id };
    return [
      {
        room,
        levelId,
        ...(building !== undefined && { building }),
        target: { destination, label: room.name },
        ...(score !== undefined && { score }),
      },
    ];
  });
  if (typed) {
    const dist = new Map(results.map((r) => [r, away(r.room.doors[0] ?? '')]));
    return results.sort(
      (a, b) =>
        // Close scores count as equal, so a nearby place beats a far one with a tiny edge.
        Math.round(((b.score ?? 0) - (a.score ?? 0)) * 10) ||
        (dist.get(a) ?? 0) - (dist.get(b) ?? 0) ||
        a.room.name.localeCompare(b.room.name),
    );
  }
  return results.sort(
    (a, b) =>
      (a.building ?? '').localeCompare(b.building ?? '') ||
      (levels.get(a.levelId)?.rank ?? 0) - (levels.get(b.levelId)?.rank ?? 0) ||
      a.room.name.localeCompare(b.room.name),
  );
}

/**
 * Buildings for what was typed ("library", "main bldg", "hostel 3"): a first-time visitor
 * often wants the building itself. Goes to its main way in.
 */
export function searchBuildings(
  site: Site,
  query: string,
): Array<{ nodeId: string; name: string; score: number }> {
  if (!query.trim()) return [];
  const doors = [...site.graph.nodes.values()].filter((n) => n.kind === 'entrance');
  return (site.map.buildings ?? [])
    .map((b) => {
      const ways = doors.filter((n) => site.buildingAt(n.id)?.id === b.id);
      // The main way in: the one named "<building> entrance" / "… Entry", else the first.
      const door = ways.find((n) => /(entrance|entry)$/i.test(n.landmark ?? '')) ?? ways[0];
      return { nodeId: door?.id ?? '', name: b.name, score: matchScore(query, [b.name]) };
    })
    .filter((b) => b.nodeId && b.score >= 0.7)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

/** Named spots outdoors for what was typed (a gate, a fountain, a notice board). */
export function searchSpots(
  site: Site,
  query: string,
  limit = 3,
): Array<{ nodeId: string; name: string }> {
  // Only campuses have an outdoors; in a single building every named spot is a corridor.
  if (!query.trim() || !site.map.buildings?.length) return [];
  const seen = new Set<string>();
  return [...site.graph.nodes.values()]
    .filter(
      (n) =>
        n.landmark &&
        (n.kind === 'entrance' || n.kind === 'junction') &&
        // Outdoors only: corridors, lobbies and stairs are steps of a route, not places.
        site.buildingAt(n.id) === undefined,
    )
    .map((n) => ({
      nodeId: n.id,
      name: n.landmark ?? '',
      score: matchScore(query, [n.landmark ?? '']),
    }))
    .filter((s) => s.score >= 0.7 && !/^(Path to|Outside|Between|Where)/.test(s.name))
    .sort((a, b) => b.score - a.score)
    .filter((s) => !seen.has(s.name) && seen.add(s.name))
    .slice(0, limit)
    .map(({ nodeId, name }) => ({ nodeId, name }));
}

export interface AmenityChip {
  readonly emoji: string;
  readonly labelKey: 'chip.toilet' | 'chip.water' | 'chip.atm' | 'chip.help';
  readonly kinds: readonly Amenity['kind'][];
  /** What a visitor might type for it. */
  readonly words: string;
}

const CHIPS: readonly AmenityChip[] = [
  {
    emoji: '🚻',
    labelKey: 'chip.toilet',
    kinds: ['toilet', 'toilet-accessible'],
    words: 'toilet washroom restroom bathroom loo wc',
  },
  { emoji: '💧', labelKey: 'chip.water', kinds: ['water'], words: 'water drinking cooler' },
  { emoji: '🏧', labelKey: 'chip.atm', kinds: ['atm'], words: 'atm cash bank' },
  {
    emoji: 'ℹ️',
    labelKey: 'chip.help',
    kinds: ['help-desk'],
    words: 'help desk reception enquiry information',
  },
];

/** "Nearest toilet" and the like, when what was typed means one of them ("washroom"). */
export function searchAmenities(site: Site, query: string, stepFree: boolean): AmenityChip[] {
  if (!query.trim()) return [];
  return amenityChips(site, stepFree).filter((chip) => matchScore(query, [chip.words]) >= 0.7);
}

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
