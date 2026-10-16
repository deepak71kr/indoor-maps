import type { Step } from '@innermap/core';
import { CATEGORY, tr } from '../app/i18n';
import type { RoomResult } from '../app/search';
import { amenityChips, nearbyLandmarks, resolvePosition, searchRooms } from '../app/search';
import { sceneFor } from '../app/map-scene';
import type { Action, Position, State } from '../app/state';
import { currentNode } from '../app/state';
import type { Child } from './dom';
import { h, replace } from './dom';
import type { IconName } from './icons';
import { icon } from './icons';
import { MapView } from './map-view';

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

function mapPanel(ctx: ViewContext): MapView | null {
  const scene = sceneFor(ctx.state);
  if (!scene) return null;
  mapView ??= new MapView();
  // On the home screen a tap on a room on the map picks it as the destination.
  const site = ctx.state.site;
  mapView.onPick =
    ctx.state.screen.name === 'choose' && site
      ? (roomId) => {
          const room = site.map.rooms.find((r) => r.id === roomId);
          if (room)
            ctx.dispatch({
              type: 'choose',
              target: { destination: { type: 'room', roomId }, label: room.name },
            });
        }
      : null;
  mapView.update(scene);
  return mapView;
}

/** Minutes and meters still to go from step `from` (~1 m/s indoors, ~45 s per lift ride). */
function tripStats(steps: readonly Step[], from: number): { minutes: number; meters: number } {
  const left = steps.slice(from);
  const meters = left.reduce((sum, s) => sum + s.meters, 0);
  const rides = left.filter((s) => s.kind === 'ride').length;
  return { minutes: Math.max(1, Math.round(meters / 60 + rides * 0.75)), meters };
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
      h('div', { class: 'bottom covers-map' }, map.locate, sheet),
    ),
    ...nodes(layout.extra ?? []),
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
    h('span', { class: `poi cat-${room.category}`, 'aria-hidden': 'true' }, cat.emoji),
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
    button(content, () => ctx.dispatch({ type: 'choose', target }), 'item place'),
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
      'chip',
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
        'chip',
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
      h('div', { class: 'sheet-title' }, title(tr('choose.title')), stepFreeToggle(ctx)),
      h('p', { class: 'tip' }, icon('search'), tr('choose.tap-hint')),
      places,
    ],
    extra: [h('div', { class: 'search-page' }, h('h2', {}, tr('choose.all')), results)],
  });
  return screen;
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
    ],
    sheet: [
      h(
        'div',
        { class: 'trip-bar' },
        roundButton(
          'close',
          tr('step.end'),
          () => ctx.dispatch({ type: 'new-destination' }),
          'end',
        ),
        h(
          'div',
          { class: 'grow trip-info' },
          h(
            'p',
            { class: 'eta' },
            h('strong', {}, tr('step.min', { min: minutes })),
            ` · ${tr('step.m', { m: meters })}`,
          ),
          h(
            'p',
            { class: 'trip-head' },
            tr('step.to', { place: '' }),
            h('strong', {}, target?.label ?? ''),
            ` · ${tr('step.of', { n: index + 1, total })}`,
          ),
        ),
        roundButton('help', tr('step.lost'), () => ctx.dispatch({ type: 'lost' }), 'lost'),
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
      button(tr('step.here'), () => ctx.dispatch({ type: 'confirm' }), 'btn primary big', 'check'),
      h(
        'div',
        { class: 'links' },
        button(tr('step.back'), () => ctx.dispatch({ type: 'back' }), 'link', 'back'),
        site && site.map.qr.length > 0 && h('p', { class: 'tip' }, icon('qr'), tr('step.tip')),
      ),
    ],
  });
}

/** The green direction banner of Google Maps navigation, with "Then …" underneath. */
/**
 * The green direction banner of Google Maps navigation, named by checkpoints:
 *   ↱  Turn RIGHT                       4 m
 *      from Reception desk → Lift A
 * and "Then …" underneath. The full sentence is read out to screen readers.
 */
function banner(step: Step, index: number, next: Step | undefined, sign: boolean): HTMLElement {
  return h(
    'article',
    { class: 'banner step', 'data-step': index },
    h('p', { class: 'step-text sr-only', 'aria-live': 'polite' }, step.text),
    h(
      'div',
      { class: 'banner-main', 'aria-hidden': 'true' },
      h('div', { class: 'step-icon' }, icon(step.icon, 'icon huge')),
      h(
        'div',
        { class: 'grow' },
        h(
          'p',
          { class: 'step-title' },
          h('span', { class: 'grow' }, step.title),
          step.meters > 0 && h('span', { class: 'step-meters' }, tr('step.m', { m: step.meters })),
        ),
        sign && h('p', { class: 'route-line' }, tr('step.sign')),
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
      ),
    ],
    sheet: [
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
            floorBadge(s.levelName, s.levelColor, buildingOf(ctx.state, s.target)),
          ])
          .filter((c): c is HTMLElement => c !== null),
      ),
      button(
        tr('preview.start'),
        () => ctx.dispatch({ type: 'start' }),
        'btn primary big',
        'straight',
      ),
      stepFreeToggle(ctx),
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
    ctx.state.stepFree && stepFreeToggle(ctx),
    button(tr('no-route.choose'), () => ctx.dispatch({ type: 'new-destination' }), 'btn primary'),
  );
}
