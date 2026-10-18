/** What the 2D map shows for the current screen. Pure: tested without a DOM. */
import type { Site } from '@innermap/core';
import { facingAt } from '@innermap/core';
import type { State } from './state';
import { currentNode } from './state';

export interface MapScene {
  readonly site: Site;
  /** Floor to show — the visitor's, or a tapped room's — unless they pick another one. */
  readonly levelId: string;
  /** Floor the visitor is on (the floor buttons mark it with a dot). */
  readonly youLevel: string;
  /** A room to highlight (its card is open). */
  readonly selected?: string;
  /** Lines reported blocked (`edgeKey`s), drawn red. */
  readonly blocked: readonly string[];
  /** Route preview: the time bubble on the route ("4 min"), like Google's route callouts. */
  readonly bubble?: string;
  readonly here: string | null;
  /** Degrees clockwise from up (a QR sticker or the way they walked); null = unknown. */
  readonly facing: number | null;
  /** The route as node ids; empty before a destination is chosen. */
  readonly path: readonly string[];
  /** Index in `path` where the visitor stands: the route before it is drawn as walked. */
  readonly at: number;
  /** The checkpoint to reach next (pulses). */
  readonly next: string | null;
  /** Every checkpoint of the route in order (step targets, without the destination). */
  readonly checkpoints: readonly string[];
  /** How many checkpoints are already passed (drawn ✓ in grey). */
  readonly done: number;
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
  const checkpoints = steps.slice(0, -1).map((s) => s.target);
  const base = {
    site,
    levelId: level,
    youLevel: level,
    here,
    facing,
    path,
    at,
    checkpoints,
    done: 0,
    blocked: state.blocked,
  };

  switch (screen.name) {
    case 'choose':
      return { ...base, checkpoints: [], next: null, focus: [] };
    case 'place': {
      // Show the room on its own floor, centred, highlighted.
      const room = site.map.rooms.find((r) => r.id === screen.roomId);
      const door = room ? site.graph.nodes.get(room.doors[0] ?? '') : undefined;
      if (!room || !door) return { ...base, checkpoints: [], next: null, focus: [] };
      return {
        ...base,
        levelId: door.level,
        selected: room.id,
        checkpoints: [],
        path: [],
        at: 0,
        next: null,
        focus: [door.id],
      };
    }
    case 'preview':
      // The whole route, start to destination (the map shows the visitor's floor of it).
      return {
        ...base,
        next: null,
        focus: path,
      };
    case 'navigate': {
      if (screen.peek !== undefined) {
        // Looking ahead or back: frame that step's stretch, on its floor.
        const step = steps[screen.peek];
        const from = screen.peek > 0 ? path.indexOf(steps[screen.peek - 1]?.target ?? '') : 0;
        const to = step ? path.indexOf(step.target, Math.max(0, from)) : -1;
        return {
          ...base,
          ...(step && { levelId: step.levelId }),
          done: screen.step,
          next: steps[screen.step]?.target ?? null,
          focus: to >= 0 ? path.slice(Math.max(0, from), to + 1) : [here],
        };
      }
      // Frame this step and the one after, so the next turn is already in view.
      const next = steps[screen.step]?.target ?? null;
      const after = steps[screen.step + 1]?.target ?? next;
      const end = after ? path.indexOf(after, at) : -1;
      return {
        ...base,
        done: screen.step,
        next,
        focus: end >= at ? path.slice(at, end + 1) : [here],
      };
    }
    case 'arrived':
      return { ...base, done: checkpoints.length, next: null, focus: path.slice(-3) };
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
