/** Printable A4 sheet of QR stickers: code in big letters, floor color, "Scan for directions". */
import type { MapFile } from '@innermap/schema';
import QRCode from 'qrcode';
import { stickerUrl } from './visitor-link';

/** Same floor colors as the apps. */
const FLOOR_COLORS: Record<string, string> = {
  teal: '#0f8b8d',
  amber: '#b86e00',
  violet: '#7448d0',
  blue: '#2a66d6',
  rose: '#cc3d64',
  green: '#24894f',
  orange: '#d05a22',
  slate: '#546271',
};

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The full HTML document for printing (one sticker per QR anchor). */
export async function stickerSheetHtml(doc: MapFile, visitorBase: string): Promise<string> {
  const nodes = new Map(doc.nodes.map((n) => [n.id, n]));
  const levels = new Map(doc.levels.map((l) => [l.id, l]));
  const stickers = await Promise.all(
    [...doc.qr]
      .sort((a, b) => a.code.localeCompare(b.code))
      .map(async (q) => {
        const node = nodes.get(q.node);
        const level = node ? levels.get(node.lvl) : undefined;
        const url = stickerUrl(visitorBase, doc.site.id, q.code);
        const svg = await QRCode.toString(url, {
          type: 'svg',
          margin: 0,
          errorCorrectionLevel: 'M',
        });
        return `<section class="sticker" style="--floor:${FLOOR_COLORS[level?.color ?? 'slate'] ?? '#546271'}">
  <div class="qr">${svg}</div>
  <div class="text">
    <p class="scan">📍 Scan for directions</p>
    <p class="code">${escape(q.code)}</p>
    <p class="here">You are at: <b>${escape(node?.landmark ?? q.node)}</b></p>
    <p class="floor">${escape(level?.name ?? '')}</p>
    <p class="site">${escape(doc.site.name)}</p>
  </div>
</section>`;
      }),
  );
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>QR stickers — ${escape(doc.site.name)}</title>
<style>
  @page { size: A4; margin: 10mm; }
  body { margin: 0; font-family: system-ui, sans-serif; color: #16202a; }
  .sheet { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6mm; }
  .sticker { display: flex; gap: 4mm; align-items: center; border: 0.4mm dashed #999; border-left: 4mm solid var(--floor);
    padding: 4mm; height: 58mm; break-inside: avoid; border-radius: 3mm; }
  .qr { width: 42mm; height: 42mm; flex: none; }
  .qr svg { width: 100%; height: 100%; }
  .text p { margin: 0 0 1.5mm; }
  .scan { font-weight: 700; color: var(--floor); }
  .code { font-size: 22pt; font-weight: 800; letter-spacing: 0.04em; }
  .here { font-size: 9pt; }
  .floor { display: inline-block; background: var(--floor); color: #fff; font-weight: 700; padding: 0.5mm 2.5mm; border-radius: 3mm; font-size: 9pt; }
  .site { font-size: 8pt; color: #5a6573; }
  .empty { padding: 20mm; text-align: center; }
</style></head>
<body><main class="sheet">${stickers.join('\n') || '<p class="empty">No QR stickers yet — add them with the QR tool.</p>'}</main></body></html>`;
}

/** Opens the sheet in a new tab and starts printing. */
export async function printStickers(doc: MapFile, visitorBase: string): Promise<void> {
  const win = window.open('', '_blank');
  if (!win) throw new Error('Pop-up blocked — allow pop-ups to print stickers.');
  win.document.write(await stickerSheetHtml(doc, visitorBase));
  win.document.close();
  win.focus();
  win.print();
}
