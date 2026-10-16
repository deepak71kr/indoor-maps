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

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
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
