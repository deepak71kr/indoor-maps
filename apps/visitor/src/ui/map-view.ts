/**
 * The 2D map (Phase 9): a hand-written SVG viewer — no map library (Leaflet alone is ~40 KB).
 * One instance lives for the whole visit and is re-attached on every render, so pan, zoom and
 * the chosen floor survive screen changes.
 *
 * Two layers:
 * - the plan, in meters, under one SVG transform (pan, zoom, rotate);
 * - an overlay in screen pixels (labels, icons, you-are-here), re-positioned on every frame
 *   so text stays upright and readable at any zoom and rotation.
 */
import type { Point, Site } from '@innermap/core';
import {
  boundsOf,
  containsPoint,
  doorGaps,
  labelPoint,
  projectOnSegment,
  routeLines,
  shapePoints,
  shapeSides,
} from '@innermap/core';
import type { Amenity, Room, Shape } from '@innermap/schema';
import { OUTDOOR_SHAPE_KINDS } from '@innermap/schema';
import { tr } from '../app/i18n';
import type { MapScene } from '../app/map-scene';
import { h } from './dom';

interface View {
  cx: number;
  cy: number;
  /** Pixels per meter. */
  s: number;
  /** Degrees; the plan is turned by -rot so `rot` points up. */
  rot: number;
}

interface Pin {
  readonly p: Point;
  readonly el: SVGGElement;
  /** Room labels: texts to try, longest first, and the outline they must fit in. */
  readonly fit?: { readonly texts: readonly string[]; readonly box: readonly Point[] };
  /** Degrees on the plan (0 = up): the icon turns with the map, e.g. an entrance arrow. */
  readonly angle?: number;
  /** Campus maps: building names show zoomed out, room names zoomed in. */
  readonly zoom?: 'far' | 'near';
}

const NS = 'http://www.w3.org/2000/svg';
const MIN_SCALE = 0.5;
const MAX_SCALE = 40;
/** Never zoom in so far that less than this many meters show. */
const MIN_EXTENT = 34;
/** Pixels per meter when framing: big screens show more of the building, not bigger rooms. */
const FIT_MAX_SCALE = 16;
const CHAR_PX = 6.6;
/** Below this many pixels per meter a campus shows buildings, not their insides. */
const FAR_SCALE = 4.5;
/** A tap moves the finger less than this (pixels); more is a drag. */
const TAP_PX = 8;

const AMENITY_EMOJI: Readonly<Record<Amenity['kind'], string>> = {
  toilet: '🚻',
  'toilet-accessible': '♿',
  water: '💧',
  atm: '🏧',
  'help-desk': 'ℹ️',
  wheelchair: '🦽',
  'prayer-room': '🛐',
  'baby-care': '🍼',
  charging: '🔌',
  'fire-extinguisher': '🧯',
  aed: '❤️',
};

const DOOR_KINDS = new Set(['door', 'entrance', 'lift-stop', 'stairs-stop']);

function s<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Readonly<Record<string, string | number>> = {},
  text?: string,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  if (text !== undefined) el.textContent = text;
  return el;
}

const flat = (points: readonly Point[]) => points.map((p) => `${p.x},${p.y}`).join(' ');
const rad = (deg: number) => (deg * Math.PI) / 180;

export class MapView {
  readonly el: HTMLElement;
  private readonly svg: SVGSVGElement;
  private readonly plan: SVGGElement;
  private readonly routeLayer: SVGGElement;
  private readonly overlay: SVGGElement;
  private readonly picker: HTMLSelectElement;
  private readonly compass: HTMLButtonElement;
  private readonly recenter: HTMLButtonElement;

  private scene: MapScene | null = null;
  private shownLevel = '';
  /** A floor the visitor picked to look at; cleared when their own floor changes. */
  private browsing: string | null = null;
  private northUp = false;
  private view: View = { cx: 0, cy: 0, s: 8, rot: 0 };
  private framed = '';
  private moved = false;
  /** False until the first frame: that one appears instantly. */
  private placed = false;
  private width = 0;
  private height = 0;
  private pins: Pin[] = [];
  private markers: Pin[] = [];
  private pointers = new Map<number, Point>();
  private travel = 0;
  /** Shown level has building footprints: switch between campus and inside views by zoom. */
  private campus = false;
  private footprints: Shape[] = [];
  /** A building the visitor tapped: the floor picker lists its floors. */
  private building: string | null = null;
  private queued = false;
  private animation = 0;

  constructor() {
    this.plan = s('g', { class: 'plan' });
    this.routeLayer = s('g', { class: 'route' });
    const world = s('g');
    world.append(this.plan, this.routeLayer);
    this.overlay = s('g', { class: 'overlay' });
    this.svg = s('svg', { class: 'map-svg', role: 'img' });
    this.svg.append(world, this.overlay);

    this.picker = h('select', {
      class: 'map-floor',
      'aria-label': tr('map.floor'),
      onChange: () => {
        const scene = this.scene;
        if (!scene) return;
        this.browsing = this.picker.value === scene.levelId ? null : this.picker.value;
        this.update(scene);
      },
    });
    this.compass = h('button', {
      type: 'button',
      class: 'map-btn compass',
      onClick: () => {
        this.northUp = !this.northUp;
        this.reframe();
      },
    });
    this.compass.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 17 13H7Z" fill="#d33"/><path d="M12 22 7 13h10Z" fill="#9aa"/></svg>';
    this.recenter = h(
      'button',
      {
        type: 'button',
        class: 'map-btn recenter',
        'aria-label': tr('map.recenter'),
        hidden: true,
        onClick: () => this.reframe(),
      },
      '◎',
    );
    this.el = h('div', { class: 'map' }, this.picker, this.compass, this.recenter);
    this.el.prepend(this.svg);
    this.listen();
  }

  /** Show a scene; cheap to call on every render. */
  update(scene: MapScene): void {
    if (scene.levelId !== this.scene?.levelId) {
      this.browsing = null;
      this.building = null;
    }
    this.scene = scene;
    const levelId = this.browsing ?? scene.levelId;
    if (levelId !== this.shownLevel) this.buildLevel(levelId);
    this.fillPicker(scene, levelId);
    this.drawRoute(scene, levelId);

    const rot = this.northUp || scene.facing === null ? 0 : scene.facing;
    const key = `${levelId}|${scene.focus.join(',')}|${rot}`;
    if (key !== this.framed && this.width > 0) {
      this.framed = key;
      this.moved = false;
      this.animateTo(this.fit(scene, levelId, rot));
    }
    this.requestDraw();
  }

  // ---------- building the floor ----------

  private buildLevel(levelId: string): void {
    const site = this.scene?.site;
    if (!site) return;
    this.shownLevel = levelId;
    this.plan.replaceChildren();
    this.overlay.replaceChildren();
    this.pins = [];
    const level = site.map.levels.find((l) => l.id === levelId);
    const shapes = level?.shapes ?? [];
    const nodes = [...site.graph.nodes.values()].filter((n) => n.level === levelId);
    const rooms = new Map(site.map.rooms.map((r) => [r.id, r]));
    const buildings = new Map((site.map.buildings ?? []).map((b) => [b.id, b]));
    this.svg.setAttribute('aria-label', tr('map.label', { floor: this.levelName(levelId) }));
    this.footprints = shapes.filter((shape) => shape.kind === 'building');
    this.campus = this.footprints.length > 0;

    // On a building's own floor, the campus around it, faded, so the visitor sees where it is.
    if (level?.building !== undefined) {
      for (const shape of campusShapes(site)) {
        const el = this.shapeEl(shape, rooms);
        el.classList.add('ghost');
        this.plan.append(el);
      }
    }

    if (shapes.length > 0) {
      for (const shape of shapes) this.plan.append(this.shapeEl(shape, rooms));
      const doors = nodes.filter((n) => DOOR_KINDS.has(n.kind));
      for (const [x1, y1, x2, y2] of doorGaps(shapes, doors)) {
        this.plan.append(s('line', { class: 'gap', x1, y1, x2, y2 }));
      }
    } else {
      // No drawing yet: a corridor sketch from the walking lines.
      for (const edge of site.map.edges) {
        const a = site.graph.nodes.get(edge.a);
        const b = site.graph.nodes.get(edge.b);
        if (a?.level !== levelId || !b) continue;
        this.plan.append(s('line', { class: 'sketch', x1: a.x, y1: a.y, x2: b.x, y2: b.y }));
      }
    }

    // Labels: outlined rooms at their centre, others next to their first door.
    const outlined = new Set<string>();
    for (const shape of shapes) {
      const building = shape.building ? buildings.get(shape.building) : undefined;
      if (building) {
        this.addLabel(labelPoint(shape), [building.name], shapePoints(shape), 'label big', 'far');
        continue;
      }
      const room = shape.room ? rooms.get(shape.room) : undefined;
      if (room) outlined.add(room.id);
      const texts = room
        ? [room.number ? `${room.number} · ${room.name}` : room.name, room.name, room.number ?? '']
        : [shape.label ?? (shape.kind === 'stairs' ? tr('map.stairs') : '')];
      if (shape.kind === 'floor' || shape.kind === 'wall' || !texts[0]) continue;
      const lock = room?.visibility === 'locked' ? '🔒 ' : '';
      this.addLabel(
        labelPoint(shape),
        texts.filter(Boolean).map((t) => lock + t),
        shapePoints(shape),
        'label',
        OUTDOOR_SHAPE_KINDS.has(shape.kind) ? undefined : 'near',
      );
    }
    this.addEntranceArrows(nodes);
    for (const room of site.map.rooms) {
      const door = site.graph.nodes.get(room.doors[0] ?? '');
      if (outlined.has(room.id) || door?.level !== levelId) continue;
      this.addLabel({ x: door.x, y: door.y - 1.5 }, [room.name]);
    }

    // Amenities: emoji at their dot, side by side when several share one.
    const byNode = new Map<string, Amenity[]>();
    for (const a of site.map.amenities) byNode.set(a.node, [...(byNode.get(a.node) ?? []), a]);
    for (const [nodeId, list] of byNode) {
      const node = site.graph.nodes.get(nodeId);
      if (node?.level !== levelId) continue;
      list.forEach((a, i) => {
        const g = s('g', { class: 'amenity' });
        const dx = (i - (list.length - 1) / 2) * 20;
        g.append(s('text', { x: dx, y: -12 }, AMENITY_EMOJI[a.kind]));
        this.overlay.append(g);
        this.pins.push({ p: node, el: g });
      });
    }
  }

  private shapeEl(shape: Shape, rooms: ReadonlyMap<string, Room>): SVGElement {
    const points = flat(shapePoints(shape));
    // "in": a building's inside, hidden on a zoomed-out campus.
    const inside = OUTDOOR_SHAPE_KINDS.has(shape.kind) ? '' : ' in';
    if (shape.kind === 'wall') return s('polyline', { class: `wall${inside}`, points });
    const room = shape.room ? rooms.get(shape.room) : undefined;
    const cls = room
      ? `room cat-${room.category}${room.visibility === 'locked' ? ' locked' : ''}`
      : shape.kind;
    return s('polygon', { class: cls + inside, points });
  }

  private addLabel(
    p: Point,
    texts: string[],
    box?: readonly Point[],
    cls = 'label',
    zoom?: 'far' | 'near',
  ): void {
    const g = s('g', { class: cls });
    g.append(s('text', { y: 4 }, texts[0]));
    this.overlay.append(g);
    this.pins.push({ p, el: g, ...(box && { fit: { texts, box } }), ...(zoom && { zoom }) });
  }

  /** An arrow just outside every building entrance, pointing in. */
  private addEntranceArrows(nodes: ReadonlyArray<Point & { readonly kind: string }>): void {
    for (const node of nodes) {
      if (node.kind !== 'entrance') continue;
      for (const shape of this.footprints) {
        for (const [a, b] of shapeSides(shape)) {
          const { point } = projectOnSegment(node, a, b);
          if (Math.hypot(point.x - node.x, point.y - node.y) > 0.4) continue;
          const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
          let n = { x: -(b.y - a.y) / length, y: (b.x - a.x) / length };
          if (!containsPoint(shape, { x: point.x + n.x, y: point.y + n.y })) {
            n = { x: -n.x, y: -n.y };
          }
          const g = s('g', { class: 'entry' });
          g.append(s('path', { d: 'M0-8 7 5 0 1-7 5Z' }));
          this.overlay.append(g);
          const angle = (Math.atan2(n.x, -n.y) * 180) / Math.PI;
          this.pins.push({ p: { x: point.x - n.x * 2, y: point.y - n.y * 2 }, el: g, angle });
        }
      }
    }
  }

  /** "Block A · Floor 2" on a campus, just "Floor 2" otherwise. */
  private levelName(levelId: string): string {
    const site = this.scene?.site;
    const level = site?.map.levels.find((l) => l.id === levelId);
    const building = level?.building
      ? site?.map.buildings?.find((b) => b.id === level.building)
      : undefined;
    return building ? `${building.name} · ${level?.name ?? ''}` : (level?.name ?? '');
  }

  private fillPicker(scene: MapScene, levelId: string): void {
    // On a campus: the shared levels plus the floors of one building — the one tapped, else the
    // one being looked at, else the one the visitor is in.
    const shown = scene.site.graph.levels.find((l) => l.id === levelId);
    const building =
      this.building ??
      shown?.building ??
      (scene.here ? scene.site.buildingAt(scene.here)?.id : undefined) ??
      null;
    const levels = [...scene.site.graph.levels]
      .filter(
        (l) =>
          l.building === undefined ||
          l.building === building ||
          l.id === scene.levelId ||
          l.id === levelId,
      )
      .reverse();
    const signature = `${scene.levelId}|${building ?? ''}|${levels.length}`;
    if (this.picker.dataset['for'] !== signature) {
      this.picker.dataset['for'] = signature;
      this.picker.replaceChildren(
        ...levels.map((l) =>
          h(
            'option',
            { value: l.id },
            l.id === scene.levelId
              ? `${this.levelName(l.id)} · ${tr('map.you-short')}`
              : this.levelName(l.id),
          ),
        ),
      );
    }
    this.picker.value = levelId;
  }

  // ---------- route and markers ----------

  private drawRoute(scene: MapScene, levelId: string): void {
    const { site, path, at } = scene;
    this.routeLayer.replaceChildren();
    for (const marker of this.markers) marker.el.remove();
    this.markers = [];

    const walked = routeLines(site.graph, path.slice(0, at + 1)).get(levelId) ?? [];
    const ahead = routeLines(site.graph, path.slice(at)).get(levelId) ?? [];
    for (const [cls, lines] of [
      ['walked', walked],
      ['casing', ahead],
      ['ahead', ahead],
    ] as const) {
      for (const line of lines) {
        if (line.length > 1)
          this.routeLayer.append(s('polyline', { class: cls, points: flat(line) }));
      }
    }

    const marker = (nodeId: string | null, cls: string, build: (g: SVGGElement) => void) => {
      const node = nodeId ? site.graph.nodes.get(nodeId) : undefined;
      if (node?.level !== levelId) return;
      const g = s('g', { class: cls });
      build(g);
      this.overlay.append(g);
      this.markers.push({ p: node, el: g });
    };

    // Where the route leaves this floor: "↑ Floor 2" at the lift or stairs.
    path.forEach((id, i) => {
      const node = site.graph.nodes.get(id);
      const next = site.graph.nodes.get(path[i + 1] ?? '');
      if (!node || !next || node.level === next.level || i < at) return;
      const to = site.graph.levels.find((l) => l.id === next.level);
      const from = site.graph.levels.find((l) => l.id === node.level);
      const text = `${(to?.ord ?? 0) > (from?.ord ?? 0) ? '↑' : '↓'} ${to?.name ?? ''}`;
      marker(id, `badge lvl-${to?.color ?? 'slate'}`, (g) => {
        g.append(s('rect', { x: 10, y: -12, rx: 11, width: text.length * 7.5 + 14, height: 22 }));
        g.append(s('text', { x: 17, y: 4 }, text));
      });
    });

    const last = path.length > 1 ? (path[path.length - 1] ?? null) : null;
    marker(scene.next !== last ? scene.next : null, 'next', (g) => {
      g.append(s('circle', { class: 'pulse', r: 14 }), s('circle', { r: 6 }));
    });
    marker(last !== scene.here ? last : null, 'dest', (g) => {
      g.append(
        s('path', { d: 'M0 0c-2-6-9-10-9-17a9 9 0 0 1 18 0c0 7-7 11-9 17Z' }),
        s('circle', { cx: 0, cy: -17, r: 3.5 }),
      );
    });
    marker(scene.here, 'you', (g) => {
      if (scene.facing !== null)
        g.append(s('path', { class: 'cone', d: 'M0 0-14-34A36 36 0 0 1 14-34Z' }));
      g.append(s('circle', { class: 'halo', r: 16 }), s('circle', { class: 'dot', r: 8 }));
      g.append(s('text', { y: 30 }, tr('map.you')));
    });
  }

  // ---------- framing ----------

  private fit(scene: MapScene, levelId: string, rot: number): View {
    const nodes = scene.site.graph.nodes;
    let points: Point[] = scene.focus
      .map((id) => nodes.get(id))
      .filter((n): n is NonNullable<typeof n> => n?.level === levelId);
    if (points.length === 0) {
      const onRoute = scene.path.map((id) => nodes.get(id)).filter((n) => n?.level === levelId);
      points = onRoute.length > 0 ? (onRoute as Point[]) : this.levelPoints(scene.site, levelId);
    }
    return this.fitPoints(points, rot);
  }

  private fitPoints(points: readonly Point[], rot: number): View {
    // Bounds in the rotated frame, then back to meters for the centre.
    const a = rad(-rot);
    const turned = points.map((p) => ({
      x: p.x * Math.cos(a) - p.y * Math.sin(a),
      y: p.x * Math.sin(a) + p.y * Math.cos(a),
    }));
    const box = boundsOf(turned) ?? { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    const w = Math.max(box.maxX - box.minX, MIN_EXTENT);
    const hgt = Math.max(box.maxY - box.minY, MIN_EXTENT * 0.6);
    const scale = Math.min((this.width - 56) / w, (this.height - 72) / hgt);
    const mx = (box.minX + box.maxX) / 2;
    const my = (box.minY + box.maxY) / 2;
    const b = rad(rot);
    return {
      cx: mx * Math.cos(b) - my * Math.sin(b),
      cy: mx * Math.sin(b) + my * Math.cos(b),
      s: Math.min(FIT_MAX_SCALE, Math.max(MIN_SCALE, scale)),
      rot,
    };
  }

  private levelPoints(site: Site, levelId: string): Point[] {
    const shapes = site.map.levels.find((l) => l.id === levelId)?.shapes ?? [];
    const points = shapes.flatMap(shapePoints);
    return points.length > 0
      ? points
      : [...site.graph.nodes.values()].filter((n) => n.level === levelId);
  }

  private reframe(): void {
    this.framed = '';
    this.building = null;
    if (this.scene) this.update(this.scene);
  }

  private animateTo(target: View): void {
    cancelAnimationFrame(this.animation);
    const from = { ...this.view };
    if (!this.placed || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.placed = true;
      this.view = target;
      this.requestDraw();
      return;
    }
    let turn = (target.rot - from.rot) % 360;
    if (turn > 180) turn -= 360;
    if (turn < -180) turn += 360;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 450);
      const e = 1 - (1 - t) ** 3;
      this.view = {
        cx: from.cx + (target.cx - from.cx) * e,
        cy: from.cy + (target.cy - from.cy) * e,
        s: from.s * (target.s / from.s) ** e,
        rot: from.rot + turn * e,
      };
      this.draw();
      if (t < 1) this.animation = requestAnimationFrame(step);
      else this.view = target;
    };
    this.animation = requestAnimationFrame(step);
  }

  // ---------- drawing ----------

  private project(p: Point): Point {
    const { cx, cy, s: scale, rot } = this.view;
    const a = rad(-rot);
    const dx = (p.x - cx) * scale;
    const dy = (p.y - cy) * scale;
    return {
      x: this.width / 2 + dx * Math.cos(a) - dy * Math.sin(a),
      y: this.height / 2 + dx * Math.sin(a) + dy * Math.cos(a),
    };
  }

  private requestDraw(): void {
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => {
      this.queued = false;
      this.draw();
    });
  }

  private draw(): void {
    const { cx, cy, s: scale, rot } = this.view;
    const world = this.plan.parentNode as SVGGElement;
    world.setAttribute(
      'transform',
      `translate(${this.width / 2} ${this.height / 2}) rotate(${-rot}) scale(${scale}) translate(${-cx} ${-cy})`,
    );
    const you = this.markers.find((m) => m.el.classList.contains('you'));
    const youAt = you ? this.project(you.p) : null;
    const far = this.campus && scale < FAR_SCALE;
    this.svg.classList.toggle('far', far);
    for (const pin of [...this.pins, ...this.markers]) {
      const at = this.project(pin.p);
      const turn = pin.angle === undefined ? '' : ` rotate(${(pin.angle - rot).toFixed(1)})`;
      pin.el.setAttribute('transform', `translate(${at.x.toFixed(1)} ${at.y.toFixed(1)})${turn}`);
      if (this.campus && pin.zoom && (pin.zoom === 'far') !== far) {
        pin.el.style.display = 'none';
      } else if (pin.fit) {
        // Room names give way to the "You are here" label just below the blue dot.
        const underYou =
          !!youAt && Math.abs(at.x - youAt.x) < 70 && Math.abs(at.y - youAt.y - 26) < 24;
        this.fitLabel(pin, underYou);
      }
    }
    const arrow = this.compass.firstElementChild as SVGElement | null;
    arrow?.setAttribute('style', `transform:rotate(${-rot}deg)`);
    this.compass.setAttribute('aria-label', tr(this.northUp ? 'map.facing-up' : 'map.north-up'));
    this.recenter.hidden = !this.moved;
  }

  /** Longest text that fits inside the room as drawn right now; none if the room is tiny. */
  private fitLabel(pin: Pin, hidden: boolean): void {
    if (!pin.fit) return;
    const box = boundsOf(pin.fit.box.map((p) => this.project(p)));
    const width = box ? box.maxX - box.minX - 6 : 0;
    const height = box ? box.maxY - box.minY : 0;
    const text = pin.fit.texts.find((t) => t.length * CHAR_PX <= width);
    const label = pin.el.firstElementChild as SVGTextElement;
    if (label.textContent !== (text ?? '')) label.textContent = text ?? '';
    pin.el.style.display = text && height >= 16 && !hidden ? '' : 'none';
  }

  // ---------- gestures: drag to pan, pinch / wheel to zoom ----------

  private listen(): void {
    const local = (e: PointerEvent | WheelEvent): Point => {
      const r = this.svg.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    this.svg.addEventListener('pointerdown', (e) => {
      this.svg.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, local(e));
      if (this.pointers.size === 1) this.travel = 0;
    });
    this.svg.addEventListener('pointermove', (e) => {
      const before = this.pointers.get(e.pointerId);
      if (!before) return;
      const now = local(e);
      this.travel += Math.hypot(now.x - before.x, now.y - before.y);
      const others = [...this.pointers].filter(([id]) => id !== e.pointerId);
      const other = others[0]?.[1];
      if (other) {
        const was = Math.hypot(before.x - other.x, before.y - other.y);
        const is = Math.hypot(now.x - other.x, now.y - other.y);
        if (was > 0) this.zoomAt({ x: (now.x + other.x) / 2, y: (now.y + other.y) / 2 }, is / was);
      } else {
        this.panBy(now.x - before.x, now.y - before.y);
      }
      this.pointers.set(e.pointerId, now);
    });
    const up = (e: PointerEvent) => this.pointers.delete(e.pointerId);
    this.svg.addEventListener('pointerup', (e) => {
      const single = this.pointers.size === 1;
      up(e);
      if (single && this.travel < TAP_PX) this.tap(local(e));
    });
    this.svg.addEventListener('pointercancel', up);
    this.svg.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.zoomAt(local(e), Math.exp(-e.deltaY * 0.0015));
      },
      { passive: false },
    );
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(() => this.resize()).observe(this.svg);
    } else {
      addEventListener('resize', () => this.resize());
    }
  }

  /** Tapping a building on the campus zooms into it and lists its floors in the picker. */
  private tap(at: Point): void {
    if (!this.campus || !this.scene) return;
    const p = this.unproject(at);
    const shape = this.footprints.find((f) => f.building !== undefined && containsPoint(f, p));
    if (!shape?.building) return;
    this.building = shape.building;
    this.fillPicker(this.scene, this.shownLevel);
    this.moved = true;
    this.animateTo(this.fitPoints(shapePoints(shape), this.view.rot));
  }

  /** Screen pixel → meters on the plan. */
  private unproject(at: Point): Point {
    const a = rad(this.view.rot);
    const dx = (at.x - this.width / 2) / this.view.s;
    const dy = (at.y - this.height / 2) / this.view.s;
    return {
      x: this.view.cx + dx * Math.cos(a) - dy * Math.sin(a),
      y: this.view.cy + dx * Math.sin(a) + dy * Math.cos(a),
    };
  }

  private resize(): void {
    const r = this.svg.getBoundingClientRect();
    if (r.width === this.width && r.height === this.height) return;
    this.width = r.width;
    this.height = r.height;
    if (this.width > 0) this.reframe();
  }

  private panBy(dx: number, dy: number): void {
    if (Math.abs(dx) + Math.abs(dy) < 0.5) return;
    cancelAnimationFrame(this.animation);
    const { s: scale, rot } = this.view;
    const a = rad(rot);
    this.view.cx -= (dx * Math.cos(a) - dy * Math.sin(a)) / scale;
    this.view.cy -= (dx * Math.sin(a) + dy * Math.cos(a)) / scale;
    this.moved = true;
    this.requestDraw();
  }

  private zoomAt(at: Point, factor: number): void {
    cancelAnimationFrame(this.animation);
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.view.s * factor));
    // Keep the spot under the fingers still: zoom, then pan it back under them.
    const world = this.unproject(at);
    this.view.s = scale;
    const moved = this.project(world);
    this.moved = true;
    this.panBy(at.x - moved.x, at.y - moved.y);
    this.requestDraw();
  }
}

/** The outdoor shapes of the campus (roads, lawns, footprints), from the shared levels. */
function campusShapes(site: Site): Shape[] {
  return site.map.levels
    .filter((l) => l.building === undefined)
    .flatMap((l) => l.shapes ?? [])
    .filter((shape) => OUTDOOR_SHAPE_KINDS.has(shape.kind));
}
