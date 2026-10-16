import type { Amenity, Building, MapFile, QrAnchor, Room } from '@innermap/schema';
import { buildGraph } from '../graph/build-graph';
import { containsPoint } from '../plan/plan';
import type { Graph } from '../graph/types';
import type { RouterOptions } from '../routing/router';
import { Router } from '../routing/router';

/** A loaded map, ready to answer questions: the graph, a router, and lookups. */
export interface Site {
  readonly map: MapFile;
  readonly graph: Graph;
  readonly router: Router;
  /** QR short code (case-insensitive) → node id. */
  nodeForQr(code: string): string | undefined;
  /** QR short code (case-insensitive) → the full anchor, including which way the reader faces. */
  findQr(code: string): QrAnchor | undefined;
  /** Room by id, number ("201") or exact name ("radiology"), case-insensitive. */
  findRoom(query: string): Room | undefined;
  /** All amenities of the given kinds. */
  amenitiesOfKind(kinds: readonly Amenity['kind'][]): readonly Amenity[];
  /**
   * The building a dot is in: its floor's building, or on a shared level the footprint it
   * stands in. Undefined outdoors and on sites without buildings.
   */
  buildingAt(nodeId: string): Building | undefined;
}

/** Expects a map that already passed `validateMapFile`. */
export function loadSite(map: MapFile, options: RouterOptions = {}): Site {
  const graph = buildGraph(map);
  const router = new Router(graph, options);

  const qr = new Map(map.qr.map((q) => [q.code.toUpperCase(), q]));
  const rooms = new Map<string, Room>();
  // Later entries never override earlier ones: id wins over number, number over name.
  const index = (key: string | undefined, room: Room) => {
    const k = key?.trim().toLowerCase();
    if (k && !rooms.has(k)) rooms.set(k, room);
  };
  for (const r of map.rooms) index(r.id, r);
  for (const r of map.rooms) index(r.number, r);
  for (const r of map.rooms) index(r.name, r);

  const buildings = new Map((map.buildings ?? []).map((b) => [b.id, b]));
  const levelBuilding = new Map(map.levels.map((l) => [l.id, l.building]));
  const footprints = map.levels.flatMap((level) =>
    (level.shapes ?? [])
      .filter((shape) => shape.kind === 'building' && shape.building !== undefined)
      .map((shape) => ({ level: level.id, shape })),
  );
  const buildingAt = (nodeId: string): Building | undefined => {
    const node = graph.nodes.get(nodeId);
    if (!node || buildings.size === 0) return undefined;
    const own = levelBuilding.get(node.level);
    if (own !== undefined) return buildings.get(own);
    const around = footprints.find((f) => f.level === node.level && containsPoint(f.shape, node));
    return around?.shape.building === undefined ? undefined : buildings.get(around.shape.building);
  };

  return {
    map,
    graph,
    router,
    nodeForQr: (code) => qr.get(code.trim().toUpperCase())?.node,
    findQr: (code) => qr.get(code.trim().toUpperCase()),
    findRoom: (query) => rooms.get(query.trim().toLowerCase()),
    amenitiesOfKind: (kinds) => map.amenities.filter((a) => kinds.includes(a.kind)),
    buildingAt,
  };
}
