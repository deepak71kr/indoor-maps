import type { Amenity, Room } from '@innermap/schema';
import type { GraphEdge, GraphNode } from '../graph/types';
import type { Result } from '../result';
import { err, ok } from '../result';
import type { RouteProfile } from '../routing/cost';
import type { Site } from '../site/site';

export type Destination =
  | { readonly type: 'room'; readonly roomId: string }
  | { readonly type: 'node'; readonly nodeId: string }
  | { readonly type: 'amenity'; readonly kinds: readonly Amenity['kind'][] };

export interface RouteRequest {
  /** Start node id (resolve QR codes with `site.nodeForQr` first). */
  readonly from: string;
  readonly to: Destination;
  readonly profile?: RouteProfile;
}

export interface Route {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly cost: number;
  /** Meters walked on floors and ramps (lift rides excluded). */
  readonly walkingMeters: number;
  /** Lift/stairs segments used. */
  readonly floorChanges: number;
  /** Where the route ends — e.g. the closer of a room's doors. */
  readonly arrival: {
    readonly nodeId: string;
    readonly room?: Room;
    readonly amenity?: Amenity;
  };
}

export type RouteError =
  | { readonly code: 'unknown-start'; readonly from: string }
  | { readonly code: 'unknown-destination' }
  | { readonly code: 'no-route' };

export function findRoute(site: Site, request: RouteRequest): Result<Route, RouteError> {
  if (!site.graph.nodes.has(request.from))
    return err({ code: 'unknown-start', from: request.from });

  const targets = resolveTargets(site, request.to);
  if (!targets || targets.size === 0) return err({ code: 'unknown-destination' });

  const router = site.routerFor(request.profile?.preference);
  const path = router.shortestPath(request.from, new Set(targets.keys()), {
    profile: request.profile ?? {},
  });
  if (!path) return err({ code: 'no-route' });

  const nodes = path.nodes
    .map((id) => site.graph.nodes.get(id))
    .filter((n): n is GraphNode => n !== undefined);
  const vertical = path.edges.filter((e) => e.kind === 'lift' || e.kind === 'stairs');

  return ok({
    nodes,
    edges: path.edges,
    cost: path.cost,
    walkingMeters: path.edges
      .filter((e) => e.kind !== 'lift' && e.kind !== 'stairs')
      .reduce((sum, e) => sum + e.length, 0),
    floorChanges: vertical.length,
    arrival: { nodeId: path.target, ...targets.get(path.target) },
  });
}

type ArrivalInfo = { room?: Room; amenity?: Amenity };

/** Destination → candidate end nodes, each with what is found there. */
function resolveTargets(site: Site, to: Destination): Map<string, ArrivalInfo> | null {
  switch (to.type) {
    case 'node':
      return site.graph.nodes.has(to.nodeId) ? new Map([[to.nodeId, {}]]) : null;
    case 'room': {
      const room = site.map.rooms.find((r) => r.id === to.roomId);
      return room ? new Map(room.doors.map((door) => [door, { room }])) : null;
    }
    case 'amenity': {
      const targets = new Map<string, ArrivalInfo>();
      for (const amenity of site.amenitiesOfKind(to.kinds))
        if (!targets.has(amenity.node)) targets.set(amenity.node, { amenity });
      return targets;
    }
  }
}
