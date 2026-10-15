import { FORMAT_VERSION } from '@innermap/schema';

export type { DirectionsOptions, Step, StepIcon } from './directions/build-directions';
export { buildDirections } from './directions/build-directions';
export type { Point, Turn } from './directions/geometry';
export type { CheckCode, CheckIssue } from './checks/check-map';
export { checkMap, LONG_LINE_METERS } from './checks/check-map';
export { buildGraph } from './graph/build-graph';
export type { MessageKey, Messages } from './i18n/en';
export { en } from './i18n/en';
export type { MessageParams, Translator } from './i18n/translator';
export { createTranslator } from './i18n/translator';
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
export type { Bounds, Segment } from './plan/plan';
export {
  boundsOf,
  containsPoint,
  doorGaps,
  facingAt,
  labelPoint,
  projectOnSegment,
  routeLines,
  shapePoints,
  shapeSides,
} from './plan/plan';
export type { Site } from './site/site';
export { loadSite } from './site/site';
export type { Destination, Route, RouteError, RouteRequest } from './usecases/find-route';
export { findRoute } from './usecases/find-route';

/** Map file format version this build of core understands. */
export function supportedFormat(): number {
  return FORMAT_VERSION;
}
