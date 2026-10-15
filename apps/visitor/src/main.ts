/**
 * Composition root: the only place that knows about the URL, network, storage and DOM.
 * Everything else (state machine, search, session rules) is pure and unit-tested.
 */
import type { MapFile } from '@innermap/schema';
import { FORMAT_VERSION } from '@innermap/schema';
import { loadSite } from '@innermap/core';
import { tr } from './app/i18n';
import { codeFromQr, resolvePosition } from './app/search';
import type { KeyValue } from './app/session';
import { loadTrip, persistTrip } from './app/session';
import { initialState } from './app/state';
import { createStore } from './app/store';
import { h, replace } from './ui/dom';
import { registerServiceWorker, saveMap } from './infra/offline';
import { installIcons } from './ui/icons';
import { view } from './ui/views';
import './styles.css';

const DEFAULT_SITE = 'demo-hospital';

const params = new URLSearchParams(location.search);
const siteId = (params.get('site') ?? DEFAULT_SITE).replace(/[^a-z0-9-]/g, '');
const qrCode = params.get('at');

const storage: KeyValue | null = (() => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
})();

const store = createStore(initialState);
const root = document.getElementById('app') as HTMLElement;

// ---------- rendering ----------
let lastScreen = '';
function render(): void {
  const state = store.getState();
  replace(root, view({ state, dispatch: store.dispatch, scan: scanner }));
  if (state.screen.name !== lastScreen) {
    lastScreen = state.screen.name;
    window.scrollTo(0, 0);
    root.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
  }
}

// ---------- in-app QR scanner (lazy-loaded, Chrome on Android) ----------
const scanner: (() => void) | null =
  'BarcodeDetector' in window && !!navigator.mediaDevices
    ? () => {
        const abort = new AbortController();
        const frame = h('div', { class: 'scan-frame' });
        const overlay = h(
          'div',
          { class: 'scan', role: 'dialog', 'aria-label': tr('scan') },
          frame,
          h(
            'button',
            { type: 'button', class: 'btn', onClick: () => abort.abort() },
            tr('scan.cancel'),
          ),
        );
        document.body.appendChild(overlay);
        import('./infra/qr-scanner')
          .then(({ scanQr }) => scanQr(frame, abort.signal))
          .then((content) => {
            const site = store.getState().site;
            const position = content && site ? resolvePosition(site, codeFromQr(content)) : null;
            if (position)
              store.dispatch({ type: 'set-position', position: { ...position, source: 'qr' } });
          })
          .catch(() => undefined)
          .finally(() => overlay.remove());
      }
    : null;

// ---------- boot ----------
async function boot(): Promise<void> {
  installIcons();
  if (import.meta.env.PROD) registerServiceWorker();
  render();
  store.subscribe(render);

  let map: MapFile;
  try {
    const mapUrl = `/maps/${siteId}.json`;
    const response = await fetch(mapUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    void saveMap(mapUrl, response.clone());
    map = (await response.json()) as MapFile;
    if (map.fmt !== FORMAT_VERSION) throw new Error(`Unsupported map format ${String(map.fmt)}`);
  } catch (error) {
    store.dispatch({
      type: 'map-failed',
      message: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  const site = loadSite(map);
  const trip = loadTrip(storage, siteId, Date.now());
  store.dispatch({ type: 'map-loaded', site });

  const scanned = qrCode ? resolvePosition(site, qrCode) : null;
  if (qrCode) {
    // Consume ?at= so a page refresh doesn't restart the trip from the sticker.
    params.delete('at');
    const rest = params.toString();
    history.replaceState(null, '', `${location.pathname}${rest ? `?${rest}` : ''}`);
  }

  if (trip && scanned) {
    // Scanned a sticker mid-trip → new route to the SAME destination.
    store.dispatch({
      type: 'resume',
      position: trip.position,
      target: trip.target,
      step: trip.step,
      stepFree: trip.stepFree,
    });
    store.dispatch({ type: 'lost' });
    store.dispatch({ type: 'set-position', position: { ...scanned, source: 'qr' } });
  } else if (scanned) {
    store.dispatch({ type: 'set-position', position: { ...scanned, source: 'qr' } });
  } else if (trip) {
    store.dispatch({
      type: 'resume',
      position: trip.position,
      target: trip.target,
      step: trip.step,
      stepFree: trip.stepFree,
    });
  }

  store.subscribe((state) => persistTrip(storage, siteId, state, Date.now()));
}

void boot();
