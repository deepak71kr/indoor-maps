import type { MapNode } from '@innermap/schema';

/** Same-floor kinds come from map edges; `lift` and `stairs` come from connectors. */
export type GraphEdgeKind = 'walk' | 'ramp' | 'outdoor' | 'lift' | 'stairs';

export interface GraphNode {
  readonly id: string;
  readonly level: string;
  readonly x: number;
  readonly y: number;
  readonly kind: MapNode['kind'];
  /** Present only on dots that visitors see as steps. */
  readonly landmark?: string;
}

/** A directed, traversable line. Two-way map edges become two GraphEdges. */
export interface GraphEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: GraphEdgeKind;
  /** Horizontal length in meters (0 when a lift stop sits exactly above another). */
  readonly length: number;
  /** Floors travelled, counting skipped ones (0 on the same floor). */
  readonly floors: number;
  readonly tags: readonly string[];
  /** Connector id for lift/stairs edges. */
  readonly connector?: string;
}

export interface GraphLevel {
  readonly id: string;
  readonly name: string;
  readonly ord: number;
  /** Floor color key (teal, amber…) used across the UI. */
  readonly color: string;
  /** Position when levels are sorted by `ord` (0 = lowest). */
  readonly rank: number;
  /** Building this floor belongs to; absent on shared levels (ground / campus). */
  readonly building?: string;
}

export interface Graph {
  readonly nodes: ReadonlyMap<string, GraphNode>;
  /** Sorted lowest to highest. */
  readonly levels: readonly GraphLevel[];
  outgoing(nodeId: string): readonly GraphEdge[];
  edges(): Iterable<GraphEdge>;
}
