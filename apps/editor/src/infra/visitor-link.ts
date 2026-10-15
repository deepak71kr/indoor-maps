/**
 * Links between the editor and the visitor app: where the visitor app lives, the link printed
 * in each QR sticker, and (in development) publishing a map to the visitor dev server so a
 * phone on the same Wi-Fi can open it. Replaced by the real publish pipeline in v0.
 */
import type { MapFile } from '@innermap/schema';

const KEY = 'im-editor.visitorUrl';
const DEV_PORT = 5173;

/** The visitor app address set by the admin, or a guess for local development. */
export function savedVisitorUrl(): string {
  try {
    return localStorage.getItem(KEY) ?? `${location.protocol}//${location.hostname}:${DEV_PORT}`;
  } catch {
    return `http://localhost:${DEV_PORT}`;
  }
}

export function saveVisitorUrl(url: string): void {
  try {
    localStorage.setItem(KEY, url.replace(/\/+$/, ''));
  } catch {
    // Not saved; the default is used next time.
  }
}

/** The link inside a QR sticker: opens the visitor app at that sticker. */
export function stickerUrl(base: string, siteId: string, code: string): string {
  const url = new URL(base);
  url.searchParams.set('site', siteId);
  url.searchParams.set('at', code);
  return url.toString();
}

/** Publish to the visitor DEV server; returns the addresses a phone can open. */
export async function publishToDevServer(base: string, doc: MapFile): Promise<string[]> {
  const response = await fetch(`${base}/__inner-map/maps/${encodeURIComponent(doc.site.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(doc),
  });
  if (!response.ok) throw new Error(`Visitor dev server said ${response.status}`);
  const { urls } = (await response.json()) as { urls?: string[] };
  return urls ?? [];
}
