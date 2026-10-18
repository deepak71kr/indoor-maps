import { roomIcon } from '@innermap/core';
import { CATEGORY, tr } from '../app/i18n';
import {
  amenityChips,
  nearbyLandmarks,
  searchRooms,
  searchAmenities,
  searchSpots,
  searchBuildings,
} from '../app/search';
import { currentNode } from '../app/state';
import { h, replace } from './dom';
import { icon } from './icons';
import {
  mapScreen,
  bigTextToggle,
  title,
  button,
  roundButton,
  positionPicker,
  pickList,
  placeItem,
  stepFreeToggle,
} from './parts';
import type { ViewContext } from './parts';
import type * as TripModule from './trip';

export type { ViewContext } from './parts';
export { applyTextSize, offerCompass, setLiveHeading } from './parts';

export function view(ctx: ViewContext): HTMLElement {
  const { screen } = ctx.state;
  switch (screen.name) {
    case 'loading':
      // A sketch of the screen while the map loads: search bar, map, sheet.
      return h(
        'section',
        { class: 'screen skeleton', 'aria-busy': 'true' },
        h('div', { class: 'sk sk-bar' }),
        h('div', { class: 'sk sk-chips' }),
        h('div', { class: 'sk sk-sheet' }, h('p', { class: 'muted' }, tr('loading'))),
      );
    case 'error':
      return errorView(screen.message);
    case 'where-am-i':
      return whereView(ctx);
    case 'choose':
      return chooseView(ctx);
    case 'place':
      return trip ? trip.placeView(ctx, screen.roomId) : waitForScreens();
    case 'preview':
      return trip ? trip.previewView(ctx) : waitForScreens();
    case 'navigate':
      return trip ? trip.stepView(ctx, screen.step) : waitForScreens();
    case 'lost':
      return lostView(ctx);
    case 'arrived':
      return trip ? trip.arrivedView(ctx) : waitForScreens();
    case 'no-route':
      return noRouteView(ctx, screen.reason);
  }
}

// ---------- screens ----------

function errorView(message: string): HTMLElement {
  return h(
    'section',
    { class: 'screen center' },
    title(tr('error.title'), '😕'),
    h('p', { class: 'muted' }, message),
    button(tr('error.retry'), () => location.reload(), 'btn primary'),
  );
}

function whereView(ctx: ViewContext): HTMLElement {
  const site = ctx.state.site;
  const entrances = site
    ? [...site.graph.nodes.values()]
        .filter((n) => n.kind === 'entrance' && n.landmark)
        .map((n) => ({
          label: n.landmark ?? n.id,
          position: { node: n.id, source: 'picked' as const },
        }))
    : [];
  return h(
    'section',
    { class: 'screen' },
    h('p', { class: 'site' }, site?.map.site.name ?? ''),
    title(tr('where.title'), '📍'),
    positionPicker(ctx),
    entrances.length > 0 && h('h2', {}, tr('where.entrances')),
    entrances.length > 0 && pickList(entrances, ctx),
  );
}

function chooseView(ctx: ViewContext): HTMLElement {
  const { site, stepFree } = ctx.state;
  if (!site) return h('section');
  const here = currentNode(ctx.state);
  const hereName = (here && site.graph.nodes.get(here)?.landmark) ?? here ?? '';
  const label = (c: keyof typeof CATEGORY) => CATEGORY[c].label;

  // Search page (full screen while typing, like Google Maps). Forgiving: first-time visitors
  // don't know exact names or spellings. "Nearest toilet" answers and named spots come first.
  const results = h('ul', { class: 'list', 'aria-live': 'polite' });
  const heading = h('h2', {}, tr('choose.all'));
  const go = (target: Parameters<typeof ctx.dispatch>[0]) => () => ctx.dispatch(target);
  const showResults = (query: string) => {
    const found = searchRooms(site, query, label, here);
    const services = searchAmenities(site, query, stepFree);
    const buildings = searchBuildings(site, query);
    // A building's own doors are covered by the building's result.
    const spots = searchSpots(site, query).filter(
      (s) => !buildings.some((b) => s.name.startsWith(b.name)),
    );
    const rows: HTMLElement[] = [
      ...buildings.map((b) =>
        h(
          'li',
          {},
          button(
            `🏢 ${b.name}`,
            go({
              type: 'choose',
              target: { destination: { type: 'node', nodeId: b.nodeId }, label: b.name },
            }),
            'item place building',
          ),
        ),
      ),
      ...services.map((chip) =>
        h(
          'li',
          {},
          button(
            `${chip.emoji} ${tr('choose.nearest')} ${tr(chip.labelKey).toLowerCase()}`,
            go({
              type: 'choose',
              target: {
                destination: { type: 'amenity', kinds: chip.kinds },
                label: tr(chip.labelKey),
              },
            }),
            'item place service',
          ),
        ),
      ),
      ...spots.map((spot) =>
        h(
          'li',
          {},
          button(
            `📍 ${spot.name}`,
            go({
              type: 'choose',
              target: { destination: { type: 'node', nodeId: spot.nodeId }, label: spot.name },
            }),
            'item place spot',
          ),
        ),
      ),
      ...found.slice(0, 60).map((r) => placeItem(ctx, r)),
    ];
    heading.textContent = query.trim() ? tr('choose.results') : tr('choose.all');
    const close =
      query.trim() && buildings.length === 0 && found.length > 0 && (found[0]?.score ?? 1) < 0.85;
    if (rows.length === 0) {
      // Nothing at all: say so kindly, and offer the help desk and a few kinds of place.
      const help = amenityChips(site, stepFree).find((c) => c.labelKey === 'chip.help');
      replace(
        results,
        h('li', { class: 'muted none' }, tr('choose.none-for', { query: query.trim() })),
        help
          ? h(
              'li',
              {},
              button(
                `${help.emoji} ${tr('choose.ask-help')}`,
                go({
                  type: 'choose',
                  target: {
                    destination: { type: 'amenity', kinds: help.kinds },
                    label: tr(help.labelKey),
                  },
                }),
                'item place service',
              ),
            )
          : null,
      );
    } else {
      replace(
        results,
        close
          ? h('li', { class: 'muted close' }, tr('choose.close', { query: query.trim() }))
          : null,
        ...rows,
      );
    }
  };
  showResults('');
  let screen: HTMLElement | null = null;
  const setSearching = (on: boolean) => screen?.classList.toggle('searching', on);
  const search = h('input', {
    type: 'search',
    placeholder: tr('choose.placeholder', { site: site.map.site.name }),
    'aria-label': tr('choose.placeholder', { site: site.map.site.name }),
    autocomplete: 'off',
    onInput: (event: Event) => showResults((event.target as HTMLInputElement).value),
    onFocus: () => setSearching(true),
    onKeydown: (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeSearch();
    },
  });
  const closeSearch = () => {
    search.value = '';
    showResults('');
    search.blur();
    setSearching(false);
  };
  const searchBar = h(
    'div',
    { class: 'searchbar' },
    h('span', { class: 'logo', 'aria-hidden': 'true' }, icon('arrive')),
    roundButton('back', tr('search.back'), closeSearch, 'back'),
    search,
    ctx.scan ? roundButton('qr', tr('scan'), ctx.scan, 'scan') : null,
  );

  // Chips under the search bar: nearest amenities go straight there; categories search.
  const amenity = amenityChips(site, stepFree).map((chip) =>
    button(
      `${chip.emoji} ${tr(chip.labelKey)}`,
      () =>
        ctx.dispatch({
          type: 'choose',
          target: { destination: { type: 'amenity', kinds: chip.kinds }, label: tr(chip.labelKey) },
        }),
      `chip a-${chip.labelKey.slice(5)}`,
    ),
  );
  const categories = [...new Set(site.map.rooms.map((r) => r.category))]
    .filter((c) => c !== 'staff')
    .map((c) =>
      button(
        `${CATEGORY[c].emoji} ${CATEGORY[c].label}`,
        () => {
          search.value = CATEGORY[c].label;
          showResults(search.value);
          search.focus();
        },
        `chip cat-${c}`,
      ),
    );

  // Bottom sheet: where you are, then every place (Google's "Explore" list).
  const places = h(
    'ul',
    { class: 'list places' },
    ...searchRooms(site, '', label).map((r) => placeItem(ctx, r)),
  );

  screen = mapScreen(ctx, 'choose', {
    top: [
      searchBar,
      h(
        'div',
        { class: 'chips scroll', 'aria-label': tr('choose.nearest') },
        ...amenity,
        ...categories,
      ),
    ],
    sheet: [
      h(
        'div',
        { class: 'tab-explore' },
        h(
          'p',
          { class: 'here' },
          h('span', { class: 'you-dot', 'aria-hidden': 'true' }),
          h(
            'span',
            { class: 'grow' },
            tr('choose.you-are-at', { place: '' }),
            h('strong', {}, hereName),
          ),
          button(tr('choose.change'), () => ctx.dispatch({ type: 'ask-position' }), 'link'),
        ),
        h(
          'div',
          { class: 'sheet-title' },
          title(tr('choose.title')),
          stepFreeToggle(ctx),
          bigTextToggle(),
        ),
        h('p', { class: 'tip' }, icon('search'), tr('choose.tap-hint')),
        recentList(ctx),
        places,
      ),
    ],
    extra: [h('div', { class: 'search-page' }, heading, results)],
  });
  return screen;
}

function recentList(ctx: ViewContext): HTMLElement | null {
  const { recent, site } = ctx.state;
  const rooms = recent.flatMap((r) =>
    r.destination.type === 'room'
      ? (site?.map.rooms.filter(
          (room) => r.destination.type === 'room' && room.id === r.destination.roomId,
        ) ?? [])
      : [],
  );
  if (rooms.length === 0) return null;
  return h(
    'div',
    { class: 'recent' },
    h('h2', {}, tr('choose.recent')),
    h(
      'div',
      { class: 'chips' },
      ...rooms.map((room) =>
        button(
          `${roomIcon(room, CATEGORY[room.category].emoji)} ${room.name}`,
          () => ctx.dispatch({ type: 'show-place', roomId: room.id }),
          `chip cat-${room.category}`,
        ),
      ),
    ),
  );
}

function lostView(ctx: ViewContext): HTMLElement {
  const site = ctx.state.site;
  const nearby = site ? nearbyLandmarks(site, currentNode(ctx.state)) : [];
  return h(
    'section',
    { class: 'screen' },
    title(tr('lost.title'), '😕'),
    positionPicker(ctx),
    nearby.length > 0 && h('h2', {}, tr('lost.see')),
    nearby.length > 0 &&
      pickList(
        nearby.map((n) => ({
          label: n.landmark,
          position: { node: n.id, source: 'picked' as const },
        })),
        ctx,
      ),
    button(tr('lost.back'), () => ctx.dispatch({ type: 'found-way' }), 'btn', 'back'),
  );
}

function noRouteView(
  ctx: ViewContext,
  reason: 'unknown-start' | 'unknown-destination' | 'no-route',
): HTMLElement {
  return h(
    'section',
    { class: 'screen center' },
    title(tr('no-route.title'), '🚧'),
    h('p', { class: 'muted' }, tr(`no-route.${reason}`)),
    ctx.state.blocked.length > 0 && h('p', { class: 'hint' }, tr('blocked.none')),
    ctx.state.stepFree && stepFreeToggle(ctx),
    button(tr('no-route.choose'), () => ctx.dispatch({ type: 'new-destination' }), 'btn primary'),
  );
}

// ---------- the trip screens load just after the first one ----------
// Card, preview, walking and arrival live in ./trip (own chunk), so the first screen after
// a QR scan downloads less on 2G. main.ts starts the download once the home screen shows;
// the service worker keeps it for offline use like every other file.

type TripScreens = typeof TripModule;
let trip: TripScreens | null = null;
let loading: Promise<TripScreens> | null = null;
let whenLoaded: (() => void) | null = null;

/** Starts (once) downloading the trip screens; `onLoaded` re-renders when they arrive. */
export function loadTripScreens(onLoaded?: () => void): Promise<TripScreens> {
  if (onLoaded) whenLoaded = onLoaded;
  loading ??= import('./trip').then((module) => {
    trip = module;
    whenLoaded?.();
    return module;
  });
  return loading;
}

function waitForScreens(): HTMLElement {
  void loadTripScreens();
  return h('section', { class: 'screen center' }, h('p', { class: 'muted' }, tr('loading')));
}
