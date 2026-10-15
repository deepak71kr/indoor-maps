// Fails the build if the visitor app's shell grows past its budget.
// Budget: docs/LOW_LEVEL_DESIGN.md §14 — app shell ≤ 35 KB brotli-compressed.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { brotliCompressSync, constants } from 'node:zlib';

const DIST = 'apps/visitor/dist';
const BUDGET_BYTES = 35 * 1024;
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
  return { file: relative(DIST, file), raw: raw.length, br };
});

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const total = rows.reduce((sum, r) => sum + r.br, 0);

console.log('\nVisitor app size (brotli)');
for (const r of rows)
  console.log(`  ${r.file.padEnd(40)} ${kb(r.br).padStart(9)}  (raw ${kb(r.raw)})`);
console.log(`  ${'TOTAL'.padEnd(40)} ${kb(total).padStart(9)}  / budget ${kb(BUDGET_BYTES)}\n`);

if (total > BUDGET_BYTES) {
  console.error(`✖ Over budget by ${kb(total - BUDGET_BYTES)}.`);
  process.exit(1);
}
console.log('✔ Within budget.');
