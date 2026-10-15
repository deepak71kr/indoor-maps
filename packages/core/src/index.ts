import { FORMAT_VERSION } from '@innermap/schema';

export { buildGraph } from './graph/build-graph';
export type { Graph, GraphEdge, GraphEdgeKind, GraphLevel, GraphNode } from './graph/types';
export type { Result } from './result';
export { err, ok } from './result';
export type {
  CostSettings,
  EdgeCostModel,
  RouteContext,
  RouteCostRule,
  RouteProfile,
} from './routing/cost';
export {
  avoidTagsRule,
  DEFAULT_COST_SETTINGS,
  DefaultCostModel,
  penalizeTagsRule,
  stepFreeRule,
} from './routing/cost';
export type { Path, RouterOptions } from './routing/router';
export { Router } from './routing/router';
export type { Site } from './site/site';
export { loadSite } from './site/site';
export type { Destination, Route, RouteError, RouteRequest } from './usecases/find-route';
export { findRoute } from './usecases/find-route';

/** Map file format version this build of core understands. */
export function supportedFormat(): number {
  return FORMAT_VERSION;
}
