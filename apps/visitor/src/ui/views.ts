import type { Step } from '@innermap/core';
import { findRoute, roomIcon } from '@innermap/core';
import { CATEGORY, tr } from '../app/i18n';
import type { RoomResult } from '../app/search';
import { amenityChips, nearbyLandmarks, resolvePosition, searchRooms } from '../app/search';
import { sceneFor } from '../app/map-scene';
import type { Action, Position, State } from '../app/state';
import { currentNode, tripStats, walkMinutes } from '../app/state';
import type { Child } from './dom';
import { h, replace } from './dom';
import type { IconName } from './icons';
import { icon } from './icons';
import { MapView, shortName } from './map-view';

export interface ViewContext {
  readonly state: State;
  readonly dispatch: (action: Action) => void;
  /** Opens the in-app scanner, or null when this phone can't scan in the browser. */
  readonly scan: (() => void) | null;
}

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
      return placeView(ctx, screen.roomId);
    case 'preview':
      return previewView(ctx);
    case 'navigate':
      return stepView(ctx, screen.step);
    case 'lost':
      return lostView(ctx);
    case 'arrived':
      return arrivedView(ctx);
    case 'no-route':
      return noRouteView(ctx, screen.reason);
  }
}

// ---------- shared pieces ----------

/** One map for the whole visit, so pan, zoom and the chosen floor survive re-renders. */
let mapView: MapView | null = null;
/** Compass state that may arrive before the first map is shown. */
let liveHeading: number | null = null;
let compassOffer: (() => Promise<boolean>) | null = null;

/** The phone's heading on the map (from main.ts's compass); the beam follows it. */
export function setLiveHeading(heading: number | null): void {
  liveHeading = heading;
  mapView?.setLiveHeading(heading);
}

/** iPhone: show a button that asks to use the compass. */
export function offerCompass(enable: () => Promise<boolean>): void {
  compassOffer = enable;
  mapView?.offerCompass(enable);
}

function mapPanel(ctx: ViewContext): MapView | null {
  const scene = sceneFor(ctx.state);
  if (!scene) return null;
  if (!mapView) {
    mapView = new MapView();
    if (liveHeading !== null) mapView.setLiveHeading(liveHeading);
    if (compassOffer) mapView.offerCompass(compassOffer);
  }
  // On the home screen a tap on a room on the map picks it as the destination.
  const site = ctx.state.site;
  // On the home screen (and an open card) a tap on a room opens its card, like Google Maps.
  const { name } = ctx.state.screen;
  mapView.onPick =
    (name === 'choose' || name === 'place') && site
      ? (roomId) => ctx.dispatch({ type: 'show-place', roomId })
      : null;
  mapView.update(scene);
  return mapView;
}

/** "10:42": when the visitor arrives if they leave now. */
function arrivalTime(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * While walking, Google shows sound on/off and Report (⚠️ = our "Path blocked?") just above
 * the bottom bar on the right; the Re-center pill sits on the left (CSS).
 */
function tripTools(ctx: ViewContext): HTMLElement | null {
  if (ctx.state.screen.name !== 'navigate') return null;
  const voice = voiceButton(ctx, 'map-btn trip-tool');
  const report = h(
    'button',
    {
      type: 'button',
      class: 'map-btn trip-tool report',
      'aria-label': tr('blocked.button'),
      title: tr('blocked.button'),
      onClick: () => ctx.dispatch({ type: 'block-ahead' }),
    },
    icon('warn'),
  );
  return h('div', { class: 'trip-tools' }, voice, report);
}

const nodes = (children: readonly Child[]): Node[] =>
  children.filter((c): c is Node => c instanceof Node);

interface MapLayout {
  /** Floats over the top of the map: search bar + chips, or the direction banner. */
  readonly top?: readonly Child[];
  /** The white sheet at the bottom (phones) / the side panel (laptops). */
  readonly sheet: readonly Child[];
  /** Full-screen layers, e.g. the search results page. */
  readonly extra?: readonly Child[];
}

/**
 * Map screens, Google Maps style: the map fills the whole screen; a search bar or direction
 * banner floats on top, the controls sit in a bottom sheet (phones) or a side panel (laptops).
 * Panels marked `covers-map` tell the map which part of it is hidden, so routes are framed in
 * the visible part. Without a map (no position yet) the plain page layout is used.
 */
function mapScreen(ctx: ViewContext, cls: string, layout: MapLayout): HTMLElement {
  const map = mapPanel(ctx);
  const top = nodes(layout.top ?? []);
  const content = nodes(layout.sheet);
  if (!map) return h('section', { class: `screen ${cls}` }, ...top, ...content);
  const sheet = h('div', { class: 'sheet' });
  sheet.append(sheetHandle(sheet), ...content);
  return h(
    'section',
    { class: `screen mapped ${cls}` },
    map.el,
    h(
      'div',
      { class: 'side' },
      h('div', { class: 'top covers-map' }, ...top, map.tools),
      h(
        'div',
        { class: 'bottom covers-map' },
        shortScreen() ? null : map.locate,
        tripTools(ctx),
        sheet,
      ),
    ),
    ...nodes(layout.extra ?? []),
  );
}

/**
 * Short phones: "my location" joins the button stack on the right instead of floating above
 * the sheet, where it could land on top of the floor buttons.
 */
function shortScreen(): boolean {
  const short = typeof matchMedia === 'function' && matchMedia('(max-height: 720px)').matches;
  if (short && mapView) mapView.tools.append(mapView.locate);
  return short;
}

// ---------- large text (older visitors), remembered on the phone ----------

const BIG_KEY = 'im.big';

/** Applies the saved text size; main.ts calls it at start. */
export function applyTextSize(): void {
  let big = false;
  try {
    big = localStorage.getItem(BIG_KEY) === '1';
  } catch {
    // No storage: normal size.
  }
  document.documentElement.classList.toggle('big-text', big);
}

/** "A+" switch: bigger letters and buttons everywhere. */
function bigTextToggle(): HTMLElement {
  const on = document.documentElement.classList.contains('big-text');
  return h(
    'button',
    {
      type: 'button',
      class: `chip text-size${on ? ' on' : ''}`,
      'aria-pressed': String(on),
      'aria-label': tr('big-text'),
      title: tr('big-text'),
      onClick: (e: Event) => {
        const now = !document.documentElement.classList.contains('big-text');
        document.documentElement.classList.toggle('big-text', now);
        try {
          localStorage.setItem(BIG_KEY, now ? '1' : '0');
        } catch {
          // Not remembered after a reload.
        }
        const el = e.currentTarget as HTMLElement;
        el.classList.toggle('on', now);
        el.setAttribute('aria-pressed', String(now));
      },
    },
    h('span', { 'aria-hidden': 'true' }, 'A'),
    h('b', { 'aria-hidden': 'true' }, 'A+'),
  );
}

/** Tap, or swipe up / down, to make the sheet taller or shorter. */
function sheetHandle(sheet: HTMLElement): HTMLButtonElement {
  let startY = 0;
  let swiped = false;
  return h('button', {
    type: 'button',
    class: 'handle',
    'aria-label': tr('sheet.more'),
    'aria-expanded': 'false',
    onPointerdown: (e: PointerEvent) => {
      startY = e.clientY;
      swiped = false;
    },
    onPointerup: (e: PointerEvent) => {
      const dy = e.clientY - startY;
      if (Math.abs(dy) > 24) {
        swiped = true;
        setSheetOpen(sheet, dy < 0);
      }
    },
    onClick: () => {
      if (!swiped) setSheetOpen(sheet, !sheet.classList.contains('open'));
      swiped = false;
    },
  });
}

function setSheetOpen(sheet: HTMLElement, open: boolean): void {
  sheet.classList.toggle('open', open);
  const handle = sheet.querySelector('.handle');
  handle?.setAttribute('aria-expanded', String(open));
  handle?.setAttribute('aria-label', tr(open ? 'sheet.less' : 'sheet.more'));
}

function title(text: string, emoji?: string): HTMLElement {
  return h(
    'h1',
    { tabindex: '-1' },
    emoji ? h('span', { 'aria-hidden': 'true' }, `${emoji} `) : null,
    text,
  );
}

/** "Floor 2", or "Block A · Floor 2" on a campus. */
function floorBadge(levelName: string, color: string, building?: string): HTMLElement {
  return h(
    'span',
    { class: `floor lvl-${color}` },
    building ? `${building} · ${levelName}` : levelName,
  );
}

function buildingOf(state: State, nodeId: string): string | undefined {
  return state.site?.buildingAt(nodeId)?.name;
}

function button(
  label: Child,
  onClick: () => void,
  cls = 'btn',
  iconName?: IconName,
): HTMLButtonElement {
  return h(
    'button',
    { type: 'button', class: cls, onClick },
    iconName ? icon(iconName) : null,
    label,
  );
}

/** A round icon button (Google's ✕ / ? in navigation); the label is for screen readers. */
function roundButton(
  iconName: IconName,
  label: string,
  onClick: () => void,
  cls = '',
): HTMLButtonElement {
  return h(
    'button',
    { type: 'button', class: `round ${cls}`, 'aria-label': label, title: label, onClick },
    icon(iconName),
  );
}

/** "Type a code or room number" form + optional scan button. Used by Where-am-I and Lost. */
function positionPicker(ctx: ViewContext): HTMLElement {
  const site = ctx.state.site;
  const error = h('p', { class: 'error', role: 'alert' });
  const input = h('input', {
    type: 'text',
    inputmode: 'text',
    autocapitalize: 'characters',
    autocomplete: 'off',
    placeholder: tr('where.placeholder'),
    'aria-label': tr('where.placeholder'),
  });
  const form = h(
    'form',
    {
      class: 'row code-form',
      onSubmit: (event: Event) => {
        event.preventDefault();
        const position = site ? resolvePosition(site, input.value) : null;
        if (position) ctx.dispatch({ type: 'set-position', position });
        else error.textContent = tr('where.unknown', { text: input.value.trim() });
      },
    },
    input,
    h('button', { type: 'submit', class: 'btn primary' }, tr('where.go')),
  );
  return h(
    'div',
    { class: 'stack' },
    ctx.scan
      ? button(tr('scan'), ctx.scan, 'btn primary big', 'qr')
      : h('p', { class: 'hint' }, icon('qr'), tr('scan.hint')),
    h('p', { class: 'muted' }, tr('where.hint')),
    form,
    error,
  );
}

function pickList(
  items: Array<{ label: string; position: Position }>,
  ctx: ViewContext,
): HTMLElement {
  return h(
    'ul',
    { class: 'list' },
    ...items.map((item) =>
      h(
        'li',
        {},
        button(
          item.label,
          () => ctx.dispatch({ type: 'set-position', position: item.position }),
          'item',
        ),
      ),
    ),
  );
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

/** One place in a list, Google style: category badge, name, details, floor. */
function placeItem(ctx: ViewContext, result: RoomResult): HTMLElement {
  const { room, levelId, building, target } = result;
  const level = ctx.state.site?.graph.levels.find((l) => l.id === levelId);
  const cat = CATEGORY[room.category];
  const details = [room.number, cat.label].filter(Boolean).join(' · ');
  const content = document.createDocumentFragment();
  content.append(
    h(
      'span',
      { class: `poi cat-${room.category}`, 'aria-hidden': 'true' },
      roomIcon(room, cat.emoji),
    ),
    h(
      'span',
      { class: 'grow' },
      h('span', { class: 'name' }, room.name),
      h('small', {}, ` ${details}`),
    ),
  );
  if (room.visibility === 'locked') content.append(icon('lock'));
  if (level) content.append(floorBadge(level.name, level.color, building));
  return h(
    'li',
    {},
    button(
      content,
      () =>
        target.destination.type === 'room'
          ? ctx.dispatch({ type: 'show-place', roomId: target.destination.roomId })
          : ctx.dispatch({ type: 'choose', target }),
      'item place',
    ),
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

/** Route options under Start: fastest / shortest (Google's "Options"), and step-free. */
function routeOptions(ctx: ViewContext): HTMLElement {
  const option = (value: 'fastest' | 'shortest', text: string) =>
    h(
      'button',
      {
        type: 'button',
        class: `chip option${ctx.state.preference === value ? ' on' : ''}`,
        'aria-pressed': String(ctx.state.preference === value),
        onClick: () => ctx.dispatch({ type: 'set-preference', preference: value }),
      },
      text,
    );
  return h(
    'div',
    { class: 'options', role: 'group', 'aria-label': tr('route.options') },
    option('fastest', tr('route.fastest')),
    option('shortest', tr('route.shortest')),
  );
}

function stepFreeToggle(ctx: ViewContext): HTMLElement {
  return h(
    'label',
    { class: 'toggle' },
    h('input', {
      type: 'checkbox',
      checked: ctx.state.stepFree,
      onChange: () => ctx.dispatch({ type: 'toggle-step-free' }),
    }),
    icon('wheelchair'),
    h('span', {}, tr('step-free')),
  );
}

function stepView(ctx: ViewContext, index: number): HTMLElement {
  const { steps, target, notice, site } = ctx.state;
  const step = steps[index];
  if (!step) return h('section');
  const total = steps.length - 1; // the last one is the arrival message
  const { minutes, meters } = tripStats(steps, index);

  return mapScreen(ctx, `trip lvl-${step.levelColor}`, {
    top: [
      banner(
        step,
        index,
        steps[index + 1],
        index === 0 && ctx.state.position?.facing !== undefined,
      ),
      notice === 'rerouted' && h('p', { class: 'toast', role: 'status' }, tr('rerouted')),
      notice === 'blocked' && h('p', { class: 'toast', role: 'status' }, tr('blocked.rerouted')),
    ],
    sheet: [
      // Google's 2026 bottom bar: a button left, the time in the middle, a red Exit pill right.
      h(
        'div',
        { class: 'trip-bar nav-bar' },
        roundButton('help', tr('step.lost'), () => ctx.dispatch({ type: 'lost' }), 'lost'),
        h(
          'div',
          { class: 'grow trip-info' },
          h('p', { class: 'eta' }, h('strong', {}, tr('step.min', { min: minutes }))),
          h('p', { class: 'trip-sub' }, `${tr('step.m', { m: meters })} · ${arrivalTime(minutes)}`),
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'exit-pill',
            'aria-label': tr('step.end'),
            onClick: () => ctx.dispatch({ type: 'new-destination' }),
          },
          tr('step.exit'),
        ),
      ),
      h(
        'p',
        { class: 'trip-head' },
        tr('step.to', { place: '' }),
        h('strong', {}, target?.label ?? ''),
        ` · ${tr('step.of', { n: index + 1, total })}`,
      ),
      h(
        'div',
        { class: 'progress' },
        floorBadge(step.levelName, step.levelColor, buildingOf(ctx.state, step.target)),
        h(
          'span',
          { class: 'dots', 'aria-hidden': 'true' },
          ...steps.slice(0, total).map((_, i) => h('i', { class: i <= index ? 'on' : '' })),
        ),
      ),
      button(
        tr('step.here'),
        () => ctx.dispatch({ type: 'confirm' }),
        'btn primary big go',
        'check',
      ),
      h(
        'div',
        { class: 'links' },
        button(tr('step.back'), () => ctx.dispatch({ type: 'back' }), 'link', 'back'),
        h(
          'button',
          {
            type: 'button',
            class: 'link',
            onClick: (e: Event) => {
              const sheet = (e.currentTarget as HTMLElement).closest<HTMLElement>('.sheet');
              if (sheet) setSheetOpen(sheet, !sheet.classList.contains('open'));
            },
          },
          icon('list'),
          tr('step.list'),
        ),
      ),
      site && site.map.qr.length > 0 && h('p', { class: 'tip' }, icon('qr'), tr('step.tip')),
      // All steps (Google's step list), the current one highlighted; shown when the sheet opens.
      stepList(steps, index),
    ],
  });
}

/** Every step of the trip: number, icon, short title, where to; `current` highlighted. */
function stepList(steps: readonly Step[], current: number): HTMLElement {
  return h(
    'ol',
    { class: 'steps' },
    ...steps.map((s, i) =>
      h(
        'li',
        {
          class: [
            s.kind === 'arrive' ? 'end' : '',
            i < current ? 'passed' : '',
            i === current ? 'now' : '',
          ]
            .filter(Boolean)
            .join(' '),
        },
        h(
          'span',
          { class: 'num', 'aria-hidden': 'true' },
          s.kind === 'arrive' ? '' : String(i + 1),
        ),
        icon(s.icon),
        h(
          'span',
          { class: 'grow' },
          h('b', {}, s.title),
          s.kind === 'walk' && s.to ? h('small', {}, ` → ${s.to}`) : null,
          s.via ? h('small', { class: 'via' }, tr('step.via', { place: s.via })) : null,
        ),
        s.meters > 0 ? h('small', {}, tr('step.m', { m: s.meters })) : null,
      ),
    ),
  );
}

// ---------- voice guidance (the phone's own speech engine: offline, no download) ----------

const VOICE_KEY = 'im.voice';
let lastSpoken = '';

function voiceOn(): boolean {
  try {
    return localStorage.getItem(VOICE_KEY) === '1';
  } catch {
    return false;
  }
}

function speak(text: string): void {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  speechSynthesis.speak(new SpeechSynthesisUtterance(text.replace(/[🎉🔒]/gu, '')));
}

/** 🔊 toggle in the trip bar; while on, each new step is read aloud once. */
function voiceButton(ctx: ViewContext, cls = 'round'): HTMLButtonElement | null {
  if (!('speechSynthesis' in window)) return null;
  const { screen, steps } = ctx.state;
  const step = screen.name === 'navigate' ? steps[screen.step] : undefined;
  const key = `${screen.name === 'navigate' ? screen.step : ''}|${step?.text ?? ''}`;
  if (voiceOn() && step && key !== lastSpoken) speak(step.text);
  lastSpoken = key;
  const on = voiceOn();
  return h(
    'button',
    {
      type: 'button',
      class: `${cls} voice${on ? ' on' : ''}`,
      'aria-label': tr(on ? 'step.voice-off' : 'step.voice-on'),
      'aria-pressed': String(on),
      title: tr(on ? 'step.voice-off' : 'step.voice-on'),
      onClick: (e: Event) => {
        const now = !voiceOn();
        try {
          localStorage.setItem(VOICE_KEY, now ? '1' : '0');
        } catch {
          // No storage: voice stays off after a reload.
        }
        const el = e.currentTarget as HTMLButtonElement;
        el.classList.toggle('on', now);
        el.setAttribute('aria-pressed', String(now));
        el.setAttribute('aria-label', tr(now ? 'step.voice-off' : 'step.voice-on'));
        replace(el, icon(now ? 'volume' : 'mute'));
        if (now && step) speak(step.text);
        else speechSynthesis.cancel();
      },
    },
    icon(on ? 'volume' : 'mute'),
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

/**
 * A room's card, Google style: the room highlighted on its floor, name, number · category,
 * floor, how far it is from you, and Directions / Start / Share.
 */
function placeView(ctx: ViewContext, roomId: string): HTMLElement {
  const { site, stepFree } = ctx.state;
  const room = site?.map.rooms.find((r) => r.id === roomId);
  if (!site || !room) return h('section');
  const door = site.graph.nodes.get(room.doors[0] ?? '');
  const level = site.graph.levels.find((l) => l.id === door?.level);
  const cat = CATEGORY[room.category];
  const here = currentNode(ctx.state);
  const target = { destination: { type: 'room' as const, roomId }, label: room.name };
  const route = here
    ? findRoute(site, { from: here, to: target.destination, profile: { stepFree } })
    : null;
  const away =
    route?.ok === true
      ? tr('place.from-you', {
          min: walkMinutes(route.value.walkingMeters, route.value.floorChanges),
          m: Math.round(route.value.walkingMeters),
        })
      : tr('place.no-route');
  const close = () => ctx.dispatch({ type: 'close-place' });
  const saved = ctx.state.saved.includes(roomId);

  const share = async (el: HTMLElement) => {
    const url = `${location.origin}${location.pathname}?site=${encodeURIComponent(site.map.site.id)}&to=${encodeURIComponent(roomId)}`;
    try {
      if (navigator.share) await navigator.share({ title: room.name, url });
      else {
        await navigator.clipboard.writeText(url);
        el.setAttribute('title', tr('place.copied'));
        el.setAttribute('aria-label', tr('place.copied'));
      }
    } catch {
      // Cancelled or blocked: nothing to do.
    }
  };

  return mapScreen(ctx, 'place-card', {
    top: [
      h(
        'div',
        { class: 'searchbar placebar' },
        roundButton('back', tr('search.back'), close, 'back show'),
        h('span', { class: 'grow' }, room.name),
        roundButton('close', tr('place.close'), close),
      ),
    ],
    sheet: [
      h(
        'div',
        { class: 'place-head' },
        h(
          'span',
          { class: `poi cat-${room.category}`, 'aria-hidden': 'true' },
          roomIcon(room, cat.emoji),
        ),
        h(
          'div',
          { class: 'grow' },
          title(room.name),
          h('p', { class: 'muted' }, [room.number, cat.label].filter(Boolean).join(' · ')),
        ),
        // Google-style: Share and ✕ as round grey buttons in the card's corner.
        h(
          'div',
          { class: 'head-btns' },
          roundButton(
            'share',
            tr('place.share'),
            () => void share(document.activeElement as HTMLElement),
            'grey',
          ),
          roundButton('close', tr('place.close'), close, 'grey'),
        ),
      ),
      h(
        'div',
        { class: 'floors-row' },
        level ? floorBadge(level.name, level.color, buildingOf(ctx.state, door?.id ?? '')) : null,
        h('span', { class: `away${route?.ok ? '' : ' warn'}` }, '🚶 ', away),
      ),
      room.visibility === 'locked' && h('p', { class: 'hint' }, icon('lock'), tr('place.locked')),
      h(
        'div',
        { class: 'actions' },
        button(
          tr('place.directions'),
          () => ctx.dispatch({ type: 'choose', target }),
          'btn primary',
          'directions',
        ),
        button(
          tr('place.start'),
          () => {
            ctx.dispatch({ type: 'choose', target });
            ctx.dispatch({ type: 'start' });
          },
          'btn outline',
          'straight',
        ),
        button(
          saved ? tr('place.saved') : tr('place.save'),
          () => ctx.dispatch({ type: 'toggle-save', roomId }),
          `btn outline save${saved ? ' on' : ''}`,
          'bookmark',
        ),
      ),
    ],
  });
}

/**
 * The green direction banner of Google Maps navigation, named by checkpoints:
 *   ↱  Turn RIGHT                       4 m
 *      from Reception desk → Lift A
 * and "Then …" underneath. The full sentence is read out to screen readers.
 */
function banner(step: Step, index: number, next: Step | undefined, sign: boolean): HTMLElement {
  return h(
    'article',
    // Coloured by the move, so "follow the colour" works for children and older visitors too.
    { class: `banner step move-${step.icon}`, 'data-step': index },
    h('p', { class: 'step-text sr-only', 'aria-live': 'polite' }, step.text),
    h(
      'div',
      { class: 'banner-main', 'aria-hidden': 'true' },
      step.kind === 'ride'
        ? // Lifts and stairs: the floor to go to, big, in that floor's colour.
          h(
            'div',
            { class: `floor-tile lvl-${step.levelColor}` },
            icon(step.icon),
            h('b', {}, shortName(step.levelName)),
          )
        : h('div', { class: 'step-icon' }, icon(step.icon, 'icon huge')),
      h(
        'div',
        { class: 'grow' },
        h('span', { class: `floor-chip lvl-${step.levelColor}` }, step.levelName),
        h(
          'p',
          { class: 'step-title' },
          h('span', { class: 'grow' }, step.title),
          step.meters > 0 && h('span', { class: 'step-meters' }, tr('step.m', { m: step.meters })),
        ),
        sign && h('p', { class: 'route-line sign' }, tr('step.sign')),
        step.kind === 'ride' &&
          h(
            'p',
            { class: 'route-line press' },
            step.icon === 'lift'
              ? tr('step.press', { floor: shortName(step.levelName) })
              : tr('step.get-off', { floor: step.levelName }),
          ),
        (step.from || step.to) &&
          h(
            'p',
            { class: 'route-line' },
            step.from ? tr('step.from', { place: '' }) : null,
            step.from ? h('b', {}, step.from) : null,
            step.to ? h('span', { class: 'arrow' }, ' → ') : null,
            step.to ? h('b', {}, step.to) : null,
          ),
        step.via && h('p', { class: 'route-line via' }, tr('step.via', { place: step.via })),
      ),
    ),
    next &&
      h(
        'p',
        { class: 'then' },
        h('span', {}, tr('step.then')),
        icon(next.icon),
        h(
          'span',
          { class: 'grow' },
          next.kind === 'walk' && next.to ? `${next.title} → ${next.to}` : next.title,
        ),
      ),
  );
}

/**
 * Before walking, Google-style: From / To on top, the whole route on the map with numbered
 * checkpoints, time and distance, the floors it crosses, every step, and a big Start button.
 */
function previewView(ctx: ViewContext): HTMLElement {
  const { site, steps, target, position } = ctx.state;
  if (!site) return h('section');
  const { minutes, meters } = tripStats(steps, 0);
  const startName =
    (position && site.graph.nodes.get(position.node)?.landmark) ?? position?.node ?? '';
  const checkpoints = steps.length - 1;
  // The floors on the way, in order: Ground → Floor 2.
  const floors = steps.reduce<Step[]>((list, s) => {
    if (list.at(-1)?.levelId !== s.levelId) list.push(s);
    return list;
  }, []);
  const via = steps.find((s) => s.kind === 'ride');
  // The other mode's time, for the tabs (Google shows car · transit · walk with their times).
  const other =
    position && target
      ? findRoute(site, {
          from: position.node,
          to: target.destination,
          profile: {
            stepFree: !ctx.state.stepFree,
            preference: ctx.state.preference,
            blocked: ctx.state.blocked,
          },
        })
      : null;
  const otherMinutes =
    other?.ok === true ? walkMinutes(other.value.walkingMeters, other.value.floorChanges) : null;
  const modeTab = (stepFreeTab: boolean, label: string) => {
    const on = ctx.state.stepFree === stepFreeTab;
    const time = on ? minutes : otherMinutes;
    return h(
      'button',
      {
        type: 'button',
        role: 'tab',
        class: `mode${on ? ' on' : ''}`,
        'aria-selected': String(on),
        onClick: () => !on && ctx.dispatch({ type: 'toggle-step-free' }),
      },
      label,
      h('b', {}, time === null ? '—' : tr('step.min', { min: time })),
    );
  };

  const field = (cls: string, label: string, text: string, onClick: () => void) =>
    h(
      'button',
      { type: 'button', class: `field ${cls}`, 'aria-label': label, onClick },
      h('span', { class: 'mark', 'aria-hidden': 'true' }),
      h('span', { class: 'grow' }, text),
    );

  return mapScreen(ctx, 'preview', {
    top: [
      h(
        'div',
        { class: 'directions' },
        roundButton('back', tr('search.back'), () => ctx.dispatch({ type: 'new-destination' })),
        h(
          'div',
          { class: 'fields' },
          field('from', tr('preview.from', { place: startName }), startName, () =>
            ctx.dispatch({ type: 'ask-position' }),
          ),
          field('to', tr('preview.to', { place: target?.label ?? '' }), target?.label ?? '', () =>
            ctx.dispatch({ type: 'new-destination' }),
          ),
        ),
        roundButton('swap', tr('preview.swap'), () => ctx.dispatch({ type: 'swap' }), 'swap'),
      ),
    ],
    sheet: [
      h(
        'div',
        { class: 'modes', role: 'tablist', 'aria-label': tr('route.modes') },
        modeTab(false, tr('route.walk')),
        modeTab(true, tr('route.step-free')),
      ),
      h(
        'div',
        { class: 'trip-bar' },
        h(
          'div',
          { class: 'grow trip-info' },
          h(
            'p',
            { class: 'eta' },
            h('strong', {}, tr('step.min', { min: minutes })),
            ` (${tr('step.m', { m: meters })})`,
          ),
          h(
            'p',
            { class: 'trip-sub' },
            tr(ctx.state.preference === 'shortest' ? 'route.why-shortest' : 'route.why-fastest'),
            ctx.state.stepFree ? ` · ${tr('route.why-step-free')}` : '',
          ),
          h(
            'p',
            { class: 'trip-head' },
            checkpoints === 1
              ? tr('preview.checkpoint')
              : tr('preview.checkpoints', { n: checkpoints }),
            via ? ` · ${via.text.replace(/\.$/, '')}` : '',
          ),
        ),
      ),
      h(
        'div',
        { class: 'floors-row' },
        ...floors
          .flatMap((s, i) => [
            i > 0 ? h('span', { class: 'arrow', 'aria-hidden': 'true' }, '→') : null,
            // Tap a floor to see that part of the route.
            h(
              'button',
              {
                type: 'button',
                class: 'floor-btn',
                'aria-label': tr('map.label', { floor: s.levelName }),
                onClick: () => mapView?.showFloor(s.levelId),
              },
              floorBadge(s.levelName, s.levelColor, buildingOf(ctx.state, s.target)),
            ),
          ])
          .filter((c): c is HTMLElement => c !== null),
      ),
      button(
        tr('preview.start'),
        () => ctx.dispatch({ type: 'start' }),
        'btn primary big',
        'straight',
      ),
      routeOptions(ctx),
      h('h2', {}, tr('preview.steps')),
      h(
        'ol',
        { class: 'steps' },
        ...steps.map((s, i) =>
          h(
            'li',
            { class: s.kind === 'arrive' ? 'end' : '' },
            h(
              'span',
              { class: 'num', 'aria-hidden': 'true' },
              s.kind === 'arrive' ? '' : String(i + 1),
            ),
            icon(s.icon),
            h(
              'span',
              { class: 'grow' },
              h('b', {}, s.title),
              s.kind === 'walk' && s.to ? h('small', {}, ` → ${s.to}`) : null,
              s.via ? h('small', { class: 'via' }, tr('step.via', { place: s.via })) : null,
            ),
            s.meters > 0 ? h('small', {}, tr('step.m', { m: s.meters })) : null,
          ),
        ),
      ),
    ],
  });
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

function arrivedView(ctx: ViewContext): HTMLElement {
  const { steps, site, stepFree } = ctx.state;
  const arrive = steps[steps.length - 1];
  const toilet = site
    ? amenityChips(site, stepFree).find((c) => c.labelKey === 'chip.toilet')
    : undefined;
  return mapScreen(ctx, `center arrived lvl-${arrive?.levelColor ?? 'teal'}`, {
    sheet: [
      h(
        'div',
        { class: 'confetti', 'aria-hidden': 'true' },
        ...Array.from({ length: 14 }, (_, i) => h('i', { style: { '--i': String(i) } })),
      ),
      h('div', { class: 'step-icon' }, icon('check', 'icon huge')),
      h('h1', { tabindex: '-1', class: 'step-text' }, arrive?.text ?? ''),
      arrive &&
        floorBadge(arrive.levelName, arrive.levelColor, buildingOf(ctx.state, arrive.target)),
      button(
        tr('arrived.new'),
        () => ctx.dispatch({ type: 'new-destination' }),
        'btn primary big',
        'search',
      ),
      toilet &&
        button(
          `${toilet.emoji} ${tr('choose.nearest')} ${tr('chip.toilet').toLowerCase()}`,
          () => {
            ctx.dispatch({ type: 'new-destination' });
            ctx.dispatch({
              type: 'choose',
              target: {
                destination: { type: 'amenity', kinds: toilet.kinds },
                label: tr('chip.toilet'),
              },
            });
          },
          'chip',
        ),
    ],
  });
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
