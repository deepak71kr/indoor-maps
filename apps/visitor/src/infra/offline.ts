/** Page side of offline support: register the service worker and save maps. */

/** Must match the cache name in sw.ts. */
const MAPS = 'im-maps';

/**
 * On the very first visit the service worker starts AFTER the map was downloaded,
 * so the page saves the map itself; otherwise airplane mode on visit 2 would have no map.
 */
export async function saveMap(url: string, response: Response): Promise<void> {
  try {
    const cache = await caches.open(MAPS);
    await cache.put(url, response);
  } catch {
    // Cache API missing or storage blocked — the app still works online.
  }
}

/**
 * `canReload()` says whether the page may reload now (not in the middle of a walk): then a
 * newly installed version shows at once instead of on the next open.
 */
export function registerServiceWorker(canReload: () => boolean = () => false): void {
  if (!('serviceWorker' in navigator)) return;
  // A new version took over: show it now if the visitor isn't walking.
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || !canReload()) return;
    // Never reload twice within a few seconds (no loop if something goes wrong).
    try {
      const last = Number(sessionStorage.getItem('im.reloaded') ?? 0);
      if (Date.now() - last < 10_000) return;
      sessionStorage.setItem('im.reloaded', String(Date.now()));
    } catch {
      return;
    }
    location.reload();
  });
  navigator.serviceWorker
    .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
    .then((registration) => {
      // When a new version finishes installing, let it take over now; this page keeps running
      // the code it already loaded, and the NEXT open uses the new version.
      const takeOverWhenInstalled = (worker: ServiceWorker | null) => {
        if (!worker) return;
        const tryTakeOver = () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            worker.postMessage('skip-waiting');
          }
        };
        worker.addEventListener('statechange', tryTakeOver);
        tryTakeOver();
      };
      takeOverWhenInstalled(registration.waiting);
      takeOverWhenInstalled(registration.installing);
      registration.addEventListener('updatefound', () =>
        takeOverWhenInstalled(registration.installing),
      );
      // Browsers don't reliably check for a new sw.js on every open; ask (1 KB, in background).
      void registration.update().catch(() => undefined);
    })
    .catch(() => undefined);
  // Ask the browser to keep our storage (maps, app) instead of clearing it under pressure.
  void navigator.storage?.persist?.().catch(() => false);
}
