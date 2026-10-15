import type { GraphEdge } from '../graph/types';

/** Who is travelling, and how. Grows over time (e.g. stretcher, avoid crowds). */
export interface RouteProfile {
  readonly stepFree?: boolean;
}

export interface RouteContext {
  readonly profile: RouteProfile;
}

/** The base price of an edge before any rule is applied. */
export interface EdgeCostModel {
  cost(edge: GraphEdge): number;
}

/**
 * Adjusts an edge's cost. Return `Infinity` to forbid the edge, or `cost` to leave it alone.
 * Rules should only ever INCREASE cost — the A* heuristic assumes base costs are a lower bound.
 */
export interface RouteCostRule {
  readonly id: string;
  adjust(edge: GraphEdge, cost: number, ctx: RouteContext): number;
}

/** Defaults from docs/LOW_LEVEL_DESIGN.md §5.1; tunable per site later. */
export interface CostSettings {
  readonly walkPerMeter: number;
  readonly rampPerMeter: number;
  readonly outdoorPerMeter: number;
  readonly stairsPerMeter: number;
  readonly stairsPerFloor: number;
  /** Average wait for the lift to arrive. */
  readonly liftWait: number;
  readonly liftPerFloor: number;
}

export const DEFAULT_COST_SETTINGS: CostSettings = {
  walkPerMeter: 1,
  rampPerMeter: 1.2,
  outdoorPerMeter: 1,
  stairsPerMeter: 2,
  stairsPerFloor: 10,
  liftWait: 20,
  liftPerFloor: 8,
};

export class DefaultCostModel implements EdgeCostModel {
  constructor(private readonly settings: CostSettings = DEFAULT_COST_SETTINGS) {}

  cost(edge: GraphEdge): number {
    const s = this.settings;
    switch (edge.kind) {
      case 'walk':
        return edge.length * s.walkPerMeter;
      case 'ramp':
        return edge.length * s.rampPerMeter;
      case 'outdoor':
        return edge.length * s.outdoorPerMeter;
      case 'stairs':
        return edge.length * s.stairsPerMeter + edge.floors * s.stairsPerFloor;
      case 'lift':
        return edge.length * s.walkPerMeter + s.liftWait + edge.floors * s.liftPerFloor;
    }
  }
}

// ---- Built-in rules (configured by industry packs as data, see LLD §3) ----

/** Wheelchairs, stretchers, prams: no stairs and no edges tagged `steps`. */
export const stepFreeRule: RouteCostRule = {
  id: 'step-free',
  adjust: (edge, cost, ctx) =>
    ctx.profile.stepFree && (edge.kind === 'stairs' || edge.tags.includes('steps'))
      ? Number.POSITIVE_INFINITY
      : cost,
};

/** Forbid edges carrying any of these tags (e.g. `hazard`, `forklift-lane`). */
export function avoidTagsRule(tags: readonly string[]): RouteCostRule {
  return {
    id: `avoid-tags:${tags.join(',')}`,
    adjust: (edge, cost) =>
      edge.tags.some((t) => tags.includes(t)) ? Number.POSITIVE_INFINITY : cost,
  };
}

/** Make edges with these tags more expensive (factor ≥ 1), e.g. `ppe-required` × 3. */
export function penalizeTagsRule(tags: readonly string[], factor: number): RouteCostRule {
  const safeFactor = Math.max(1, factor);
  return {
    id: `penalize-tags:${tags.join(',')}`,
    adjust: (edge, cost) => (edge.tags.some((t) => tags.includes(t)) ? cost * safeFactor : cost),
  };
}
