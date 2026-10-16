import type { Graph, GraphEdge, GraphNode } from '../graph/types';
import type { EdgeCostModel, RouteContext, RouteCostRule } from './cost';
import { blockedRule, closedRule, DefaultCostModel, stepFreeRule } from './cost';
import { PriorityQueue } from './priority-queue';

export interface Path {
  /** Node ids from start to the reached target, inclusive. */
  readonly nodes: readonly string[];
  /** Edges between consecutive nodes (`nodes.length - 1` of them). */
  readonly edges: readonly GraphEdge[];
  /** Total cost after rules (comparable between routes, not meters). */
  readonly cost: number;
  /** The target that was reached (one of the requested targets). */
  readonly target: string;
}

export interface RouterOptions {
  readonly costModel?: EdgeCostModel;
  /** Applied in order to every edge. Defaults to step-free, closed lines, blocked lines. */
  readonly rules?: readonly RouteCostRule[];
}

/**
 * A* search over the graph to the CHEAPEST of several targets — the same search answers
 * "go to Radiology (2 doors)" and "nearest toilet".
 *
 * Heuristic: straight-line distance to the nearest target, scaled so it never overestimates
 * (it ignores floors, so it stays admissible across lifts and stairs).
 */
export class Router {
  private readonly costModel: EdgeCostModel;
  private readonly rules: readonly RouteCostRule[];
  private readonly heuristicScale: number;

  constructor(
    private readonly graph: Graph,
    options: RouterOptions = {},
  ) {
    this.costModel = options.costModel ?? new DefaultCostModel();
    this.rules = options.rules ?? [stepFreeRule, closedRule, blockedRule];
    this.heuristicScale = this.lowestCostPerMeter();
  }

  shortestPath(from: string, targets: ReadonlySet<string>, ctx: RouteContext): Path | null {
    const start = this.graph.nodes.get(from);
    const targetNodes = [...targets]
      .map((id) => this.graph.nodes.get(id))
      .filter((n): n is GraphNode => n !== undefined);
    if (!start || targetNodes.length === 0) return null;

    const h = (node: GraphNode) => {
      let best = Number.POSITIVE_INFINITY;
      for (const t of targetNodes) best = Math.min(best, Math.hypot(t.x - node.x, t.y - node.y));
      return best * this.heuristicScale;
    };

    const bestCost = new Map<string, number>([[from, 0]]);
    const cameBy = new Map<string, GraphEdge>();
    const done = new Set<string>();
    const open = new PriorityQueue<string>();
    open.push(from, h(start));

    for (let current = open.pop(); current !== undefined; current = open.pop()) {
      if (done.has(current)) continue;
      done.add(current);
      const costHere = bestCost.get(current) ?? Number.POSITIVE_INFINITY;
      if (targets.has(current)) return this.buildPath(from, current, costHere, cameBy);

      for (const edge of this.graph.outgoing(current)) {
        if (done.has(edge.to)) continue;
        const step = this.edgeCost(edge, ctx);
        if (!Number.isFinite(step)) continue;
        const next = costHere + step;
        if (next < (bestCost.get(edge.to) ?? Number.POSITIVE_INFINITY)) {
          const node = this.graph.nodes.get(edge.to);
          if (!node) continue;
          bestCost.set(edge.to, next);
          cameBy.set(edge.to, edge);
          open.push(edge.to, next + h(node));
        }
      }
    }
    return null;
  }

  /** Base cost, then every rule in order. Negative results are treated as forbidden. */
  edgeCost(edge: GraphEdge, ctx: RouteContext): number {
    let cost = this.costModel.cost(edge);
    for (const rule of this.rules) cost = rule.adjust(edge, cost, ctx);
    return cost >= 0 ? cost : Number.POSITIVE_INFINITY;
  }

  private buildPath(
    from: string,
    target: string,
    cost: number,
    cameBy: ReadonlyMap<string, GraphEdge>,
  ): Path {
    const edges: GraphEdge[] = [];
    for (let at = target; at !== from;) {
      const edge = cameBy.get(at);
      if (!edge) break;
      edges.push(edge);
      at = edge.from;
    }
    edges.reverse();
    return { nodes: [from, ...edges.map((e) => e.to)], edges, cost, target };
  }

  /** Smallest base cost per horizontal meter over all edges, capped at 1. */
  private lowestCostPerMeter(): number {
    let scale = 1;
    for (const edge of this.graph.edges()) {
      if (edge.length > 0) scale = Math.min(scale, this.costModel.cost(edge) / edge.length);
    }
    return Math.max(0, scale);
  }
}
