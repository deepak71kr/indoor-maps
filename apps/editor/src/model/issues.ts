/**
 * Everything the Checks panel shows: file problems (@innermap/schema) and visitor-facing
 * problems (@innermap/core checkMap), each pointing at the dot or line to fix.
 */
import { checkMap } from '@innermap/core';
import type { MapFile } from '@innermap/schema';
import { validateMapFile } from '@innermap/schema/validate';

export type IssueTarget =
  { readonly node: string } | { readonly edge: readonly [string, string] } | null;

export interface EditorIssue {
  readonly severity: 'error' | 'warning';
  readonly message: string;
  readonly target: IssueTarget;
}

export function collectIssues(doc: MapFile): EditorIssue[] {
  const result = validateMapFile(doc);
  const fileIssues = (result.ok ? result.warnings : result.issues).map((issue) => ({
    severity: issue.severity,
    message: issue.message,
    target: targetOfPath(doc, issue.path),
  }));
  // Graph checks only make sense once the file itself is consistent.
  const mapIssues = result.ok ? checkMap(result.map) : [];
  return [...fileIssues, ...mapIssues].sort(
    (a, b) => Number(a.severity === 'warning') - Number(b.severity === 'warning'),
  );
}

/** `edges[3].b` → that line; `rooms[2].doors[0]` → that door; etc. */
function targetOfPath(doc: MapFile, path: string): IssueTarget {
  const index = (list: string) => {
    const m = new RegExp(`^${list}\\[(\\d+)\\]`).exec(path);
    return m ? Number(m[1]) : -1;
  };
  const node = doc.nodes[index('nodes')];
  if (node) return { node: node.id };
  const edge = doc.edges[index('edges')];
  if (edge) return { edge: [edge.a, edge.b] };
  const room = doc.rooms[index('rooms')];
  const door = /doors\[(\d+)\]/.exec(path);
  if (room) return { node: room.doors[door ? Number(door[1]) : 0] ?? '' };
  const connector = doc.connectors[index('connectors')];
  if (connector) {
    const level = /stops\.([^.]+)/.exec(path)?.[1];
    const stop = (level && connector.stops[level]) || Object.values(connector.stops)[0];
    return stop ? { node: stop } : null;
  }
  const amenity = doc.amenities[index('amenities')];
  if (amenity) return { node: amenity.node };
  const qr = doc.qr[index('qr')];
  if (qr) return { node: qr.node };
  return null;
}
