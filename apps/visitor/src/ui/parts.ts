/** Pieces shared by the first screens (views.ts) and the trip screens (trip.ts). */
import { roomIcon } from '@innermap/core';
import { CATEGORY, tr } from '../app/i18n';
import type { RoomResult } from '../app/search';
import { resolvePosition } from '../app/search';
import { sceneFor } from '../app/map-scene';
import type { Action, Position, State } from '../app/state';
import type { Child } from './dom';
import { h } from './dom';
import type { IconName } from './icons';
import { icon } from './icons';
import { MapView } from './map-view';

export interface ViewContext {
  readonly state: State;
  readonly dispatch: (action: Action) => void;
  /** Opens the in-app scanner, or null when this phone can't scan in the browser. */
  readonly scan: (() => void) | null;
}

// ---------- shared pieces ----------

/** One map for the whole visit, so pan, zoom and the chosen floor survive re-renders. */
export let mapView: MapView | null = null;
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

export function mapPanel(ctx: ViewContext): MapView | null {
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

export const nodes = (children: readonly Child[]): Node[] =>
  children.filter((c): c is Node => c instanceof Node);

export interface MapLayout {
  /** Floats over the top of the map: search bar + chips, or the direction banner. */
  readonly top?: readonly Child[];
  /** The white sheet at the bottom (phones) / the side panel (laptops). */
  readonly sheet: readonly Child[];
  /** Buttons just above the sheet (walking: sound and Report). */
  readonly tools?: HTMLElement | null;
  /** Full-screen layers, e.g. the search results page. */
  readonly extra?: readonly Child[];
}

/**
 * Map screens, Google Maps style: the map fills the whole screen; a search bar or direction
 * banner floats on top, the controls sit in a bottom sheet (phones) or a side panel (laptops).
 * Panels marked `covers-map` tell the map which part of it is hidden, so routes are framed in
 * the visible part. Without a map (no position yet) the plain page layout is used.
 */
export function mapScreen(ctx: ViewContext, cls: string, layout: MapLayout): HTMLElement {
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
        layout.tools ?? null,
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
export function shortScreen(): boolean {
  const short = typeof matchMedia === 'function' && matchMedia('(max-height: 720px)').matches;
  if (short && mapView) mapView.tools.append(mapView.locate);
  return short;
}

// ---------- large text (older visitors), remembered on the phone ----------

export const BIG_KEY = 'im.big';

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
export function bigTextToggle(): HTMLElement {
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
export function sheetHandle(sheet: HTMLElement): HTMLButtonElement {
  let startY = 0;
  let startH = 0;
  let dragging = false;
  let swiped = false;
  return h('button', {
    type: 'button',
    class: 'handle',
    'aria-label': tr('sheet.more'),
    'aria-expanded': 'false',
    onPointerdown: (e: PointerEvent) => {
      startY = e.clientY;
      startH = sheet.getBoundingClientRect().height;
      dragging = true;
      swiped = false;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    // The sheet follows the finger, then settles open or closed (whichever is nearer).
    onPointermove: (e: PointerEvent) => {
      if (!dragging) return;
      const dy = e.clientY - startY;
      if (Math.abs(dy) < 6) return;
      sheet.classList.add('dragging');
      sheet.style.maxHeight = `${Math.max(80, Math.min(innerHeight * 0.88, startH - dy))}px`;
    },
    onPointerup: (e: PointerEvent) => {
      dragging = false;
      const dy = e.clientY - startY;
      sheet.classList.remove('dragging');
      sheet.style.removeProperty('max-height');
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

/** The whole route on the map (the walking screen's menu). */
export function showRouteOverview(): void {
  mapView?.overviewRoute();
}

export function setSheetOpen(sheet: HTMLElement, open: boolean): void {
  sheet.classList.toggle('open', open);
  const handle = sheet.querySelector('.handle');
  handle?.setAttribute('aria-expanded', String(open));
  handle?.setAttribute('aria-label', tr(open ? 'sheet.less' : 'sheet.more'));
}

export function title(text: string, emoji?: string): HTMLElement {
  return h(
    'h1',
    { tabindex: '-1' },
    emoji ? h('span', { 'aria-hidden': 'true' }, `${emoji} `) : null,
    text,
  );
}

/** "Floor 2", or "Block A · Floor 2" on a campus. */
export function floorBadge(levelName: string, color: string, building?: string): HTMLElement {
  return h(
    'span',
    { class: `floor lvl-${color}` },
    building ? `${building} · ${levelName}` : levelName,
  );
}

/** "Floor 2", or "Block A · Floor 2" on a campus. */
export function floorBadgeText(levelName: string, building?: string): string {
  return building ? `${building} · ${levelName}` : levelName;
}

export function buildingOf(state: State, nodeId: string): string | undefined {
  return state.site?.buildingAt(nodeId)?.name;
}

export function button(
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
export function roundButton(
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
export function positionPicker(ctx: ViewContext): HTMLElement {
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

export function pickList(
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

/** One place in a list, Google style: category badge, name, details, floor. */
export function placeItem(ctx: ViewContext, result: RoomResult): HTMLElement {
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

export function stepFreeToggle(ctx: ViewContext): HTMLElement {
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
