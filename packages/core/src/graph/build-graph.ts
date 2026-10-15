import type { Connector, MapFile } from '@innermap/schema';
import type { Graph, GraphEdge, GraphLevel, GraphNode } from './types';

/**
 * Turns a (validated) map file into a routable graph:
 * - same-floor edges get their length from node positions; two-way edges become two directed edges;
 * - a lift joins EVERY pair of its stops (you ride G → 4 directly, even past skipped floors);
 * - stairs join only neighbouring stops (you climb flight by flight).
 */
export function buildGraph(map: MapFile): Graph {
  const levels: GraphLevel[] = [...map.levels]
    .sort((a, b) => a.ord - b.ord)
    .map((level, rank) => ({ id: level.id, name: level.name, ord: level.ord, rank }));
  const rankOf = new Map(levels.map((l) => [l.id, l.rank]));

  const nodes = new Map<string, GraphNode>();
  for (const n of map.nodes) {
    nodes.set(n.id, {
      id: n.id,
      level: n.lvl,
      x: n.x,
      y: n.y,
      kind: n.kind,
      ...(n.landmark !== undefined && { landmark: n.landmark }),
    });
  }

  const adjacency = new Map<string, GraphEdge[]>();
  const add = (edge: GraphEdge) => {
    const list = adjacency.get(edge.from);
    if (list) list.push(edge);
    else adjacency.set(edge.from, [edge]);
  };
  const lengthBetween = (a: string, b: string): number => {
    const na = nodes.get(a);
    const nb = nodes.get(b);
    return na && nb ? Math.hypot(nb.x - na.x, nb.y - na.y) : Number.POSITIVE_INFINITY;
  };

  for (const e of map.edges) {
    const base = {
      kind: e.kind ?? 'walk',
      length: lengthBetween(e.a, e.b),
      floors: 0,
      tags: e.tags ?? [],
    } as const;
    add({ ...base, from: e.a, to: e.b });
    if (!e.oneWay) add({ ...base, from: e.b, to: e.a });
  }

  for (const connector of map.connectors) {
    for (const [a, b] of connectorPairs(connector, rankOf)) {
      const floors = Math.abs((rankOf.get(a.level) ?? 0) - (rankOf.get(b.level) ?? 0));
      const base = {
        kind: connector.kind,
        length: lengthBetween(a.node, b.node),
        floors,
        tags: [],
        connector: connector.id,
      } as const;
      add({ ...base, from: a.node, to: b.node });
      add({ ...base, from: b.node, to: a.node });
    }
  }

  const empty: readonly GraphEdge[] = [];
  return {
    nodes,
    levels,
    outgoing: (nodeId) => adjacency.get(nodeId) ?? empty,
    *edges() {
      for (const list of adjacency.values()) yield* list;
    },
  };
}

interface Stop {
  readonly level: string;
  readonly node: string;
}

function connectorPairs(
  connector: Connector,
  rankOf: ReadonlyMap<string, number>,
): Array<readonly [Stop, Stop]> {
  const stops: Stop[] = Object.entries(connector.stops)
    .map(([level, node]) => ({ level, node }))
    .sort((a, b) => (rankOf.get(a.level) ?? 0) - (rankOf.get(b.level) ?? 0));

  const pairs: Array<readonly [Stop, Stop]> = [];
  if (connector.kind === 'stairs') {
    for (let i = 1; i < stops.length; i++) pairs.push([stops[i - 1] as Stop, stops[i] as Stop]);
  } else {
    for (let i = 0; i < stops.length; i++)
      for (let j = i + 1; j < stops.length; j++) pairs.push([stops[i] as Stop, stops[j] as Stop]);
  }
  return pairs;
}
