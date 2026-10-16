import { roomIcon } from '@innermap/core';
import { CATEGORY, tr } from '../app/i18n';
import { amenityChips, nearbyLandmarks, searchRooms } from '../app/search';
import { currentNode } from '../app/state';
import { h, replace } from './dom';
import type { IconName } from './icons';
import { icon } from './icons';
import {
  mapScreen,
  bigTextToggle,
  setSheetOpen,
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
      return h('section', { class: 'screen center' }, h('p', { class: 'muted' }, tr('loading')));
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

  // Search page (full screen while typing, like Google Maps).
  const results = h('ul', { class: 'list', 'aria-live': 'polite' });
  const showResults = (query: string) => {
    const found = searchRooms(site, query, label);
    if (found.length === 0) replace(results, h('li', { class: 'muted' }, tr('choose.none')));
    else replace(results, ...found.map((r) => placeItem(ctx, r)));
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
      savedPanel(ctx),
      tabBar(),
    ],
    extra: [h('div', { class: 'search-page' }, h('h2', {}, tr('choose.all')), results)],
  });
  return screen;
}

/** Saved places (⭐ Save on a room card), Google's "You" tab for a building. */
function savedPanel(ctx: ViewContext): HTMLElement {
  const { site, saved } = ctx.state;
  const label = (c: keyof typeof CATEGORY) => CATEGORY[c].label;
  const rows = site ? searchRooms(site, '', label).filter((r) => saved.includes(r.room.id)) : [];
  return h(
    'div',
    { class: 'tab-saved' },
    h('h2', {}, tr('tab.saved')),
    rows.length > 0
      ? h('ul', { class: 'list' }, ...rows.map((r) => placeItem(ctx, r)))
      : h('p', { class: 'muted' }, tr('saved.empty')),
  );
}

/** Google's bottom bar (Explore · You · Contribute), here Explore · Saved. */
function tabBar(): HTMLElement {
  const tab = (name: 'explore' | 'saved', iconName: IconName) =>
    h(
      'button',
      {
        type: 'button',
        role: 'tab',
        class: name === 'explore' ? 'on' : '',
        'aria-selected': String(name === 'explore'),
        onClick: (e: Event) => {
          const bar = (e.currentTarget as HTMLElement).parentElement;
          const sheet = bar?.closest<HTMLElement>('.sheet');
          sheet?.classList.toggle('show-saved', name === 'saved');
          for (const b of bar?.children ?? []) {
            const on = b === e.currentTarget;
            b.classList.toggle('on', on);
            b.setAttribute('aria-selected', String(on));
          }
          if (name === 'saved' && sheet) setSheetOpen(sheet, true);
        },
      },
      h('span', { class: 'pill' }, icon(iconName)),
      tr(`tab.${name}`),
    );
  return h(
    'nav',
    { class: 'tabbar', role: 'tablist', 'aria-label': tr('tab.explore') },
    tab('explore', 'arrive'),
    tab('saved', 'bookmark'),
  );
}

/** Recently chosen rooms (Google's "Recent"), each opening its card. */
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
