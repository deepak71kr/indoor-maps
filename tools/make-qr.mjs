/**
 * QR stickers for a site, as files: one SVG per sticker (QR → the visitor link, the big short
 * code, "You are at …", "Scan for directions"), in a folder per building, plus index.html to
 * print them all on A4.
 *
 *   node tools/make-qr.mjs                       # BIT Mesra demo → qr/bit-mesra/
 *   node tools/make-qr.mjs <map.json> <out-dir>  # any map
 *
 * Links point at the live app: https://deepak71kr.github.io/indoor-maps/?site=<id>&at=<code>.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// The qrcode library is the editor's (it prints the same stickers there).
const QRCode = createRequire(join(ROOT, 'apps/editor/package.json'))('qrcode');
const APP = 'https://deepak71kr.github.io/indoor-maps/';

const mapPath = process.argv[2] ?? join(ROOT, 'samples/demo-mesra/map.json');
const outDir = process.argv[3] ?? join(ROOT, 'qr/bit-mesra');
const map = JSON.parse(readFileSync(mapPath, 'utf8'));

const nodes = new Map(map.nodes.map((n) => [n.id, n]));
const levels = new Map(map.levels.map((l) => [l.id, l]));
const buildings = new Map((map.buildings ?? []).map((b) => [b.id, b]));
const COLORS = {
  teal: '#0f8b8d',
  amber: '#b86e00',
  violet: '#7448d0',
  blue: '#2a66d6',
  rose: '#cc3d64',
  green: '#24894f',
  orange: '#d05a22',
  slate: '#546271',
};
const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );
/** Splits a long name over two lines of about `n` letters. */
const lines = (text, n = 30) => {
  if (text.length <= n) return [text];
  const cut = text.lastIndexOf(' ', n);
  const at = cut > 10 ? cut : n;
  const rest = text.slice(at).trim();
  return [text.slice(0, at).trim(), rest.length > n ? `${rest.slice(0, n - 1)}…` : rest];
};

/** The sticker's folder: its building's code ("MB", "LIB"…), or "campus" for gates and roads. */
function folderOf(qr) {
  const level = levels.get(nodes.get(qr.node)?.lvl);
  if (level?.building) return level.building;
  const prefix = qr.code.split('-')[0].toLowerCase();
  return [...buildings.keys()].includes(prefix) ? prefix : 'campus';
}

rmSync(outDir, { recursive: true, force: true });
const made = [];
for (const qr of map.qr) {
  const node = nodes.get(qr.node);
  const level = levels.get(node?.lvl);
  const building = level?.building ? buildings.get(level.building)?.name : undefined;
  const floor = level ? (building ? `${building} · ${level.name}` : level.name) : '';
  const place = node?.landmark ?? qr.code;
  const url = `${APP}?site=${encodeURIComponent(map.site.id)}&at=${encodeURIComponent(qr.code)}`;
  // The QR as SVG paths (no images: crisp at any print size).
  const qrSvg = await QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
  const inner = qrSvg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  const size = Number(/viewBox="0 0 (\d+)/.exec(qrSvg)?.[1] ?? 25);
  const colour = COLORS[level?.color] ?? COLORS.slate;
  const [l1, l2] = lines(place);
  // A 60 × 90 mm sticker: the QR, the code, where you are, the floor, a hint.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="60mm" height="90mm" viewBox="0 0 600 900">
  <rect width="600" height="900" rx="36" fill="#fff" stroke="${colour}" stroke-width="14"/>
  <rect x="7" y="7" width="586" height="70" rx="30" fill="${colour}"/>
  <text x="300" y="56" font-family="Arial, sans-serif" font-size="34" font-weight="700" fill="#fff" text-anchor="middle">Scan for directions</text>
  <g transform="translate(90 110) scale(${420 / size})">${inner}</g>
  <text x="300" y="610" font-family="Arial, sans-serif" font-size="72" font-weight="800" fill="#111" text-anchor="middle">${esc(qr.code)}</text>
  <text x="300" y="672" font-family="Arial, sans-serif" font-size="30" fill="#444" text-anchor="middle">You are at</text>
  <text x="300" y="716" font-family="Arial, sans-serif" font-size="34" font-weight="700" fill="#111" text-anchor="middle">${esc(l1)}</text>
  ${l2 ? `<text x="300" y="758" font-family="Arial, sans-serif" font-size="34" font-weight="700" fill="#111" text-anchor="middle">${esc(l2)}</text>` : ''}
  <text x="300" y="840" font-family="Arial, sans-serif" font-size="30" font-weight="700" fill="${colour}" text-anchor="middle">${esc(floor)}</text>
</svg>
`;
  const folder = folderOf(qr);
  mkdirSync(join(outDir, folder), { recursive: true });
  const file = `${folder}/${qr.code}.svg`;
  writeFileSync(join(outDir, file), svg);
  made.push({ file, code: qr.code, place, floor, url });
}

// index.html: every sticker, grouped by folder, ready to print on A4 (6 per page).
const groups = [...new Set(made.map((m) => m.file.split('/')[0]))].sort();
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>QR stickers · ${esc(map.site.name)}</title>
<style>
  body { font-family: Arial, sans-serif; margin: 16px; color: #222; }
  h1 { font-size: 20px; } h2 { font-size: 16px; margin: 24px 0 8px; break-after: avoid; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, 60mm); gap: 6mm; }
  .grid img { width: 60mm; height: 90mm; }
  p { color: #555; font-size: 14px; }
  @media print { .no-print { display: none; } body { margin: 8mm; } h2 { break-before: auto; } }
</style>
</head>
<body>
<h1>QR stickers · ${esc(map.site.name)} (${made.length})</h1>
<p class="no-print">Print with “Fit to page” off (100 %). Each sticker is 60 × 90 mm. Put each one at the spot it names, facing the way the arrow on the map says. Made with tools/make-qr.mjs.</p>
${groups
  .map(
    (
      g,
    ) => `<h2>${esc(buildings.get(g)?.name ?? (g === 'campus' ? 'Campus (gates and roads)' : g))}</h2>
<div class="grid">
${made
  .filter((m) => m.file.startsWith(`${g}/`))
  .map(
    (m) =>
      `  <a href="${esc(m.url)}" title="${esc(m.place)}"><img src="${esc(m.file)}" alt="${esc(m.code)}: ${esc(m.place)}" /></a>`,
  )
  .join('\n')}
</div>`,
  )
  .join('\n')}
</body>
</html>
`;
writeFileSync(join(outDir, 'index.html'), html);
writeFileSync(
  join(outDir, 'stickers.csv'),
  `code,place,floor,link\n${made.map((m) => [m.code, m.place, m.floor, m.url].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')}\n`,
);
console.log(`${made.length} stickers in ${groups.length} folders → ${outDir}`);
