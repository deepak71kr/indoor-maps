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
import { loadRecent, loadTrip, persistRecent, persistTrip } from './app/session';
import { initialState } from './app/state';
import { createStore } from './app/store';
import { h, replace } from './ui/dom';
import { registerServiceWorker, saveMap } from './infra/offline';
import { installIcons } from './ui/icons';
import {
  applyTextSize,
  loadTripScreens,
  offerCompass,
  setLiveHeading,
  view,
  markWelcomed,
} from './ui/views';
import { CALIBRATE_WINDOW_MS, northOffset, toMapHeading } from './app/heading';
import { startCompass } from './infra/compass';
import './styles.css';

const DEFAULT_SITE = 'demo-hospital';

const params = new URLSearchParams(location.search);
const siteId = (params.get('site') ?? DEFAULT_SITE).replace(/[^a-z0-9-]/g, '');
const qrCode = params.get('at');
/** A shared place link: ?to=<room id> opens straight to the route there. */
const toRoom = params.get('to');

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
let lastStep = -1;
function render(): void {
  const state = store.getState();
  replace(root, view({ state, dispatch: store.dispatch, scan: scanner }));
  // A new screen's panels slide in; a new walking step slides in from the right.
  const screen = root.firstElementChild;
  const step = state.screen.name === 'navigate' ? (state.screen.peek ?? state.screen.step) : -1;
  if (state.screen.name !== lastScreen) screen?.classList.add('enter');
  else if (step > lastStep) screen?.classList.add('step-in');
  else if (step >= 0 && step < lastStep) screen?.classList.add('step-back');
  lastStep = step;
  if (state.screen.name !== lastScreen) {
    lastScreen = state.screen.name;
    if (state.screen.name === 'navigate' && state.site) markWelcomed(state.site.map.site.id);
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
            if (position) {
              noteScan(position.facing);
              store.dispatch({ type: 'set-position', position: { ...position, source: 'qr' } });
            }
          })
          .catch(() => undefined)
          .finally(() => overlay.remove());
      }
    : null;

// ---------- compass: which way the phone points (Google-style beam) ----------
// Maps don't know where north is, so the difference is learned at QR stickers: while
// scanning, the phone points the way the sticker faces (see app/heading.ts).
const NORTH_KEY = `im.north.${siteId}`;
/** How long after a scan (or after the compass starts) readings refine the calibration. */
const SETTLE_MS = 2000;
let offset: number | null = (() => {
  const saved = Number(storage?.getItem(NORTH_KEY) ?? NaN);
  return Number.isFinite(saved) ? saved : null;
})();
let scan: { facing: number; at: number; firstReading: number | null } | null = null;

/** Call right after a QR scan (URL or in-app scanner) with the sticker's facing. */
function noteScan(facing: number | undefined): void {
  if (facing !== undefined) scan = { facing, at: Date.now(), firstReading: null };
}

let compassSeen = false;
const compass = startCompass((heading) => {
  compassSeen = true;
  const now = Date.now();
  if (scan && now - scan.at < CALIBRATE_WINDOW_MS) {
    scan.firstReading ??= now;
    if (now - scan.firstReading < SETTLE_MS) {
      offset = northOffset(scan.facing, heading);
      try {
        storage?.setItem(NORTH_KEY, String(Math.round(offset)));
      } catch {
        // Not saved: the next scan calibrates again.
      }
    }
  }
  setLiveHeading(offset === null ? null : toMapHeading(heading, offset));
});
// Offer the "allow compass" button only on phones that stay silent (iPhone until allowed);
// laptops have no compass, and Android sends readings straight away.
if (compass?.needsPermission && matchMedia('(pointer: coarse)').matches) {
  setTimeout(() => {
    if (!compassSeen) offerCompass(() => compass.enable());
  }, 1500);
}

// ---------- boot ----------
async function boot(): Promise<void> {
  installIcons();
  applyTextSize();
  if (import.meta.env.PROD) registerServiceWorker();
  render();
  store.subscribe(render);
  // The trip screens (card, preview, walking) arrive right after the first screen.
  setTimeout(() => void loadTripScreens(render), 0);

  let map: MapFile;
  try {
    // BASE_URL is "/" locally and "/indoor-maps/" on GitHub Pages.
    const mapUrl = `${import.meta.env.BASE_URL}maps/${siteId}.json`;
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
  store.dispatch({ type: 'recent-loaded', recent: loadRecent(storage, siteId) });

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
    noteScan(scanned.facing);
    store.dispatch({ type: 'set-position', position: { ...scanned, source: 'qr' } });
  } else if (scanned) {
    noteScan(scanned.facing);
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

  // A shared link to a room: plan the route there (asks "where are you?" first if needed).
  const shared = toRoom ? site.map.rooms.find((r) => r.id === toRoom) : undefined;
  if (shared && !trip) {
    store.dispatch({
      type: 'choose',
      target: { destination: { type: 'room', roomId: shared.id }, label: shared.name },
    });
  }

  let savedRecent = store.getState().recent;
  store.subscribe((state) => {
    persistTrip(storage, siteId, state, Date.now());
    if (state.recent !== savedRecent) {
      savedRecent = state.recent;
      persistRecent(storage, siteId, state.recent);
    }
  });
}

void boot();
