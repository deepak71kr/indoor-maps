import type { GraphEdge, GraphNode } from '../graph/types';
import type { MessageKey } from '../i18n/en';
import type { Translator } from '../i18n/translator';
import { createTranslator, finishSentence } from '../i18n/translator';
import type { Site } from '../site/site';
import type { Route } from '../usecases/find-route';
import type { Turn } from './geometry';
import { classifyTurn, heading, turnAngle } from './geometry';

export type StepIcon = Turn | 'walk' | 'lift' | 'stairs' | 'arrive';

/**
 * One card the visitor sees; they tap "✓ I'm here" on reaching `target`.
 * The last step is always `kind: 'arrive'` — the Arrived screen's message, not a card to confirm.
 */
export interface Step {
  readonly kind: 'walk' | 'ride' | 'arrive';
  readonly text: string;
  readonly icon: StepIcon;
  /** Node the visitor confirms at the end of this step. */
  readonly target: string;
  /** Floor where the step ends. */
  readonly levelId: string;
  readonly levelName: string;
  readonly levelColor: string;
  /** Approximate walking distance for this step (0 for lift/stairs rides). */
  readonly meters: number;
}

export interface DirectionsOptions {
  /** Heading the visitor faces at the start — a QR sticker's `facing`. Unknown → "walk to…". */
  readonly startFacing?: number;
  readonly translator?: Translator;
}

/** A straight stretch longer than this gets an extra "keep going" step at a named landmark. */
const REASSURE_AFTER_METERS = 30;
/** A final hop shorter than this into a door becomes "Radiology is on your LEFT". */
const DOOR_SPUR_MAX_METERS = 6;

type Translate = Translator['t'];

interface WalkSegment {
  readonly type: 'walk';
  readonly nodes: GraphNode[];
  readonly edges: GraphEdge[];
}
interface RideSegment {
  readonly type: 'ride';
  readonly kind: 'lift' | 'stairs';
  readonly connector: string | undefined;
  readonly from: GraphNode;
  to: GraphNode;
}
type Segment = WalkSegment | RideSegment;

/** How the visitor arrived at the start of a walking segment. */
interface Entry {
  readonly heading: number | null;
  /** Wraps the segment's first sentence, e.g. "exit Lift A, then {sentence}". */
  readonly prefix: ((sentence: string) => string) | null;
}

/**
 * Turns a route into visitor steps (docs/LOW_LEVEL_DESIGN.md §5.3):
 * - straight stretches merge into one step; a step starts wherever the visitor must turn;
 * - every step names a landmark; unnamed dots are never steps unless they are turns;
 * - a floor change is three steps: walk to the lift → ride → exit and walk on;
 * - the first step uses the QR sticker's facing; the last says which side the door is on.
 */
export function buildDirections(site: Site, route: Route, options: DirectionsOptions = {}): Step[] {
  const t = (options.translator ?? createTranslator()).t;
  const levels = new Map(site.graph.levels.map((l) => [l.id, l]));
  const connectorNames = new Map(site.map.connectors.map((c) => [c.id, c.name]));
  const steps: Step[] = [];

  const step = (s: Omit<Step, 'levelName' | 'levelColor' | 'text'> & { text: string }): void => {
    const level = levels.get(s.levelId);
    steps.push({
      ...s,
      text: finishSentence(s.text),
      levelName: level?.name ?? s.levelId,
      levelColor: level?.color ?? 'slate',
    });
  };

  const end = route.nodes[route.nodes.length - 1];
  if (!end) return steps;
  const place = placeName(route, end, t);

  if (route.edges.length === 0) {
    step({
      kind: 'arrive',
      text: t('arrive.already', { place }),
      icon: 'arrive',
      target: end.id,
      levelId: end.level,
      meters: 0,
    });
    return steps;
  }

  const segments = splitSegments(route);
  let entry: Entry = {
    heading: options.startFacing ?? null,
    prefix:
      options.startFacing === undefined ? null : (sentence) => t('prefix.start', { sentence }),
  };
  let arrivalSide: Turn | null | undefined; // undefined = no door spur at the end

  segments.forEach((segment, index) => {
    if (segment.type === 'ride') {
      const name = (segment.connector && connectorNames.get(segment.connector)) ?? segment.kind;
      const up =
        (levels.get(segment.to.level)?.ord ?? 0) > (levels.get(segment.from.level)?.ord ?? 0);
      const key: MessageKey = `ride.${segment.kind}.${up ? 'up' : 'down'}`;
      const level = levels.get(segment.to.level)?.name ?? segment.to.level;
      step({
        kind: 'ride',
        text: t(key, { connector: name, level }),
        icon: segment.kind,
        target: segment.to.id,
        levelId: segment.to.level,
        meters: 0,
      });
      // People turn around inside a lift and leave through the same door; on stairs we can't tell.
      entry = {
        heading:
          segment.kind === 'lift' && entry.heading !== null ? (entry.heading + 180) % 360 : null,
        prefix:
          segment.kind === 'lift'
            ? (sentence) => t('prefix.exit.lift', { sentence, connector: name })
            : (sentence) => t('prefix.exit.stairs', { sentence, level }),
      };
      return;
    }

    const isLast = index === segments.length - 1;
    const result = walkSteps(segment, entry, isLast, t);
    for (const s of result.steps) step(s);
    if (isLast) arrivalSide = result.arrivalSide;
    entry = { heading: result.exitHeading, prefix: null };
  });

  const locked = route.arrival.room?.visibility === 'locked';
  const sideKey = arrivalSide ? sideMessage(arrivalSide) : null;
  const arriveText = sideKey
    ? t('arrive.side', { place, side: t(sideKey) })
    : t('arrive.here', { place });
  const lastSegment = segments[segments.length - 1];
  const spurMeters =
    arrivalSide !== undefined && lastSegment?.type === 'walk'
      ? (lastSegment.edges.at(-1)?.length ?? 0)
      : 0;
  step({
    kind: 'arrive',
    text: locked ? `${finishSentence(arriveText)} ${t('arrive.locked')}` : arriveText,
    icon: 'arrive',
    target: end.id,
    levelId: end.level,
    meters: Math.round(spurMeters),
  });
  return steps;
}

function splitSegments(route: Route): Segment[] {
  const segments: Segment[] = [];
  route.edges.forEach((edge, i) => {
    const from = route.nodes[i];
    const to = route.nodes[i + 1];
    if (!from || !to) return;
    const last = segments[segments.length - 1];
    if (edge.kind === 'lift' || edge.kind === 'stairs') {
      if (last?.type === 'ride' && last.connector === edge.connector) last.to = to;
      else segments.push({ type: 'ride', kind: edge.kind, connector: edge.connector, from, to });
    } else if (last?.type === 'walk') {
      last.nodes.push(to);
      last.edges.push(edge);
    } else {
      segments.push({ type: 'walk', nodes: [from, to], edges: [edge] });
    }
  });
  return segments;
}

interface WalkResult {
  readonly steps: Array<Omit<Step, 'levelName' | 'levelColor'>>;
  /** Heading when the segment ends (null if unknown). */
  readonly exitHeading: number | null;
  /** For the final segment: side of the destination door, null if unknown, undefined if no door spur. */
  readonly arrivalSide: Turn | null | undefined;
}

function walkSteps(segment: WalkSegment, entry: Entry, isLast: boolean, t: Translate): WalkResult {
  const { nodes, edges } = segment;
  const last = nodes.length - 1;
  const headings = edges.map((_edge, j) => {
    const a = nodes[j];
    const b = nodes[j + 1];
    return a && b ? heading(a, b) : null;
  });
  /** Heading arriving at node j (last known one before it), or the entry heading at node 0. */
  const headingInto = (j: number): number | null => {
    for (let i = j - 1; i >= 0; i--) if (headings[i] != null) return headings[i] ?? null;
    return entry.heading;
  };
  const headingOutOf = (j: number): number | null => {
    for (let i = j; i < headings.length; i++) if (headings[i] != null) return headings[i] ?? null;
    return null;
  };
  const turnAt = (j: number): Turn | null => {
    const into = headingInto(j);
    const out = headingOutOf(j);
    return into === null || out === null ? null : classifyTurn(turnAngle(into, out));
  };

  // 1. Decision points: start, every turn, long straight stretches (at a named landmark), end.
  const decisions = [0];
  let sinceLast = edges[0]?.length ?? 0;
  for (let j = 1; j < last; j++) {
    const turn = turnAt(j);
    const reassure = sinceLast >= REASSURE_AFTER_METERS && nodes[j]?.landmark !== undefined;
    if ((turn !== null && turn !== 'straight') || reassure) {
      decisions.push(j);
      sinceLast = 0;
    }
    sinceLast += edges[j]?.length ?? 0;
  }
  const finalNode = nodes[last];
  const lastEdge = edges[last - 1];
  const doorSpur =
    isLast &&
    (finalNode?.kind === 'door' || finalNode?.kind === 'entrance') &&
    lastEdge !== undefined &&
    lastEdge.length <= DOOR_SPUR_MAX_METERS;
  if (doorSpur && !decisions.includes(last - 1)) decisions.push(last - 1);
  decisions.push(last);

  // 2. One step per stretch between decision points.
  const steps: Array<Omit<Step, 'levelName' | 'levelColor'>> = [];
  let arrivalSide: Turn | null | undefined;
  for (let d = 0; d < decisions.length - 1; d++) {
    const a = decisions[d] ?? 0;
    const b = decisions[d + 1] ?? last;
    if (doorSpur && b === last) {
      arrivalSide = turnAt(a);
      break;
    }
    const target = nodes[b];
    if (!target) continue;
    const meters = edges.slice(a, b).reduce((sum, e) => sum + e.length, 0);
    const via = nodes.slice(a + 1, b).find((n) => n.landmark !== undefined)?.landmark;
    const turn = turnAt(a);
    const targetLabel = target.landmark ?? t('target.unnamed', { meters: Math.round(meters) });

    const base: MessageKey =
      turn === null ? 'walk.towards' : turn === 'straight' ? 'walk.straight' : 'walk.turn';
    const key = (via ? `${base}.via` : base) as MessageKey;
    let text = t(key, {
      target: targetLabel,
      ...(via ? { via } : {}),
      ...(turn ? { turn: t(`turn.${turn}`) } : {}),
    });
    if (d === 0 && entry.prefix) text = entry.prefix(text);
    steps.push({
      kind: 'walk',
      text,
      icon: turn ?? 'walk',
      target: target.id,
      levelId: target.level,
      meters: Math.round(meters),
    });
  }

  return {
    steps,
    exitHeading: headingInto(last + 1),
    arrivalSide: doorSpur ? (arrivalSide ?? null) : undefined,
  };
}

function sideMessage(turn: Turn): MessageKey {
  switch (turn) {
    case 'straight':
      return 'side.ahead';
    case 'slight-left':
    case 'left':
      return 'side.left';
    case 'slight-right':
    case 'right':
      return 'side.right';
    case 'u-turn':
      return 'side.behind';
  }
}

function placeName(route: Route, end: GraphNode, t: Translate): string {
  const { room, amenity } = route.arrival;
  if (room) return room.name;
  if (amenity) return amenity.name ?? t(`amenity.${amenity.kind}`);
  return end.landmark ?? end.id;
}
