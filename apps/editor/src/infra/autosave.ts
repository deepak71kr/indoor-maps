import type { MapFile } from '@innermap/schema';
import { validateMapFile } from '@innermap/schema/validate';

const KEY = 'im-editor.doc';

/** The last auto-saved document, if it still parses as a map (drafts with warnings are fine). */
export function loadAutosave(): MapFile | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return parseDraft(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Debounced save so dragging doesn't write on every frame. */
export function autosaver(delayMs = 400): (doc: MapFile) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (doc) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        localStorage.setItem(KEY, JSON.stringify(doc));
      } catch {
        // Storage full or blocked: Export still works.
      }
    }, delayMs);
  };
}

/**
 * Accepts a draft: the SHAPE must be valid (otherwise the editor can't show it), but
 * reference problems are allowed — they appear in the Issues panel to be fixed.
 */
export function parseDraft(input: unknown): MapFile | null {
  const result = validateMapFile(input);
  if (result.ok) return result.map;
  return result.issues.some((i) => i.code === 'invalid-shape') ? null : (input as MapFile);
}
