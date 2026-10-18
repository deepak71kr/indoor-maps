/**
 * The floor change, shown as a building's floors stacked like plates (about 0.75 s):
 * the map tilts back, the old floor slides away (down when going up), the new floor comes in
 * from its place in the stack, and the map lies flat again. Plain CSS 3D through the Web
 * Animations API: no library, nothing to download. Skipped when the phone asks for less motion.
 *
 * Also the map key. Both load just after the first screen: only needed later.
 */
import type { Site } from '@innermap/core';
import type { Room, Shape } from '@innermap/schema';
import { CATEGORY, tr } from '../app/i18n';
import { h } from './dom';
import './map-extras.css';

export interface Plate {
  readonly name: string;
  readonly color: string;
}

const DURATION = 750;
const EASE = 'cubic-bezier(0.3, 0.7, 0.2, 1)';
const TILT = 'rotateX(52deg) scale(0.74)';

/**
 * Plays the change on `host` (the map box): `ghost` is a copy of the old floor as it looked,
 * `svg` already shows the new floor; `plates` are the building's floors from the bottom up.
 */
export function playFloorChange(
  host: HTMLElement,
  svg: SVGSVGElement,
  ghost: SVGSVGElement,
  plates: readonly Plate[],
  from: number,
  to: number,
): void {
  const up = to > from;
  const gap = 18; // % of the map height between two floors in the stack
  const away = `${up ? '' : '-'}${gap * 3}%`;
  const comeFrom = `${up ? '-' : ''}${gap * 3}%`;

  // The other floors, as thin coloured plates above and below.
  const stack = h(
    'div',
    { class: 'floor-plates', 'aria-hidden': 'true' },
    ...plates.map((p, i) =>
      h(
        'div',
        {
          class: `plate lvl-${p.color}${i === to ? ' to' : ''}`,
          style: `--y:${(to - i) * gap}%`,
        },
        h('span', {}, p.name),
      ),
    ),
  );
  ghost.classList.add('floor-ghost');
  ghost.removeAttribute('role');
  ghost.setAttribute('aria-hidden', 'true');
  // The plates lie behind the map; the old floor's copy on top of it as it slides away.
  host.prepend(stack);
  host.append(ghost);

  stack.animate(
    [{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }],
    {
      duration: DURATION,
      easing: 'ease-in-out',
    },
  ).onfinish = () => stack.remove();
  ghost.animate(
    [
      { transform: 'none', opacity: 1 },
      { transform: `translateY(0) ${TILT}`, opacity: 1, offset: 0.35 },
      { transform: `translateY(${away}) ${TILT}`, opacity: 0 },
    ],
    { duration: DURATION, easing: EASE, fill: 'forwards' },
  ).onfinish = () => ghost.remove();
  svg.animate(
    [
      { transform: `translateY(${comeFrom}) ${TILT}`, opacity: 0 },
      { transform: `translateY(0) ${TILT}`, opacity: 1, offset: 0.65 },
      { transform: 'none', opacity: 1 },
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
