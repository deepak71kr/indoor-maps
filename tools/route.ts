/**
 * Try a route from the terminal.
 *
 *   pnpm route <from> <to> [--step-free] [--map path/to/map.json]
 *
 *   <from>  QR code (G-MAIN) or node id (G-ENT)
 *   <to>    room id, number or name (radiology, 201, "Pathology lab"),
 *           node id (2-W), or nearest:<kinds> (nearest:toilet,toilet-accessible)
 *
 * Phase 3 replaces the raw path below with human directions.
 */
import { readFileSync } from 'node:fs';
import type { Destination } from '@innermap/core';
import { findRoute, loadSite } from '@innermap/core';
import type { Amenity } from '@innermap/schema';
import { formatIssues, validateMapFile } from '@innermap/schema/validate';

const DEFAULT_MAP = 'samples/demo-hospital/demo.json';

function main(argv: readonly string[]): number {
  const flags = new Set(argv.filter((a) => a.startsWith('--') && !a.startsWith('--map')));
  const mapIndex = argv.indexOf('--map');
  const mapPath = mapIndex >= 0 ? argv[mapIndex + 1] : DEFAULT_MAP;
  const [fromArg, toArg] = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--map');
  if (!fromArg || !toArg || !mapPath) {
    console.error('Usage: pnpm route <from> <to> [--step-free] [--map file.json]');
    return 2;
  }

  const validation = validateMapFile(JSON.parse(readFileSync(mapPath, 'utf8')));
  if (!validation.ok) {
    console.error(`✖ ${mapPath} is not a valid map:\n${formatIssues(validation.issues)}`);
    return 1;
  }
  const site = loadSite(validation.map);

  const from = site.nodeForQr(fromArg) ?? fromArg;
  const to = parseDestination(toArg, site);
  if (!to) {
    console.error(`✖ Unknown destination "${toArg}"`);
    return 1;
  }

  const result = findRoute(site, { from, to, profile: { stepFree: flags.has('--step-free') } });
  if (!result.ok) {
    console.error(`✖ ${result.error.code}`);
    return 1;
  }

  const route = result.value;
  const levelName = new Map(site.graph.levels.map((l) => [l.id, l.name]));
  const connectorName = new Map(site.map.connectors.map((c) => [c.id, c.name]));
  const target = route.arrival.room
    ? `${route.arrival.room.name}${route.arrival.room.number ? ` (${route.arrival.room.number})` : ''}`
    : (route.arrival.amenity?.name ?? route.arrival.amenity?.kind ?? route.arrival.nodeId);

  console.log(`\n${site.map.site.name}: ${fromArg} → ${target}\n`);
  route.nodes.forEach((node, i) => {
    const label = node.landmark ?? '(unnamed dot)';
    console.log(`  ${(levelName.get(node.level) ?? node.level).padEnd(8)} ${label}  [${node.id}]`);
    const edge = route.edges[i];
    if (!edge) return;
    if (edge.kind === 'lift' || edge.kind === 'stairs') {
      const name = (edge.connector && connectorName.get(edge.connector)) ?? edge.kind;
      const toLevel = levelName.get(route.nodes[i + 1]?.level ?? '') ?? '';
      console.log(`  ${''.padEnd(8)}   ⇅ ${name} to ${toLevel}`);
    } else {
      console.log(`  ${''.padEnd(8)}   ↓ ${edge.kind} ${Math.round(edge.length)} m`);
    }
  });
  console.log(
    `\n  Arrive at ${route.arrival.nodeId} · walking ${Math.round(route.walkingMeters)} m · ` +
      `floor changes ${route.floorChanges} · cost ${route.cost.toFixed(1)}\n`,
  );
  return 0;
}

function parseDestination(arg: string, site: ReturnType<typeof loadSite>): Destination | null {
  if (arg.startsWith('nearest:')) {
    const kinds = arg.slice('nearest:'.length).split(',') as Amenity['kind'][];
    return { type: 'amenity', kinds };
  }
  const room = site.findRoom(arg);
  if (room) return { type: 'room', roomId: room.id };
  if (site.graph.nodes.has(arg)) return { type: 'node', nodeId: arg };
  return null;
}

process.exitCode = main(process.argv.slice(2));
