import type { MapFile } from '@innermap/schema';
import type { Command } from './commands';

const LIMIT = 200;

export interface History {
  readonly past: readonly Command[];
  readonly future: readonly Command[];
}

export const emptyHistory: History = { past: [], future: [] };

export interface Applied {
  readonly doc: MapFile;
  readonly history: History;
}

export function execute(doc: MapFile, history: History, command: Command): Applied {
  return {
    doc: command.apply(doc),
    history: { past: [...history.past, command].slice(-LIMIT), future: [] },
  };
}

export function undo(doc: MapFile, history: History): Applied | null {
  const command = history.past[history.past.length - 1];
  if (!command) return null;
  return {
    doc: command.revert(doc),
    history: { past: history.past.slice(0, -1), future: [command, ...history.future] },
  };
}

export function redo(doc: MapFile, history: History): Applied | null {
  const command = history.future[0];
  if (!command) return null;
  return {
    doc: command.apply(doc),
    history: { past: [...history.past, command], future: history.future.slice(1) },
  };
}
