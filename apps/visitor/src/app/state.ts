/**
 * Visitor app state machine (docs/LOW_LEVEL_DESIGN.md §6). Pure: no DOM, no storage —
 * the reducer is unit-tested and the UI only renders `State` and dispatches `Action`s.
 */
import type { Destination, RouteError, Site, Step } from '@innermap/core';
import { buildDirections, edgeKey, findRoute } from '@innermap/core';

export interface Position {
  readonly node: string;
  /** Which way the visitor faces (from a QR sticker); unknown otherwise. */
  readonly facing?: number;
  /** How we learned it, for the "re-routed" notice. */
  readonly source?: 'qr' | 'typed' | 'picked' | 'session';
}

export interface Target {
  readonly destination: Destination;
  /** What the visitor chose, e.g. "Radiology" or "Toilet". */
  readonly label: string;
}

export type Screen =
  | { readonly name: 'loading' }
  | { readonly name: 'error'; readonly message: string }
  | { readonly name: 'where-am-i' }
  | { readonly name: 'choose' }
  /** A room's card (tapped on the map or in a list): details + Directions / Start / Share. */
  | { readonly name: 'place'; readonly roomId: string }
  /** The whole route from start to destination, before walking (Google's "Start" screen). */
  | { readonly name: 'preview' }
  | { readonly name: 'navigate'; readonly step: number }
  | { readonly name: 'lost'; readonly step: number }
  | { readonly name: 'arrived' }
  | { readonly name: 'no-route'; readonly reason: RouteError['code'] };

export interface State {
  readonly site: Site | null;
  readonly screen: Screen;
  /** Where the current route starts. */
  readonly position: Position | null;
  readonly target: Target | null;
  readonly steps: readonly Step[];
  /** The route as node ids (for the map); empty without a route. */
  readonly path: readonly string[];
  readonly stepFree: boolean;
  /** Fastest (time, default) or shortest (distance). */
  readonly preference: 'fastest' | 'shortest';
  /** Lines the visitor reported blocked on this visit (`edgeKey`s); routes avoid them. */
  readonly blocked: readonly string[];
  /** One-off message, e.g. after re-routing. */
  readonly notice: 'rerouted' | 'blocked' | null;
  /** Rooms chosen recently, newest first (saved on the phone by main.ts). */
  readonly recent: readonly Target[];
}

/** Walking time indoors: ~1 m/s with people around, plus ~45 s per lift or stairs ride. */
export function walkMinutes(meters: number, rides: number): number {
  return Math.max(1, Math.round(meters / 60 + rides * 0.75));
}

/** Minutes and meters still to go from step `from`. */
export function tripStats(
  steps: readonly Step[],
  from: number,
): { minutes: number; meters: number } {
  const left = steps.slice(from);
  const meters = left.reduce((sum, s) => sum + s.meters, 0);
  return { minutes: walkMinutes(meters, left.filter((s) => s.kind === 'ride').length), meters };
}

/** How many recent destinations to remember. */
export const RECENT_MAX = 5;

export type Action =
  | { readonly type: 'map-loaded'; readonly site: Site }
  | { readonly type: 'map-failed'; readonly message: string }
  | { readonly type: 'set-position'; readonly position: Position }
  | { readonly type: 'choose'; readonly target: Target }
  | {
      readonly type: 'resume';
      readonly position: Position;
      readonly target: Target;
      readonly step: number;
      readonly stepFree: boolean;
    }
  | { readonly type: 'start' }
  | { readonly type: 'show-place'; readonly roomId: string }
  | { readonly type: 'close-place' }
  /** Preview: walk the other way (destination becomes the start). */
  | { readonly type: 'swap' }
  | { readonly type: 'recent-loaded'; readonly recent: readonly Target[] }
  | { readonly type: 'confirm' }
  | { readonly type: 'back' }
  | { readonly type: 'lost' }
  | { readonly type: 'found-way' }
  | { readonly type: 'toggle-step-free' }
  | { readonly type: 'set-preference'; readonly preference: 'fastest' | 'shortest' }
  /** "Path blocked?": the way ahead is closed — avoid it and route around from here. */
  | { readonly type: 'block-ahead' }
  | { readonly type: 'new-destination' }
  | { readonly type: 'ask-position' };

export const initialState: State = {
  site: null,
  screen: { name: 'loading' },
  position: null,
  target: null,
  steps: [],
  path: [],
  stepFree: false,
  preference: 'fastest',
  blocked: [],
  notice: null,
  recent: [],
};

/** The node the visitor is standing at right now. */
export function currentNode(state: State): string | null {
  const { screen, steps, position } = state;
  if (screen.name === 'navigate' || screen.name === 'lost') {
    return screen.step > 0 ? (steps[screen.step - 1]?.target ?? null) : (position?.node ?? null);
  }
  if (screen.name === 'arrived') return steps[steps.length - 1]?.target ?? position?.node ?? null;
  return position?.node ?? null;
}

export function reducer(state: State, action: Action): State {
  const s = { ...state, notice: null };
  switch (action.type) {
    case 'map-loaded':
      return { ...s, site: action.site, screen: { name: 'where-am-i' } };

    case 'map-failed':
      return { ...s, screen: { name: 'error', message: action.message } };

    case 'set-position': {
      const rerouting = state.target !== null && state.screen.name !== 'arrived';
      if (rerouting && state.target) {
        // Mid-trip: straight back to walking. Otherwise (a new start point): preview again.
        const midTrip = state.screen.name === 'navigate' || state.screen.name === 'lost';
        const next = plan(s, action.position, state.target, midTrip ? 'navigate' : 'preview');
        return { ...next, notice: midTrip ? 'rerouted' : null };
      }
      return {
        ...s,
        position: action.position,
        target: null,
        steps: [],
        path: [],
        screen: { name: 'choose' },
      };
    }

    case 'choose': {
      const remembered = { ...s, recent: remember(s.recent, action.target) };
      return remembered.position
        ? plan(remembered, remembered.position, action.target, 'preview')
        : { ...remembered, target: action.target, screen: { name: 'where-am-i' } };
    }

    case 'show-place':
      return s.site?.map.rooms.some((r) => r.id === action.roomId) &&
        ['choose', 'place', 'preview', 'arrived'].includes(s.screen.name)
        ? { ...s, screen: { name: 'place', roomId: action.roomId } }
        : state;

    case 'close-place':
      return s.screen.name === 'place' ? { ...s, screen: { name: 'choose' } } : state;

    case 'swap': {
      if (s.screen.name !== 'preview' || !s.site || !s.position) return state;
      const end = s.path[s.path.length - 1];
      const start = s.position.node;
      if (!end || end === start) return state;
      const startName = s.site.graph.nodes.get(start)?.landmark ?? start;
      return plan(
        s,
        { node: end, source: 'picked' },
        { destination: { type: 'node', nodeId: start }, label: startName },
        'preview',
      );
    }

    case 'recent-loaded':
      return { ...s, recent: action.recent.slice(0, RECENT_MAX) };

    case 'start':
      return s.screen.name === 'preview' ? { ...s, screen: { name: 'navigate', step: 0 } } : state;

    case 'resume': {
      const planned = plan(
        { ...s, stepFree: action.stepFree },
        action.position,
        action.target,
        'navigate',
      );
      if (planned.screen.name !== 'navigate') return planned;
      const last = Math.max(0, planned.steps.length - 2);
      return { ...planned, screen: { name: 'navigate', step: Math.min(action.step, last) } };
    }

    case 'confirm': {
      if (s.screen.name !== 'navigate') return state;
      const next = s.screen.step + 1;
      // The final step is the 'arrive' message, shown on the Arrived screen.
      return next >= s.steps.length - 1
        ? { ...s, screen: { name: 'arrived' } }
        : { ...s, screen: { name: 'navigate', step: next } };
    }

    case 'back':
      if (s.screen.name !== 'navigate') return state;
      return { ...s, screen: { name: 'navigate', step: Math.max(0, s.screen.step - 1) } };

    case 'lost':
      return s.screen.name === 'navigate'
        ? { ...s, screen: { name: 'lost', step: s.screen.step } }
        : state;

    case 'found-way':
      return s.screen.name === 'lost'
        ? { ...s, screen: { name: 'navigate', step: s.screen.step } }
        : state;

    case 'toggle-step-free': {
      const toggled = { ...s, stepFree: !s.stepFree };
      if (!s.target) return toggled;
      if (s.screen.name === 'preview' && s.position)
        return plan(toggled, s.position, s.target, 'preview');
      if (s.screen.name !== 'navigate') return toggled;
      const node = currentNode(s);
      return node ? plan(toggled, { node }, s.target, 'navigate') : toggled;
    }

    case 'set-preference': {
      const set = { ...s, preference: action.preference };
      if (!s.target) return set;
      if (s.screen.name === 'preview' && s.position)
        return plan(set, s.position, s.target, 'preview');
      if (s.screen.name !== 'navigate') return set;
      const node = currentNode(s);
      return node ? plan(set, { node }, s.target, 'navigate') : set;
    }

    case 'block-ahead': {
      if (s.screen.name !== 'navigate' || !s.target) return state;
      const here = currentNode(s);
      const at = here ? s.path.indexOf(here) : -1;
      const next = s.path[at + 1];
      if (!here || at < 0 || !next) return state;
      const blocked = [...new Set([...s.blocked, edgeKey(here, next)])];
      const replanned = plan({ ...s, blocked }, { node: here }, s.target, 'navigate');
      return { ...replanned, notice: replanned.screen.name === 'navigate' ? 'blocked' : null };
    }

    case 'new-destination': {
      const node = currentNode(s);
      return {
        ...s,
        position: node ? { node } : s.position,
        target: null,
        steps: [],
        path: [],
        screen: { name: 'choose' },
      };
    }

    case 'ask-position':
      return { ...s, screen: { name: 'where-am-i' } };
  }
}

/** Newest first, no duplicates; only rooms (amenity chips are one tap away anyway). */
function remember(recent: readonly Target[], target: Target): readonly Target[] {
  if (target.destination.type !== 'room') return recent;
  const id = target.destination.roomId;
  const others = recent.filter((r) => r.destination.type !== 'room' || r.destination.roomId !== id);
  return [target, ...others].slice(0, RECENT_MAX);
}

function plan(
  state: State,
  position: Position,
  target: Target,
  then: 'preview' | 'navigate',
): State {
  const { site } = state;
  if (!site) return state;
  const result = findRoute(site, {
    from: position.node,
    to: target.destination,
    profile: { stepFree: state.stepFree, preference: state.preference, blocked: state.blocked },
  });
  if (!result.ok) {
    return {
      ...state,
      position,
      target,
      steps: [],
      path: [],
      screen: { name: 'no-route', reason: result.error.code },
    };
  }
  const steps = buildDirections(
    site,
    result.value,
    position.facing === undefined ? {} : { startFacing: position.facing },
  );
  const screen: Screen =
    steps.length <= 1
      ? { name: 'arrived' }
      : then === 'preview'
        ? { name: 'preview' }
        : { name: 'navigate', step: 0 };
  const path = result.value.nodes.map((n) => n.id);
  return { ...state, position, target, steps, path, screen };
}
