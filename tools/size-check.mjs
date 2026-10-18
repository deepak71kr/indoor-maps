// Fails the build if the visitor app or a map file grows past its budget.
// Budgets: docs/LOW_LEVEL_DESIGN.md §14 — all brotli-compressed:
// - first screen (what index.html loads) ≤ 50 KB (founder, 2026-10-18: "50 KB is not that big");
// - screens loaded right after it (lazy chunks, e.g. the trip screens) ≤ 15 KB;
// - each map file ≤ 15 KB;
// - first visit (every app file + the largest map) ≤ 65 KB.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { brotliCompressSync, constants } from 'node:zlib';

const DIST = 'apps/visitor/dist';
const SHELL_BUDGET = 50 * 1024;
const MAP_BUDGET = 15 * 1024;
const LATER_BUDGET = 15 * 1024;
/**
 * Stress-test samples: one very big campus in a single file, on purpose, to test the apps.
 * Real sites of this size are published per building (v0 on-demand loading), so these get a
 * separate budget and don't count toward the first visit.
 */
const STRESS_MAPS = new Set(['maps/demo-mesra.json']);
const STRESS_BUDGET = 40 * 1024;
const FIRST_VISIT_BUDGET = 65 * 1024;
const COUNTED = /\.(html|js|css|svg|json|webmanifest)$/;

function listFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

let files;
try {
  files = listFiles(DIST).filter((f) => COUNTED.test(f));
} catch {
  console.error(`✖ ${DIST} not found — run "pnpm build" first.`);
  process.exit(1);
}

const rows = files.map((file) => {
  const raw = readFileSync(file);
  const br = brotliCompressSync(raw, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  }).length;
  const name = relative(DIST, file).split(sep).join('/');
  return { file: name, raw: raw.length, br, isMap: name.startsWith('maps/') };
});

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const line = (r) => `  ${r.file.padEnd(40)} ${kb(r.br).padStart(9)}  (raw ${kb(r.raw)})`;
let failed = false;

// The first screen is index.html, the service worker, and every file index.html points to.
const html = readFileSync(join(DIST, 'index.html'), 'utf8');
const referenced = new Set(
  [...html.matchAll(/(?:src|href)="[^"]*?(assets\/[^"]+)"/g)].map((m) => m[1]),
);
const isFirst = (r) => r.file === 'index.html' || r.file === 'sw.js' || referenced.has(r.file);
const app = rows.filter((r) => !r.isMap);
const shell = app.filter(isFirst);
const later = app.filter((r) => !isFirst(r));
const shellTotal = shell.reduce((sum, r) => sum + r.br, 0);
const laterTotal = later.reduce((sum, r) => sum + r.br, 0);
console.log('\nFirst screen (brotli)');
shell.forEach((r) => console.log(line(r)));
console.log(`  ${'TOTAL'.padEnd(40)} ${kb(shellTotal).padStart(9)}  / budget ${kb(SHELL_BUDGET)}`);
if (shellTotal > SHELL_BUDGET) {
  console.error(`✖ First screen over budget by ${kb(shellTotal - SHELL_BUDGET)}.`);
  failed = true;
}
console.log('\nLoaded right after the first screen (brotli)');
later.forEach((r) => console.log(line(r)));
console.log(`  ${'TOTAL'.padEnd(40)} ${kb(laterTotal).padStart(9)}  / budget ${kb(LATER_BUDGET)}`);
if (laterTotal > LATER_BUDGET) {
  console.error(`✖ Later screens over budget by ${kb(laterTotal - LATER_BUDGET)}.`);
  failed = true;
}

const maps = rows.filter((r) => r.isMap);
if (maps.length > 0) {
  console.log('\nMap files (brotli, budget per file)');
  for (const r of maps) {
    const stress = STRESS_MAPS.has(r.file);
    const budget = stress ? STRESS_BUDGET : MAP_BUDGET;
    console.log(`${line(r)}  / budget ${kb(budget)}${stress ? '  (stress test, one file)' : ''}`);
    if (r.br > budget) {
      console.error(`✖ ${r.file} over budget by ${kb(r.br - budget)}.`);
      failed = true;
    }
  }
}

const largestMap = Math.max(0, ...maps.filter((r) => !STRESS_MAPS.has(r.file)).map((r) => r.br));
const firstVisit = shellTotal + laterTotal + largestMap;
console.log(
  `
First visit (all app files + map)        ${kb(firstVisit).padStart(9)}  / budget ${kb(FIRST_VISIT_BUDGET)}`,
);
if (firstVisit > FIRST_VISIT_BUDGET) {
  console.error(`✖ First visit over budget by ${kb(firstVisit - FIRST_VISIT_BUDGET)}.`);
  failed = true;
}

if (failed) process.exit(1);
console.log('\n✔ Within budget.');
