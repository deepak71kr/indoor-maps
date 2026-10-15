// Fails the build if the visitor app or a map file grows past its budget.
// Budgets: docs/LOW_LEVEL_DESIGN.md §14 — app shell ≤ 35 KB, each map file ≤ 15 KB,
// first visit (shell + largest map) ≤ 50 KB — all brotli-compressed.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { brotliCompressSync, constants } from 'node:zlib';

const DIST = 'apps/visitor/dist';
const SHELL_BUDGET = 35 * 1024;
const MAP_BUDGET = 15 * 1024;
const FIRST_VISIT_BUDGET = 50 * 1024;
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

const shell = rows.filter((r) => !r.isMap);
const shellTotal = shell.reduce((sum, r) => sum + r.br, 0);
console.log('\nVisitor app shell (brotli)');
shell.forEach((r) => console.log(line(r)));
console.log(`  ${'TOTAL'.padEnd(40)} ${kb(shellTotal).padStart(9)}  / budget ${kb(SHELL_BUDGET)}`);
if (shellTotal > SHELL_BUDGET) {
  console.error(`✖ App shell over budget by ${kb(shellTotal - SHELL_BUDGET)}.`);
  failed = true;
}

const maps = rows.filter((r) => r.isMap);
if (maps.length > 0) {
  console.log('\nMap files (brotli, budget per file)');
  for (const r of maps) {
    console.log(`${line(r)}  / budget ${kb(MAP_BUDGET)}`);
    if (r.br > MAP_BUDGET) {
      console.error(`✖ ${r.file} over budget by ${kb(r.br - MAP_BUDGET)}.`);
      failed = true;
    }
  }
}

const largestMap = Math.max(0, ...maps.map((r) => r.br));
const firstVisit = shellTotal + largestMap;
console.log(
  `
First visit (shell + largest map)        ${kb(firstVisit).padStart(9)}  / budget ${kb(FIRST_VISIT_BUDGET)}`,
);
if (firstVisit > FIRST_VISIT_BUDGET) {
  console.error(`✖ First visit over budget by ${kb(firstVisit - FIRST_VISIT_BUDGET)}.`);
  failed = true;
}

if (failed) process.exit(1);
console.log('\n✔ Within budget.');
