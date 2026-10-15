/**
 * Map file validation: shape (Zod) + cross-references (ids, levels, connectors).
 *
 * Imported via `@innermap/schema/validate` by the editor, tests and publisher only —
 * never by the visitor app, so Zod stays out of the phone bundle.
 *
 * Graph-level checks (reachability, missing landmarks on decision points…) live in
 * packages/core because they need routing; this file only checks the file is consistent.
 */
import type { core } from 'zod';
import type { MapFile, MapNode } from './format-v0';
import { MapFileSchema } from './format-v0';

export type Severity = 'error' | 'warning';

export type IssueCode =
  | 'invalid-shape'
  | 'duplicate-id'
  | 'duplicate-level-order'
  | 'duplicate-qr-code'
  | 'unknown-level'
  | 'unknown-node'
  | 'self-loop'
  | 'cross-level-edge'
  | 'duplicate-edge'
  | 'connector-too-few-stops'
  | 'connector-stop-wrong-level'
  | 'connector-stop-kind'
  | 'node-in-many-connectors'
  | 'orphan-stop'
  | 'duplicate-door'
  | 'door-kind'
  | 'image-without-scale'
  | 'shape-points'
  | 'unknown-room';

export interface Issue {
  severity: Severity;
  code: IssueCode;
  /** Location in the file, e.g. `edges[3].b`. */
  path: string;
  message: string;
}

export type ValidationResult =
  { ok: true; map: MapFile; warnings: Issue[] } | { ok: false; issues: Issue[] };

export function validateMapFile(input: unknown): ValidationResult {
  const parsed = MapFileSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map(fromZodIssue) };
  }
  const issues = checkReferences(parsed.data);
  const errors = issues.filter((i) => i.severity === 'error');
  if (errors.length > 0) return { ok: false, issues };
  return { ok: true, map: parsed.data, warnings: issues };
}

/** Human-readable, one issue per line: `✖ edges[3].b — unknown node "G-X" (unknown-node)`. */
export function formatIssues(issues: readonly Issue[]): string {
  return issues
    .map((i) => `${i.severity === 'error' ? '✖' : '⚠'} ${i.path} — ${i.message} (${i.code})`)
    .join('\n');
}

function fromZodIssue(issue: core.$ZodIssue): Issue {
  return {
    severity: 'error',
    code: 'invalid-shape',
    path: formatPath(issue.path) || '(root)',
    message: issue.message,
  };
}

function formatPath(path: readonly PropertyKey[]): string {
  return path
    .map((part, index) =>
      typeof part === 'number' ? `[${part}]` : `${index === 0 ? '' : '.'}${String(part)}`,
    )
    .join('');
}

function checkReferences(map: MapFile): Issue[] {
  const issues: Issue[] = [];
  const error = (code: IssueCode, path: string, message: string) =>
    issues.push({ severity: 'error', code, path, message });
  const warn = (code: IssueCode, path: string, message: string) =>
    issues.push({ severity: 'warning', code, path, message });

  // --- unique ids (each list is its own namespace) ---
  const checkUnique = (list: string, ids: readonly string[], what: string) => {
    const seen = new Set<string>();
    ids.forEach((value, index) => {
      if (seen.has(value))
        error('duplicate-id', `${list}[${index}]`, `duplicate ${what} id "${value}"`);
      seen.add(value);
    });
  };
  checkUnique(
    'levels',
    map.levels.map((l) => l.id),
    'level',
  );
  checkUnique(
    'nodes',
    map.nodes.map((n) => n.id),
    'node',
  );
  checkUnique(
    'connectors',
    map.connectors.map((c) => c.id),
    'connector',
  );
  checkUnique(
    'rooms',
    map.rooms.map((r) => r.id),
    'room',
  );
  checkUnique(
    'amenities',
    map.amenities.map((a) => a.id),
    'amenity',
  );

  const qrCodes = new Set<string>();
  map.qr.forEach((q, index) => {
    if (qrCodes.has(q.code))
      error('duplicate-qr-code', `qr[${index}].code`, `QR code "${q.code}" is used twice`);
    qrCodes.add(q.code);
  });

  // --- levels ---
  const levelIds = new Set(map.levels.map((l) => l.id));
  const orders = new Set<number>();
  map.levels.forEach((level, index) => {
    if (orders.has(level.ord))
      error(
        'duplicate-level-order',
        `levels[${index}].ord`,
        `another level already uses order ${level.ord}`,
      );
    orders.add(level.ord);
    if (level.image && level.pxPerMeter === undefined)
      warn(
        'image-without-scale',
        `levels[${index}]`,
        `level "${level.id}" has a floor plan but no scale (pxPerMeter)`,
      );
  });

  // --- nodes ---
  const nodes = new Map<string, MapNode>();
  map.nodes.forEach((node, index) => {
    nodes.set(node.id, node);
    if (!levelIds.has(node.lvl))
      error('unknown-level', `nodes[${index}].lvl`, `unknown level "${node.lvl}"`);
  });
  const requireNode = (nodeId: string, path: string): MapNode | undefined => {
    const node = nodes.get(nodeId);
    if (!node) error('unknown-node', path, `unknown node "${nodeId}"`);
    return node;
  };

  // --- edges ---
  const edgeKeys = new Set<string>();
  map.edges.forEach((edge, index) => {
    const a = requireNode(edge.a, `edges[${index}].a`);
    const b = requireNode(edge.b, `edges[${index}].b`);
    if (edge.a === edge.b) {
      error('self-loop', `edges[${index}]`, `edge connects "${edge.a}" to itself`);
      return;
    }
    if (a && b && a.lvl !== b.lvl)
      error(
        'cross-level-edge',
        `edges[${index}]`,
        `edge joins levels "${a.lvl}" and "${b.lvl}" — use a connector (lift/stairs) instead`,
      );
    const key = edge.oneWay ? `${edge.a}>${edge.b}` : [edge.a, edge.b].sort().join('|');
    if (edgeKeys.has(key))
      error('duplicate-edge', `edges[${index}]`, `duplicate edge "${edge.a}" – "${edge.b}"`);
    edgeKeys.add(key);
  });

  // --- connectors ---
  const connectorOfNode = new Map<string, string>();
  map.connectors.forEach((connector, index) => {
    const stops = Object.entries(connector.stops);
    if (stops.length < 2)
      error(
        'connector-too-few-stops',
        `connectors[${index}].stops`,
        `${connector.kind} "${connector.id}" must stop on at least 2 levels`,
      );
    const expectedKind = connector.kind === 'lift' ? 'lift-stop' : 'stairs-stop';
    for (const [levelId, nodeId] of stops) {
      const path = `connectors[${index}].stops.${levelId}`;
      if (!levelIds.has(levelId)) error('unknown-level', path, `unknown level "${levelId}"`);
      const node = requireNode(nodeId, path);
      if (!node) continue;
      if (node.lvl !== levelId)
        error(
          'connector-stop-wrong-level',
          path,
          `stop for level "${levelId}" is node "${nodeId}", which is on level "${node.lvl}"`,
        );
      if (node.kind !== expectedKind)
        warn('connector-stop-kind', path, `node "${nodeId}" should have kind "${expectedKind}"`);
      const other = connectorOfNode.get(nodeId);
      if (other)
        error(
          'node-in-many-connectors',
          path,
          `node "${nodeId}" is already a stop of connector "${other}"`,
        );
      connectorOfNode.set(nodeId, connector.id);
    }
  });
  map.nodes.forEach((node, index) => {
    if ((node.kind === 'lift-stop' || node.kind === 'stairs-stop') && !connectorOfNode.has(node.id))
      warn(
        'orphan-stop',
        `nodes[${index}]`,
        `"${node.id}" is a ${node.kind} but no connector uses it`,
      );
  });

  // --- rooms ---
  map.rooms.forEach((room, index) => {
    const seenDoors = new Set<string>();
    room.doors.forEach((doorId, doorIndex) => {
      const path = `rooms[${index}].doors[${doorIndex}]`;
      if (seenDoors.has(doorId))
        error('duplicate-door', path, `door "${doorId}" listed twice in room "${room.id}"`);
      seenDoors.add(doorId);
      const node = requireNode(doorId, path);
      if (node && node.kind !== 'door' && node.kind !== 'entrance')
        warn('door-kind', path, `room door "${doorId}" has kind "${node.kind}", expected "door"`);
    });
  });

  // --- floor plan shapes ---
  const roomIds = new Set(map.rooms.map((r) => r.id));
  map.levels.forEach((level, levelIndex) => {
    level.shapes?.forEach((shape, index) => {
      const path = `levels[${levelIndex}].shapes[${index}]`;
      const minPoints = shape.kind === 'wall' ? 2 : 3;
      if (shape.pts.length % 2 !== 0 || shape.pts.length < minPoints * 2)
        error(
          'shape-points',
          `${path}.pts`,
          `a ${shape.kind} needs at least ${minPoints} points, given as x, y pairs`,
        );
      if (shape.room !== undefined && !roomIds.has(shape.room))
        error('unknown-room', `${path}.room`, `unknown room "${shape.room}"`);
    });
  });

  // --- amenities and QR anchors ---
  map.amenities.forEach((amenity, index) => requireNode(amenity.node, `amenities[${index}].node`));
  map.qr.forEach((q, index) => requireNode(q.node, `qr[${index}].node`));

  return issues;
}
