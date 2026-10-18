/**
 * The floor change, shown as a zoom through the building: going up, the floor you were on
 * drops away and the new one comes down to you; going down, the other way. Web Animations
 * API, no library. Skipped when the phone asks for less motion.
 *
 * Also the map key. Both load just after the first screen: only needed later.
 */
import type { Site } from '@innermap/core';
import type { Room, Shape } from '@innermap/schema';
import { CATEGORY, tr } from '../app/i18n';
import { h } from './dom';
import './map-extras.css';

const DURATION = 620;
const EASE = 'cubic-bezier(0.25, 0.8, 0.25, 1)';

/**
 * Plays the change on `host` (the map box): `ghost` is a copy of the old floor as it looked,
 * `svg` already shows the new floor. Going up, the old floor shrinks away below you and the
 * new one settles down from above (bigger, closer); going down, the other way round — like
 * looking down a building's floors from a lift.
 */
export function playFloorChange(
  host: HTMLElement,
  svg: SVGSVGElement,
  ghost: SVGSVGElement,
  from: number,
  to: number,
): void {
  const up = to > from;
  ghost.classList.add('floor-ghost');
  ghost.removeAttribute('role');
  ghost.setAttribute('aria-hidden', 'true');
  host.append(ghost);
  ghost.animate(
    [
      { transform: 'scale(1)', opacity: 1 },
      { transform: `scale(${up ? 0.78 : 1.25})`, opacity: 0 },
    ],
    { duration: DURATION * 0.8, easing: EASE, fill: 'forwards' },
  ).onfinish = () => ghost.remove();
  svg.animate(
    [
      { transform: `scale(${up ? 1.22 : 0.8})`, opacity: 0 },
      { transform: 'scale(1)', opacity: 1 },
    ],
    { duration: DURATION, easing: EASE },
  );
  // A tiny buzz on phones that have it, so the change is felt too.
  navigator.vibrate?.(12);
}

/** The map key's contents: the kinds of room on this floor, then roads, paths, lawns. */
export function buildKey(site: Site, shapes: readonly Shape[]): HTMLElement[] {
  const rooms = new Map(site.map.rooms.map((r) => [r.id, r]));
  const seen = new Set<Room['category']>();
  for (const shape of shapes) {
    const room = shape.room ? rooms.get(shape.room) : undefined;
    if (room) seen.add(room.category);
  }
  const item = (cls: string, text: string) =>
    h('li', {}, h('i', { class: cls, 'aria-hidden': 'true' }), text);
  const kinds = new Set(shapes.map((x) => x.kind));
  return [
    h('p', { class: 'key-title' }, tr('map.key')),
    h(
      'ul',
      {},
      ...[...seen].map((c) => item(`sw cat-${c}`, CATEGORY[c].label)),
      kinds.has('road') ? item('sw road-major', tr('map.key-main-road')) : null,
      kinds.has('road') ? item('sw road-any', tr('map.key-road')) : null,
      kinds.has('path') ? item('sw path-any', tr('map.key-path')) : null,
      kinds.has('green') ? item('sw green-any', tr('map.key-green')) : null,
    ),
  ];
}

/** The building-and-floor chip; it slides in fresh when the building or floor changes. */
export function placeChip(
  el: HTMLElement,
  info: { building: string; floor: string; color: string } | null,
): void {
  if (!info) {
    el.classList.remove('on');
    return;
  }
  const key = `${info.building}|${info.floor}`;
  if (el.dataset['key'] === key && el.classList.contains('on')) return;
  el.dataset['key'] = key;
  el.replaceChildren(
    h('span', { class: 'pc-dot', 'aria-hidden': 'true' }),
    h('span', { class: 'pc-b' }, info.building),
    h('span', { class: `pc-f lvl-${info.color}` }, info.floor),
  );
  el.classList.add('on');
  el.animate(
    [
      { translate: '0 -8px', opacity: 0 },
      { translate: '0 0', opacity: 1 },
    ],
    {
      duration: 260,
      easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
    },
  );
}
