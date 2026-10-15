/**
 * Visitor app state machine (docs/LOW_LEVEL_DESIGN.md §6). Pure: no DOM, no storage —
 * the reducer is unit-tested and the UI only renders `State` and dispatches `Action`s.
 */
import type { Destination, RouteError, Site, Step } from '@innermap/core';
import { buildDirections, findRoute } from '@innermap/core';

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
  readonly stepFree: boolean;
  /** One-off message, e.g. after re-routing. */
  readonly notice: 'rerouted' | null;
}

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
  | { readonly type: 'confirm' }
  | { readonly type: 'back' }
  | { readonly type: 'lost' }
  | { readonly type: 'found-way' }
  | { readonly type: 'toggle-step-free' }
  | { readonly type: 'new-destination' }
  | { readonly type: 'ask-position' };

export const initialState: State = {
  site: null,
  screen: { name: 'loading' },
  position: null,
  target: null,
  steps: [],
  stepFree: false,
  notice: null,
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
        const next = plan(s, action.position, state.target);
        const midTrip = state.screen.name === 'navigate' || state.screen.name === 'lost';
        return { ...next, notice: midTrip ? 'rerouted' : null };
      }
      return {
        ...s,
        position: action.position,
        target: null,
        steps: [],
        screen: { name: 'choose' },
      };
    }

    case 'choose':
      return s.position
        ? plan(s, s.position, action.target)
        : { ...s, target: action.target, screen: { name: 'where-am-i' } };

    case 'resume': {
      const planned = plan({ ...s, stepFree: action.stepFree }, action.position, action.target);
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
      if (s.screen.name !== 'navigate' || !s.target) return toggled;
      const node = currentNode(s);
      return node ? plan(toggled, { node }, s.target) : toggled;
    }

    case 'new-destination': {
      const node = currentNode(s);
      return {
        ...s,
        position: node ? { node } : s.position,
        target: null,
        steps: [],
        screen: { name: 'choose' },
      };
    }

    case 'ask-position':
      return { ...s, screen: { name: 'where-am-i' } };
  }
}

function plan(state: State, position: Position, target: Target): State {
  const { site } = state;
  if (!site) return state;
  const result = findRoute(site, {
    from: position.node,
    to: target.destination,
    profile: { stepFree: state.stepFree },
  });
  if (!result.ok) {
    return {
      ...state,
      position,
      target,
      steps: [],
      screen: { name: 'no-route', reason: result.error.code },
    };
  }
  const steps = buildDirections(
    site,
    result.value,
    position.facing === undefined ? {} : { startFacing: position.facing },
  );
  const screen: Screen = steps.length <= 1 ? { name: 'arrived' } : { name: 'navigate', step: 0 };
  return { ...state, position, target, steps, screen };
}
