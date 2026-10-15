/**
 * Service worker (docs/LOW_LEVEL_DESIGN.md §7.2), hand-written to stay tiny.
 *
 * - App shell: precached at install as one versioned set, so HTML and JS always match.
 * - Navigations: always the cached app shell (works offline; ?at=… is read by the app).
 * - Map files: network first with a 2 s timeout, then the saved copy.
 * - Other same-origin files: saved copy first.
 *
 * Updates: a new version installs in the background and WAITS; the page asks it to take over,
 * and the next open uses it. The open page keeps running on the code it already loaded.
 */
const sw = self as unknown as ServiceWorkerGlobalScope;

interface Manifest {
  readonly version: string;
  readonly files: readonly string[];
}
// Replaced at build time by the visitor's Vite config (see sw-manifest plugin).
const MANIFEST = JSON.parse('__IM_MANIFEST__') as Manifest;

const SHELL = `im-shell-${MANIFEST.version}`;
/** Shared with the page, which saves the first map it downloads. */
const MAPS = 'im-maps';
const MAP_TIMEOUT_MS = 2000;
/**
 * Servers often add `Vary` headers (e.g. Accept-Encoding). Honouring them makes the page's
 * requests miss what install saved, which broke offline loading in testing. Our files are
 * versioned, so the URL alone identifies them.
 */
const MATCH: CacheQueryOptions = { ignoreVary: true };

sw.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(MANIFEST.files)));
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith('im-shell-') && key !== SHELL) await caches.delete(key);
      }
      await sw.clients.claim();
    })(),
  );
});

sw.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') void sw.skipWaiting();
});

sw.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== sw.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(cachedShell(request));
  } else if (url.pathname.startsWith('/maps/')) {
    event.respondWith(networkFirst(request));
  } else {
    event.respondWith(cacheFirst(request));
  }
});

async function cachedShell(request: Request): Promise<Response> {
  const cached = await caches.match('/index.html', { ...MATCH, cacheName: SHELL });
  return cached ?? fetch(request);
}

async function cacheFirst(request: Request): Promise<Response> {
  return (await caches.match(request, MATCH)) ?? fetch(request);
}

async function networkFirst(request: Request): Promise<Response> {
  const cache = await caches.open(MAPS);
  const network = fetch(request).then(async (response) => {
    if (response.ok) await cache.put(request, response.clone());
    return response;
  });
  const timeout = new Promise<undefined>((resolve) => setTimeout(resolve, MAP_TIMEOUT_MS));
  try {
    const fresh = await Promise.race([network, timeout]);
    if (fresh) return fresh;
  } catch {
    // offline or network error → fall back to the saved copy
  }
  const saved = await cache.match(request, MATCH);
  return saved ?? network; // nothing saved yet: keep waiting for the network
}
