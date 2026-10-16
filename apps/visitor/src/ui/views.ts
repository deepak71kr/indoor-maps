import type { Step } from '@innermap/core';
import { CATEGORY, tr } from '../app/i18n';
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

function mapPanel(state: State): HTMLElement | null {
  const scene = sceneFor(state);
  if (!scene) return null;
  mapView ??= new MapView();
  mapView.update(scene);
  return mapView.el;
}

/**
 * Map screens, Google-Maps style: the map fills the screen and the controls sit in a sheet —
 * at the bottom on phones (tap the handle to make it taller), beside the map on wide screens.
 * Without a map (no position yet) the plain page layout is used instead.
 */
function mapScreen(ctx: ViewContext, cls: string, ...sheet: Child[]): HTMLElement {
  const map = mapPanel(ctx.state);
  const content = sheet.filter((c): c is Node => c instanceof Node);
  if (!map) return h('section', { class: `screen ${cls}` }, ...content);
  const panel = h('div', { class: 'sheet' });
  const handle = h('button', {
    type: 'button',
    class: 'handle',
    'aria-label': tr('sheet.more'),
    'aria-expanded': 'false',
    onClick: () => setSheetOpen(panel, !panel.classList.contains('open')),
  });
  panel.append(handle, ...content);
  return h(
    'section',
    { class: `screen mapped ${cls}` },
    h(
      'header',
      { class: 'topbar' },
      icon('arrive'),
      h('span', { class: 'grow' }, ctx.state.site?.map.site.name ?? ''),
    ),
    map,
    panel,
  );
}

function setSheetOpen(panel: HTMLElement, open: boolean): void {
  panel.classList.toggle('open', open);
  const handle = panel.querySelector('.handle');
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

function chooseView(ctx: ViewContext): HTMLElement {
  const { site, stepFree } = ctx.state;
  if (!site) return h('section');
  const here = currentNode(ctx.state);
  const hereName = (here && site.graph.nodes.get(here)?.landmark) ?? here ?? '';
  const levels = new Map(site.graph.levels.map((l) => [l.id, l]));

  const results = h('ul', { class: 'list', 'aria-live': 'polite' });
  // Browsing by category makes way for the results while the visitor types.
  const browse = h('div', { class: 'stack' });
  const showResults = (query: string) => {
    browse.hidden = query.trim() !== '';
    const found = searchRooms(site, query, (c) => CATEGORY[c].label);
    if (found.length === 0) {
      replace(results, h('li', { class: 'muted' }, tr('choose.none')));
      return;
    }
    replace(
      results,
      ...found.map(({ room, levelId, building, target }) => {
        const level = levels.get(levelId);
        const cat = CATEGORY[room.category];
        return h(
          'li',
          {},
          button(
            [
              h('span', { class: 'emoji', 'aria-hidden': 'true' }, cat.emoji),
              h(
                'span',
                { class: 'grow' },
                room.name,
                room.number ? h('small', {}, ` ${room.number}`) : null,
              ),
              room.visibility === 'locked' ? icon('lock') : null,
              level ? floorBadge(level.name, level.color, building) : null,
            ].reduce<DocumentFragment>((frag, child) => {
              if (child) frag.append(child);
              return frag;
            }, document.createDocumentFragment()),
            () => ctx.dispatch({ type: 'choose', target }),
            'item place',
          ),
        );
      }),
    );
  };

  const search = h('input', {
    type: 'search',
    placeholder: tr('choose.placeholder'),
    'aria-label': tr('choose.placeholder'),
    onInput: (event: Event) => showResults((event.target as HTMLInputElement).value),
    // Typing needs room for the results: the sheet grows over the map.
    onFocus: (event: Event) => {
      const panel = (event.target as HTMLElement).closest<HTMLElement>('.sheet');
      if (panel) setSheetOpen(panel, true);
    },
  });
  showResults('');

  const categories = [...new Set(site.map.rooms.map((r) => r.category))].filter(
    (c) => c !== 'staff',
  );
  browse.append(
    h('h2', {}, tr('choose.all')),
    h(
      'div',
      { class: 'chips' },
      ...categories.map((c) =>
        button(
          `${CATEGORY[c].emoji} ${CATEGORY[c].label}`,
          () => {
            search.value = CATEGORY[c].label;
            showResults(search.value);
          },
          'chip',
        ),
      ),
    ),
  );

  const chips = amenityChips(site, stepFree).map((chip) =>
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

  return mapScreen(
    ctx,
    'choose',
    h(
      'p',
      { class: 'here' },
      icon('arrive'),
      h(
        'span',
        { class: 'grow' },
        tr('choose.you-are-at', { place: '' }),
        h('strong', {}, hereName),
      ),
      button(tr('choose.change'), () => ctx.dispatch({ type: 'ask-position' }), 'link'),
    ),
    title(tr('choose.title')),
    h('label', { class: 'search' }, icon('search'), search),
    chips.length > 0 &&
      h('div', { class: 'chips scroll', 'aria-label': tr('choose.nearest') }, ...chips),
    stepFreeToggle(ctx),
    browse,
    results,
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
  const left = steps.slice(index);
  const meters = left.reduce((sum, s) => sum + s.meters, 0);
  const rides = left.filter((s) => s.kind === 'ride').length;
  // ~1 m/s indoors with people around; each lift/stairs ride adds ~45 s.
  const minutes = Math.max(1, Math.round(meters / 60 + rides * 0.75));

  return mapScreen(
    ctx,
    `trip lvl-${step.levelColor}`,
    h(
      'p',
      { class: 'trip-head' },
      tr('step.to', { place: '' }),
      h('strong', {}, target?.label ?? ''),
      h('small', {}, ` · ${tr('step.eta', { min: minutes, m: meters })}`),
    ),
    h(
      'div',
      { class: 'progress' },
      floorBadge(step.levelName, step.levelColor, buildingOf(ctx.state, step.target)),
      h('span', { class: 'grow' }, tr('step.of', { n: index + 1, total })),
      h(
        'span',
        { class: 'dots', 'aria-hidden': 'true' },
        ...steps.slice(0, total).map((_, i) => h('i', { class: i <= index ? 'on' : '' })),
      ),
    ),
    notice === 'rerouted' && h('p', { class: 'notice', role: 'status' }, tr('rerouted')),
    stepCard(step, index, steps[index + 1], () => ctx.dispatch({ type: 'new-destination' })),
    button(tr('step.here'), () => ctx.dispatch({ type: 'confirm' }), 'btn primary big', 'check'),
    h(
      'div',
      { class: 'row' },
      button(tr('step.lost'), () => ctx.dispatch({ type: 'lost' }), 'btn small', 'help'),
      button(tr('step.back'), () => ctx.dispatch({ type: 'back' }), 'btn small', 'back'),
    ),
    site && site.map.qr.length > 0 && h('p', { class: 'tip' }, icon('qr'), tr('step.tip')),
  );
}

function stepCard(step: Step, index: number, next: Step | undefined, end: () => void): HTMLElement {
  return h(
    'article',
    { class: 'card step', 'data-step': index },
    h(
      'div',
      { class: 'step-main' },
      h('div', { class: 'step-icon' }, icon(step.icon, 'icon huge')),
      h(
        'div',
        { class: 'grow' },
        h('p', { class: 'step-text', 'aria-live': 'polite' }, step.text),
        step.meters > 0 && h('p', { class: 'step-meters' }, `≈ ${step.meters} m`),
      ),
      h('button', { type: 'button', class: 'end', onClick: end }, icon('close'), tr('step.end')),
    ),
    next && h('p', { class: 'step-next' }, tr('step.next', { text: next.text })),
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

function arrivedView(ctx: ViewContext): HTMLElement {
  const { steps, site, stepFree } = ctx.state;
  const arrive = steps[steps.length - 1];
  const toilet = site
    ? amenityChips(site, stepFree).find((c) => c.labelKey === 'chip.toilet')
    : undefined;
  return mapScreen(
    ctx,
    `center arrived lvl-${arrive?.levelColor ?? 'teal'}`,
    h('div', { class: 'step-icon' }, icon('arrive', 'icon huge')),
    h('h1', { tabindex: '-1', class: 'step-text' }, arrive?.text ?? ''),
    arrive && floorBadge(arrive.levelName, arrive.levelColor, buildingOf(ctx.state, arrive.target)),
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
    ctx.state.stepFree && stepFreeToggle(ctx),
    button(tr('no-route.choose'), () => ctx.dispatch({ type: 'new-destination' }), 'btn primary'),
  );
}
