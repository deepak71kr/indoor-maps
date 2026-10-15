/**
 * Map quality checks that need the graph (docs/LOW_LEVEL_DESIGN.md §8 validation rules).
 * The file-format checks (ids, references) live in @innermap/schema/validate; these find
 * problems a visitor would actually feel: places nobody can reach, turns with no landmark,
 * very long stretches with nothing to confirm, lift stops not joined to any corridor.
 */
import type { MapFile } from '@innermap/schema';
import { classifyTurn, heading, turnAngle } from '../directions/geometry';
import type { Graph } from '../graph/types';
import { buildGraph } from '../graph/build-graph';

export type CheckCode =
  | 'no-entrance'
  | 'unreachable'
  | 'unnamed-decision-point'
  | 'long-line'
  | 'stop-not-connected'
  | 'unnamed-door';

export interface CheckIssue {
  readonly severity: 'error' | 'warning';
  readonly code: CheckCode;
  readonly message: string;
  /** What to zoom to in the editor. */
  readonly target: { readonly node: string } | { readonly edge: readonly [string, string] } | null;
}

/** A straight stretch longer than this needs a dot (a step) in between. */
export const LONG_LINE_METERS = 30;

export function checkMap(map: MapFile, graph: Graph = buildGraph(map)): CheckIssue[] {
  const issues: CheckIssue[] = [];
  const nodes = graph.nodes;

  // 1. Reachability from the entrances (everything a visitor might start from).
  const entrances = [...nodes.values()].filter((n) => n.kind === 'entrance').map((n) => n.id);
  if (entrances.length === 0 && nodes.size > 0) {
    issues.push({
      severity: 'warning',
      code: 'no-entrance',
      message: 'No entrance yet — mark at least one dot as "Entrance".',
      target: null,
    });
  }
  const starts = entrances.length > 0 ? entrances : [...nodes.keys()].slice(0, 1);
  const reached = new Set(starts);
  const queue = [...starts];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    for (const edge of graph.outgoing(id)) {
      if (!reached.has(edge.to)) {
        reached.add(edge.to);
        queue.push(edge.to);
      }
    }
  }
  for (const n of nodes.values()) {
    if (reached.has(n.id)) continue;
    issues.push({
      severity: 'error',
      code: 'unreachable',
      message: `${n.landmark ?? n.id} can't be reached from ${entrances.length > 0 ? 'any entrance' : 'the rest of the map'}.`,
      target: { node: n.id },
    });
  }

  // 2. Decision points without a landmark (visitors would get "the corner about 12 m ahead").
  const sameFloorNeighbours = (id: string) =>
    graph
      .outgoing(id)
      .filter((e) => e.kind !== 'lift' && e.kind !== 'stairs')
      .map((e) => e.to);
  for (const n of nodes.values()) {
    if (n.landmark) continue;
    const near = [...new Set(sameFloorNeighbours(n.id))];
    let decision = near.length >= 3;
    if (near.length === 2) {
      const [a, b] = near.map((id) => nodes.get(id));
      const into = a ? heading(a, n) : null;
      const out = b ? heading(n, b) : null;
      decision = into !== null && out !== null && classifyTurn(turnAngle(into, out)) !== 'straight';
    }
    if (n.kind === 'door') {
      issues.push({
        severity: 'warning',
        code: 'unnamed-door',
        message: `Door ${n.id} has no name — visitors won't know which door it is.`,
        target: { node: n.id },
      });
    } else if (decision) {
      issues.push({
        severity: 'warning',
        code: 'unnamed-decision-point',
        message: `Visitors turn at ${n.id} — give it a landmark they can see.`,
        target: { node: n.id },
      });
    }
  }

  // 3. Long stretches with nothing to confirm.
  for (const e of map.edges) {
    const a = nodes.get(e.a);
    const b = nodes.get(e.b);
    if (!a || !b) continue;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length > LONG_LINE_METERS) {
      issues.push({
        severity: 'warning',
        code: 'long-line',
        message: `Line ${a.landmark ?? a.id} → ${b.landmark ?? b.id} is ${Math.round(length)} m with no dot in between.`,
        target: { edge: [e.a, e.b] },
      });
    }
  }

  // 4. Lift / stair stops that no corridor reaches.
  for (const c of map.connectors) {
    for (const stop of Object.values(c.stops)) {
      if (sameFloorNeighbours(stop).length > 0) continue;
      const level = nodes.get(stop)?.level ?? '';
      issues.push({
        severity: 'error',
        code: 'stop-not-connected',
        message: `${c.name} on ${graph.levels.find((l) => l.id === level)?.name ?? level} isn't joined to a corridor — draw a path to it.`,
        target: { node: stop },
      });
    }
  }

  // Errors first, then warnings; stable otherwise.
  return issues.sort((x, y) => Number(x.severity === 'warning') - Number(y.severity === 'warning'));
}
