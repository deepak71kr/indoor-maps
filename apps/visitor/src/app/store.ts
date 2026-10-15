import type { Action, State } from './state';
import { reducer } from './state';

export interface Store {
  getState(): State;
  dispatch(action: Action): void;
  subscribe(listener: (state: State) => void): () => void;
}

export function createStore(initial: State): Store {
  let state = initial;
  const listeners = new Set<(state: State) => void>();
  return {
    getState: () => state,
    dispatch(action) {
      const next = reducer(state, action);
      if (next === state) return;
      state = next;
      for (const listener of listeners) listener(state);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
