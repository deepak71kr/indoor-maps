/** What the 2D map shows for the current screen. Pure: tested without a DOM. */
import type { Site } from '@innermap/core';
import { facingAt } from '@innermap/core';
import type { State } from './state';
import { currentNode } from './state';

export interface MapScene {
  readonly site: Site;
  /** Floor the visitor is on — shown unless they pick another one. */
  readonly levelId: string;
  readonly here: string | null;
  /** Degrees clockwise from up (a QR sticker or the way they walked); null = unknown. */
  readonly facing: number | null;
  /** The route as node ids; empty before a destination is chosen. */
  readonly path: readonly string[];
  /** Index in `path` where the visitor stands: the route before it is drawn as walked. */
  readonly at: number;
  /** The checkpoint to reach next (pulses). */
  readonly next: string | null;
  /** Nodes to fit in view (empty = the whole floor); changing them re-frames the map. */
  readonly focus: readonly string[];
}

/** The map for this screen, or null on screens without one (loading, lost, errors…). */
export function sceneFor(state: State): MapScene | null {
  const { site, screen, path, steps } = state;
  const here = currentNode(state);
  const level = here ? site?.graph.nodes.get(here)?.level : undefined;
  if (!site || !here || !level) return null;
  const at = Math.max(0, path.indexOf(here));
  const facing = facingAt(site.graph, path.length > 0 ? path : [here], at, startFacing(state, at));
  const base = { site, levelId: level, here, facing, path, at };

  switch (screen.name) {
    case 'choose':
      return { ...base, next: null, focus: [] };
    case 'navigate': {
      // Frame this step and the one after, so the next turn is already in view.
      const next = steps[screen.step]?.target ?? null;
      const after = steps[screen.step + 1]?.target ?? next;
      const end = after ? path.indexOf(after, at) : -1;
      return { ...base, next, focus: end >= at ? path.slice(at, end + 1) : [here] };
    }
    case 'arrived':
      return { ...base, next: null, focus: path.slice(-3) };
    default:
      return null;
  }
}

/** The QR sticker's facing only counts where it was scanned. */
function startFacing(state: State, at: number): number | undefined {
  return at === 0 && state.position?.node === currentNode(state)
    ? state.position.facing
    : undefined;
}
