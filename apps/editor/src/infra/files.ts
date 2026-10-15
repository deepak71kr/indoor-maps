import type { MapFile } from '@innermap/schema';
import { formatIssues, validateMapFile } from '@innermap/schema/validate';
import { parseDraft } from './autosave';

export function downloadMap(doc: MapFile): void {
  const blob = new Blob([JSON.stringify(doc, null, 1)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${doc.site.id}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type ImportResult = { ok: true; doc: MapFile } | { ok: false; message: string };

export async function readMapFile(file: File): Promise<ImportResult> {
  let json: unknown;
  try {
    json = JSON.parse(await file.text());
  } catch {
    return { ok: false, message: `${file.name} is not a JSON file.` };
  }
  const doc = parseDraft(json);
  if (doc) return { ok: true, doc };
  const result = validateMapFile(json);
  return {
    ok: false,
    message: `${file.name} is not a map file:\n${result.ok ? '' : formatIssues(result.issues)}`,
  };
}

/** Lets the user pick a file; resolves with it (or null if cancelled). */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}
