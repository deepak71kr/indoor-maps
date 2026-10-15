import type { Step } from '@innermap/core';
import { CATEGORY, tr } from '../app/i18n';
import { amenityChips, nearbyLandmarks, resolvePosition, searchRooms } from '../app/search';
import type { Action, Position, State } from '../app/state';
import { currentNode } from '../app/state';
import type { Child } from './dom';
import { h, replace } from './dom';
import type { IconName } from './icons';
import { icon } from './icons';

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

function title(text: string, emoji?: string): HTMLElement {
  return h(
    'h1',
    { tabindex: '-1' },
    emoji ? h('span', { 'aria-hidden': 'true' }, `${emoji} `) : null,
    text,
  );
}

function floorBadge(levelName: string, color: string): HTMLElement {
  return h('span', { class: `floor lvl-${color}` }, levelName);
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
  const showResults = (query: string) => {
    const found = searchRooms(site, query, (c) => CATEGORY[c].label);
    if (found.length === 0) {
      replace(results, h('li', { class: 'muted' }, tr('choose.none')));
      return;
    }
    replace(
      results,
      ...found.map(({ room, levelId, target }) => {
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
              level ? floorBadge(level.name, level.color) : null,
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
  });
  showResults('');

  const categories = [...new Set(site.map.rooms.map((r) => r.category))].filter(
    (c) => c !== 'staff',
  );
  const categoryChips = categories.map((c) =>
    button(
      `${CATEGORY[c].emoji} ${CATEGORY[c].label}`,
      () => {
        search.value = CATEGORY[c].label;
        showResults(search.value);
      },
      'chip',
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

  return h(
    'section',
    { class: 'screen' },
    h('p', { class: 'site' }, site.map.site.name),
    h(
      'p',
      { class: 'here' },
      icon('arrive'),
      h('span', { class: 'grow' }, tr('choose.you-are-at', { place: hereName })),
      button(tr('choose.change'), () => ctx.dispatch({ type: 'ask-position' }), 'link'),
    ),
    title(tr('choose.title'), '🔍'),
    h('label', { class: 'search' }, icon('search'), search),
    chips.length > 0 && h('h2', {}, tr('choose.nearest')),
    chips.length > 0 && h('div', { class: 'chips' }, ...chips),
    stepFreeToggle(ctx),
    h('h2', {}, tr('choose.all')),
    h('div', { class: 'chips' }, ...categoryChips),
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
  const { steps, target, notice } = ctx.state;
  const step = steps[index];
  if (!step) return h('section');
  const total = steps.length - 1; // the last one is the arrival message

  return h(
    'section',
    { class: `screen trip lvl-${step.levelColor}` },
    h(
      'header',
      { class: 'trip-head' },
      h('span', { class: 'grow' }, tr('step.to', { place: target?.label ?? '' })),
      h(
        'button',
        {
          type: 'button',
          class: 'icon-btn',
          'aria-label': tr('step.end'),
          onClick: () => ctx.dispatch({ type: 'new-destination' }),
        },
        icon('close'),
      ),
    ),
    h(
      'div',
      { class: 'progress' },
      floorBadge(step.levelName, step.levelColor),
      h('span', { class: 'grow' }, tr('step.of', { n: index + 1, total })),
      h(
        'span',
        { class: 'dots', 'aria-hidden': 'true' },
        ...steps.slice(0, total).map((_, i) => h('i', { class: i <= index ? 'on' : '' })),
      ),
    ),
    notice === 'rerouted' && h('p', { class: 'notice', role: 'status' }, tr('rerouted')),
    stepCard(step, index),
    button(tr('step.here'), () => ctx.dispatch({ type: 'confirm' }), 'btn primary big', 'check'),
    h(
      'div',
      { class: 'row' },
      button(tr('step.lost'), () => ctx.dispatch({ type: 'lost' }), 'btn', 'help'),
      button(tr('step.back'), () => ctx.dispatch({ type: 'back' }), 'btn', 'back'),
    ),
  );
}

function stepCard(step: Step, index: number): HTMLElement {
  return h(
    'article',
    { class: 'card step', 'data-step': index },
    h('div', { class: 'step-icon' }, icon(step.icon, 'icon huge')),
    h('p', { class: 'step-text', 'aria-live': 'polite' }, step.text),
    step.meters > 0 && h('p', { class: 'muted' }, `≈ ${step.meters} m`),
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
  return h(
    'section',
    { class: `screen center arrived lvl-${arrive?.levelColor ?? 'teal'}` },
    h('div', { class: 'step-icon' }, icon('arrive', 'icon huge')),
    h('h1', { tabindex: '-1', class: 'step-text' }, arrive?.text ?? ''),
    arrive && floorBadge(arrive.levelName, arrive.levelColor),
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
