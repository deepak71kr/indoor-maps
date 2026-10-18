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
  roomIcon,
  boundsOf,
  containsPoint,
  doorGaps,
  edgeKey,
  labelPoint,
  projectOnSegment,
  routeLines,
  shapePoints,
  shapeSides,
} from '@innermap/core';
import type { Amenity, Room, Shape } from '@innermap/schema';
import { OUTDOOR_SHAPE_KINDS } from '@innermap/schema';
import { CATEGORY, tr } from '../app/i18n';
import type { MapScene } from '../app/map-scene';
import { h } from './dom';
import type * as MapExtras from './map-extras';

/** The floor-change animation and the map key load just after the first screen. */
let extras: typeof MapExtras | null = null;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

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
  /** Zoom level this label belongs to (it fades in and out with the zoom). */
  readonly tier?: Tier;
  /**
   * Text that must not overlap other text: its box (px, centred on x, offset dy) and rank —
   * lower ranks win; from rank 3 on a label hides when it would cover a more important one.
   */
  box?: { w: number; h: number; dy: number };
  readonly rank?: number;
  /** The dot this pin belongs to (corridor names hide where the route already names it). */
  readonly id?: string;
  /** The "you" beam: turns with the phone's compass when there is a live heading. */
  readonly live?: boolean;
  /**
   * A road or footpath name runs along it: `run` is [start, end, across] of the band, the
   * name must fit its length, and `upright` keeps the text from reading upside down.
   */
  readonly run?: readonly [Point, Point, Point];
  readonly upright?: boolean;
  /** A room with a number: "204" on top, its name below, when the room is tall enough. */
  readonly two?: readonly [string, string];
}

/** Collision ranks: you, next checkpoint, destination, checkpoint names, entrances, rooms, corridors. */
const RANK = { you: 0, next: 1, dest: 2, cp: 3, entrance: 4, room: 5, spot: 6 } as const;

const NS = 'http://www.w3.org/2000/svg';
const MIN_SCALE = 0.5;
const MAX_SCALE = 40;
/** Never zoom in so far that less than this many meters show. */
const MIN_EXTENT = 34;
/** Pixels per meter when framing: big screens show more of the building, not bigger rooms. */
const FIT_MAX_SCALE = 16;
const CHAR_PX = 6.6;
/**
 * Zoom levels, Google-style, faded smoothly (pixels per meter):
 *   campus   (< ~2)   roads, lawns, water, building blocks with big names
 *   area     (2–5)    + entrance tags, parking, amenity icons
 *   inside   (5–7)    corridors and rooms fade in, building names fade out, room names appear
 *   detail   (> 7.5)  + corridor landmark names and small details
 * Each label belongs to a tier; its opacity follows the zoom (see tierOpacity).
 */
type Tier = 'bname' | 'room' | 'entrance' | 'amen' | 'detail';

/** Where a building's insides are fully drawn (a tap below this zooms into the building). */
const INSIDE_SCALE = 5;

const ramp = (v: number, from: number, to: number) =>
  Math.min(1, Math.max(0, (v - from) / (to - from)));

/** How visible each kind of detail is at this zoom (0 hidden … 1 fully shown). */
export function tierOpacity(scale: number, campus: boolean): Record<Tier | 'in', number> {
  if (!campus) {
    // One building: rooms always; only small details wait for zooming in.
    return {
      in: 1,
      bname: 0,
      room: 1,
      entrance: 1,
      amen: ramp(scale, 2.5, 4),
      detail: ramp(scale, 6.5, 8.5),
    };
  }
  return {
    in: ramp(scale, 3.2, INSIDE_SCALE),
    bname: 1 - ramp(scale, 4.5, 6.5),
    room: ramp(scale, 4.8, 6.8),
    entrance: ramp(scale, 2.2, 3.6),
    amen: ramp(scale, 3, 4.5),
    detail: ramp(scale, 7, 9.5),
  };
}
/** A tap moves the finger less than this (pixels); more is a drag. */
const TAP_PX = 8;
/** A two-finger twist must pass this many degrees before the map rotates (pinch stays steady). */
const TWIST_DEG = 12;
/** Direction arrows along the route, this many meters apart. */
const CHEVRON_EVERY = 7;
/** Room labels get their category icon above the name when the room is this tall (px). */
const ICON_ROOM_PX = 48;

/** "Reception desk (blue board), Lift A lobby" → "Reception desk": short enough for a map tag. */
export function shortPlace(name: string): string {
  return name.split(/ \(|, /)[0]?.trim() || name;
}

/** "Girls Hostel 1" → "GH1", "Medical Centre (Dispensary)" → "MC". */
export function initials(name: string): string {
  // A name that starts with an acronym keeps it: "CSE Department" → "CSE", not "CD".
  const lead = /^([A-Z][A-Z0-9&]{1,4})\b/.exec(name)?.[1];
  if (lead) return lead;
  return shortPlace(name)
    .split(/\s+/)
    .map((word) => (/^\d+$/.test(word) ? word : (word[0] ?? '').toUpperCase()))
    .join('');
}

/** "G", "1", "B1" for the floor buttons (Google-style switcher); full names stay in labels. */
export function shortName(name: string): string {
  const floor = /^(?:floor|level|lvl)\s*(.+)$/i.exec(name)?.[1];
  if (floor) return floor.slice(0, 3);
  if (/^ground/i.test(name)) return 'G';
  const basement = /^basement\s*(\d*)$/i.exec(name);
  if (basement) return `B${basement[1] ?? ''}`;
  return name.slice(0, 3);
}

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
  /** Floor switcher and compass; the screen decides where they sit (under the search bar). */
  readonly tools: HTMLElement;
  /** "My location" button; the screen puts it just above its bottom sheet. */
  readonly locate: HTMLButtonElement;
  private readonly floors: HTMLElement;
  /** "Viewing Floor 2 · you're on Ground  [Back]" while looking at another floor. */
  private readonly floorNote: HTMLElement;
  private readonly compass: HTMLButtonElement;
  /** "Show the whole route" (Google's route overview), while there is a route. */
  private readonly overview: HTMLButtonElement;
  /** Room outlines and label points on the shown floor, by room id (highlight, pin). */
  private roomEls = new Map<string, SVGElement>();
  private roomCenters = new Map<string, Point>();

  private scene: MapScene | null = null;
  private shownLevel = '';
  /** The floor drawn before this one (the floor-change animation goes up or down). */
  private shownBefore = '';
  /** A floor the visitor picked to look at; cleared when their own floor changes. */
  private browsing: string | null = null;
  /** The map stays north-up unless the visitor asks it to turn with them (compass button). */
  private northUp = true;
  /** A rotation the visitor made by hand; kept while north-up, cleared by the compass. */
  private userRot: number | null = null;
  private view: View = { cx: 0, cy: 0, s: 8, rot: 0 };
  private framed = '';
  private moved = false;
  /** False until the first frame: that one appears instantly. */
  private placed = false;
  private readonly floorToast: HTMLElement;
  private readonly floorThumb: HTMLElement;
  /** Blurs everything outside the building being looked at (a clip-path hole for it). */
  private readonly focusVeil: HTMLElement;
  private readonly keyPanel: HTMLElement;
  private readonly keyButton: HTMLElement;
  /** On a building's own floor: its footprint (the veil's hole). */
  private focusShape: Shape | null = null;
  private veilKey = '';
  private toastTimer = 0;
  private width = 0;
  private height = 0;
  private pins: Pin[] = [];
  private markers: Pin[] = [];
  private pointers = new Map<number, Point>();
  private travel = 0;
  private twist = 0;
  private rotating = false;
  /** Rooms drawn on the shown floor, for "tap a room to go there". */
  private roomShapes: Shape[] = [];
  /** Which way the phone points on the map (degrees), from the compass; null = unknown. */
  private liveHeading: number | null = null;
  private compassOffer: HTMLButtonElement | null = null;

  /** Called when the visitor taps a room on the map (set by the screen; null = ignore). */
  onPick: ((roomId: string) => void) | null = null;
  /** Shown level has building footprints: switch between campus and inside views by zoom. */
  private campus = false;
  private footprints: Shape[] = [];
  /** A building the visitor tapped: the floor picker lists its floors. */
  private building: string | null = null;
  private queued = false;
  private animation = 0;
  private framing = 0;
  private scaleTimer = 0;
  private routeSig = '';
  private destKey = '';
  /** Where the blue dot was last drawn, and the point it glides along meanwhile. */
  private youPos: { id: string; level: string; p: Point } | null = null;
  private gliding: { x: number; y: number } | null = null;
  private glideFrame = 0;
  private fling = 0;
  private velocity = { x: 0, y: 0, t: 0 };
  /** The part of the map covered by panels, as measured at the last framing. */
  private pad = { top: 0, right: 0, bottom: 0, left: 0 };
  private readonly scaleBar: SVGGElement;
  /** Dots on the current route (their corridor names give way to the route's own tags). */
  private routeIds = new Set<string>();

  constructor() {
    this.plan = s('g', { class: 'plan' });
    this.routeLayer = s('g', { class: 'route' });
    const world = s('g');
    world.append(this.plan, this.routeLayer);
    this.overlay = s('g', { class: 'overlay' });
    this.svg = s('svg', { class: 'map-svg', role: 'img' });
    // The "beam" in front of the blue dot fades out, like Google Maps.
    const defs = s('defs');
    defs.innerHTML =
      '<radialGradient id="im-beam" cx="0" cy="0" r="40" gradientUnits="userSpaceOnUse">' +
      '<stop offset="0" stop-color="#1a73e8" stop-opacity=".45"/>' +
      '<stop offset="1" stop-color="#1a73e8" stop-opacity="0"/></radialGradient>';
    this.scaleBar = s('g', { class: 'scale' });
    this.scaleBar.append(s('path'), s('text', { x: 4, y: -9 }));
    this.svg.append(defs, world, this.overlay, this.scaleBar);

    this.floors = h('div', { class: 'floors', role: 'group', 'aria-label': tr('map.floor') });
    this.compass = h('button', {
      type: 'button',
      class: 'map-btn compass',
      onClick: () => {
        // Rotated by hand while north-up: just turn back to north. Otherwise switch modes.
        if (this.northUp && Math.abs(this.view.rot) > 1) {
          this.userRot = null;
          this.animateTo({ ...this.view, rot: 0 });
          return;
        }
        this.userRot = null;
        this.northUp = !this.northUp;
        this.reframe();
      },
    });
    this.compass.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 17 13H7Z" fill="#d33"/><path d="M12 22 7 13h10Z" fill="#9aa"/></svg>';
    this.locate = h('button', {
      type: 'button',
      class: 'map-btn locate',
      'aria-label': tr('map.recenter'),
      onClick: () => this.reframe(),
    });
    this.locate.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="currentColor"/>' +
      '<circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" stroke-width="2"/>' +
      '<path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3" stroke="currentColor" stroke-width="2"/></svg>';
    // While walking, a moved map shows Google's "Re-center" pill with text (CSS).
    this.locate.append(h('span', { class: 're' }, tr('map.recenter-short')));
    this.overview = h('button', {
      type: 'button',
      class: 'map-btn overview',
      'aria-label': tr('map.overview'),
      title: tr('map.overview'),
      onClick: () => this.showWholeRoute(),
    });
    this.overview.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H15a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h6.5"/></svg>';
    // + / − (laptops; phones pinch). Each press is one smooth zoom level.
    const zoomButton = (label: string, text: string, factor: number) =>
      h(
        'button',
        { type: 'button', 'aria-label': label, title: label, onClick: () => this.zoomBy(factor) },
        text,
      );
    const zoom = h(
      'div',
      { class: 'zoom', role: 'group', 'aria-label': tr('map.zoom') },
      zoomButton(tr('map.zoom-in'), '+', 2),
      zoomButton(tr('map.zoom-out'), '−', 0.5),
    );
    this.floorNote = h('div', { class: 'floor-note', role: 'status', hidden: true });
    this.floorToast = h('div', { class: 'floor-toast', 'aria-hidden': 'true' });
    this.floorThumb = h('span', { class: 'floor-thumb', 'aria-hidden': 'true' });
    this.focusVeil = h('div', { class: 'focus-veil', 'aria-hidden': 'true' });
    this.keyPanel = h('div', { class: 'map-key', hidden: true });
    const keyButton = h('button', {
      type: 'button',
      class: 'map-btn key',
      'aria-label': tr('map.key'),
      title: tr('map.key'),
      'aria-expanded': 'false',
      onClick: () => {
        this.keyPanel.hidden = !this.keyPanel.hidden;
        keyButton.setAttribute('aria-expanded', String(!this.keyPanel.hidden));
        if (!this.keyPanel.hidden) this.fillKey();
      },
    });
    keyButton.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><path d="M14 17h6"/></svg>';
    this.keyButton = keyButton;
    this.tools = h(
      'div',
      { class: 'map-tools' },
      this.floors,
      this.compass,
      this.overview,
      this.keyButton,
      zoom,
    );
    this.el = h('div', { class: 'map' });
    this.el.append(this.svg, this.focusVeil, this.keyPanel, this.floorNote, this.floorToast);
    this.listen();
    setTimeout(() => {
      void import('./map-extras').then((module) => (extras = module));
    }, 0);
  }

  /** Show a scene; cheap to call on every render. */
  update(scene: MapScene): void {
    // A new floor for the visitor, or the next step of the trip: show their own floor again.
    if (scene.levelId !== this.scene?.levelId || scene.next !== this.scene?.next) {
      this.browsing = null;
      this.building = null;
    }
    this.scene = scene;
    const levelId = this.browsing ?? scene.levelId;
    if (levelId !== this.shownLevel) this.buildLevel(levelId);
    this.fillPicker(scene, levelId);
    this.drawRoute(scene, levelId);
    for (const [id, el] of this.roomEls) el.classList.toggle('selected', id === scene.selected);
    this.svg.classList.toggle('picking', !!scene.selected && this.roomEls.has(scene.selected));
    this.overview.hidden = scene.path.length < 2;

    const rot = this.northUp
      ? (this.userRot ?? 0)
      : (this.liveHeading ?? scene.facing ?? this.userRot ?? 0);
    const key = `${levelId}|${scene.focus.join(',')}|${rot}`;
    if (key !== this.framed && this.width > 0) {
      this.framed = key;
      this.moved = false;
      // A glide still running from a flick would mark the map as moved again: stop it now.
      cancelAnimationFrame(this.fling);
      // Next frame: the new screen (search bar, sheet…) is on the page by then, so the route
      // can be framed in the part of the map they leave visible.
      cancelAnimationFrame(this.framing);
      this.framing = requestAnimationFrame(() => {
        if (this.scene) this.animateTo(this.fit(this.scene, this.shownLevel, rot));
      });
    }
    this.requestDraw();
  }

  /**
   * How much of the map is hidden under floating panels (`.covers-map` on the same screen):
   * wide ones cover the top or bottom, narrow tall ones the left (laptop side panel).
   */
  private insets(): { top: number; right: number; bottom: number; left: number } {
    // The map's box, not the svg: the svg tilts while a floor change plays.
    const box = this.el.getBoundingClientRect();
    const inset = { top: 0, right: 0, bottom: 0, left: 0 };
    const screen = this.el.closest('.mapped');
    for (const el of screen?.querySelectorAll<HTMLElement>('.covers-map') ?? []) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.width >= box.width * 0.6) {
        if (r.top + r.height / 2 < box.top + box.height / 2)
          inset.top = Math.max(inset.top, r.bottom - box.top);
        else inset.bottom = Math.max(inset.bottom, box.bottom - r.top);
      } else if (r.left - box.left < box.width * 0.1) {
        inset.left = Math.max(inset.left, r.right - box.left);
      }
    }
    // Never let panels leave less than a third of the map.
    inset.top = Math.min(inset.top, box.height * 0.35);
    inset.bottom = Math.min(inset.bottom, box.height * 0.45);
    inset.left = Math.min(inset.left, box.width * 0.5);
    return inset;
  }

  // ---------- building the floor ----------

  private buildLevel(levelId: string): void {
    const site = this.scene?.site;
    if (!site) return;
    const before = site.graph.levels.find((l) => l.id === this.shownBefore);
    const changing = this.placed && !!before && before.id !== levelId;
    // A copy of the old floor as it looks now, for the floor-change animation.
    const ghost =
      changing && extras && !reducedMotion() ? (this.svg.cloneNode(true) as SVGSVGElement) : null;
    this.shownBefore = levelId;
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
    // Each floor in its own colour: walls and the floor itself follow --lvl (styles.css).
    this.svg.setAttribute('class', `map-svg lvl-${level?.color ?? 'slate'}`);
    if (changing && before) this.floorChanged(site, before.id, levelId, ghost);
    this.footprints = shapes.filter((shape) => shape.kind === 'building');
    this.roomShapes = shapes.filter((shape) => shape.kind === 'room' && shape.room !== undefined);
    this.roomEls = new Map();
    this.roomCenters = new Map();
    this.campus = this.footprints.length > 0;

    this.focusShape =
      level?.building !== undefined
        ? (campusShapes(site).find((x) => x.kind === 'building' && x.building === level.building) ??
          null)
        : null;
    if (!this.keyPanel.hidden) this.fillKey(level?.shapes ?? []);
    // On a building's own floor, the campus around it, faded, so the visitor sees where it is.
    if (level?.building !== undefined) {
      for (const shape of campusShapes(site)) {
        const el = this.shapeEl(shape, rooms);
        el.classList.add('ghost');
        this.plan.append(el);
      }
    }

    if (shapes.length > 0) {
      const tints = tintShapes(shapes, rooms);
      // A soft shadow under buildings and floors lifts them off the ground (no filters: cheap).
      for (const shape of shapes) {
        if (shape.kind !== 'floor' && shape.kind !== 'building') continue;
        // Buildings stand up from the ground (Google's "raised buildings"): their south wall
        // shows below the roof, in a darker shade of the building's own colour.
        const raised = shape.kind === 'building';
        const tint = tints.get(shape);
        const shade = s('polygon', {
          class: raised ? 'shade tall' : 'shade in',
          points: flat(shapePoints(shape)),
          transform: raised ? 'translate(0.4 2.6)' : 'translate(0.5 0.7)',
          ...(raised && tint && { style: tint }),
        });
        this.plan.append(shade);
      }
      for (const shape of shapes) {
        const el = this.shapeEl(shape, rooms);
        const tint = tints.get(shape);
        if (tint) el.setAttribute('style', tint);
        if (shape.kind === 'room' && shape.room) {
          this.roomEls.set(shape.room, el);
          this.roomCenters.set(shape.room, labelPoint(shape));
        }
        this.plan.append(el);
      }
      const doors = nodes.filter((n) => DOOR_KINDS.has(n.kind));
      this.drawDetails(shapes, nodes);
      // Gaps in building footprints stay on a zoomed-out campus; gaps inside buildings don't.
      const outside = shapes.filter((x) => OUTDOOR_SHAPE_KINDS.has(x.kind));
      const inside = shapes.filter((x) => !OUTDOOR_SHAPE_KINDS.has(x.kind));
      for (const [list, cls] of [
        [outside, 'gap'],
        [inside, 'gap in'],
      ] as const) {
        for (const [x1, y1, x2, y2] of doorGaps(list, doors)) {
          this.plan.append(s('line', { class: cls, x1, y1, x2, y2 }));
        }
      }
      // Ways in and out of the building: a green bar across the doorway.
      const entrances = nodes.filter((n) => n.kind === 'entrance');
      for (const [x1, y1, x2, y2] of doorGaps(shapes, entrances, 1.6)) {
        this.plan.append(s('line', { class: 'entry-bar', x1, y1, x2, y2 }));
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
        // Long names get a short form when the block is small: "Girls Hostel 1" → "GH1".
        const texts = [building.name, shortPlace(building.name), initials(building.name)];
        this.addLabel(labelPoint(shape), texts, shapePoints(shape), 'label big', 'bname');
        continue;
      }
      const room = shape.room ? rooms.get(shape.room) : undefined;
      if (room) outlined.add(room.id);
      const texts = room
        ? [room.number ? `${room.number} · ${room.name}` : room.name, room.name, room.number ?? '']
        : [shape.label ?? (shape.kind === 'stairs' ? tr('map.stairs') : '')];
      if (shape.kind === 'floor' || shape.kind === 'wall' || !texts[0]) continue;
      const lock = room?.visibility === 'locked' ? '🔒 ' : '';
      const cls = room ? `label cat-${room.category}` : `label k-${shape.kind}`;
      const run = shape.kind === 'road' || shape.kind === 'path' ? bandRun(shape) : undefined;
      this.addLabel(
        labelPoint(shape),
        texts.filter(Boolean).map((t) => lock + t),
        shapePoints(shape),
        cls,
        OUTDOOR_SHAPE_KINDS.has(shape.kind) ? undefined : 'room',
        room ? roomIcon(room, CATEGORY[room.category].emoji) : shapeIcon(shape),
      );
      if (room?.number) {
        const last = this.pins.pop();
        if (last) this.pins.push({ ...last, two: [lock + room.number, room.name] });
      }
      const pin = run && this.pins.pop();
      if (pin && run) {
        const [a, b] = run;
        const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
        this.pins.push({ ...pin, run, angle, upright: true });
      }
    }
    this.addEntranceArrows(nodes);

    // Named spots in the corridors — the checkpoints directions talk about ("Reception desk").
    for (const node of nodes) {
      if (!node.landmark || (node.kind !== 'junction' && node.kind !== 'corner')) continue;
      const g = s('g', { class: 'spot' });
      const text = shortPlace(node.landmark);
      g.append(s('circle', { r: 2.5 }), s('text', { y: -6 }, text));
      this.overlay.append(g);
      this.pins.push({
        p: node,
        el: g,
        id: node.id,
        tier: 'detail',
        rank: RANK.spot,
        box: { w: text.length * 5.6, h: 12, dy: -9 },
      });
    }
    // Entrances get a green tag with their name.
    for (const node of nodes) {
      if (node.kind !== 'entrance' || !node.landmark) continue;
      const g = s('g', { class: 'tag entrance' });
      const w = this.tag(g, `⇄ ${shortPlace(node.landmark)}`, 0, 24);
      this.overlay.append(g);
      this.pins.push({
        p: node,
        el: g,
        id: node.id,
        rank: RANK.entrance,
        box: { w, h: 20, dy: 24 },
        tier: 'entrance', // a zoomed-out campus shows building names instead
      });
    }
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
        const dx = (i - (list.length - 1) / 2) * 24;
        g.append(s('circle', { cx: dx, cy: -14, r: 11 }));
        g.append(s('text', { x: dx, y: -9.5 }, AMENITY_EMOJI[a.kind]));
        this.overlay.append(g);
        this.pins.push({ p: node, el: g, tier: 'amen' });
      });
    }
  }

  private shapeEl(shape: Shape, rooms: ReadonlyMap<string, Room>): SVGElement {
    const points = flat(shapePoints(shape));
    // "in": a building's inside, hidden on a zoomed-out campus.
    const inside = OUTDOOR_SHAPE_KINDS.has(shape.kind) ? '' : ' in';
    if (shape.kind === 'wall') return s('polyline', { class: `wall${inside}`, points });
    if (shape.kind === 'tree') {
      // Trees are drawn round, whatever outline they were traced with.
      const box = boundsOf(shapePoints(shape));
      if (box) {
        const r = Math.max(0.5, (box.maxX - box.minX + box.maxY - box.minY) / 4);
        return s('circle', {
          class: 'tree',
          cx: (box.minX + box.maxX) / 2,
          cy: (box.minY + box.maxY) / 2,
          r,
        });
      }
    }
    const room = shape.room ? rooms.get(shape.room) : undefined;
    // Roads by size: main roads (wide) in warm yellow, lanes (narrow) quieter.
    const run = shape.kind === 'road' ? bandRun(shape) : undefined;
    const width = run ? Math.hypot(run[2].x - run[1].x, run[2].y - run[1].y) : 0;
    const size = width >= 12 ? ' major' : width > 0 && width <= 8.5 ? ' minor' : '';
    const cls = room
      ? `room cat-${room.category}${room.visibility === 'locked' ? ' locked' : ''}`
      : shape.kind + size;
    return s('polygon', { class: cls + inside, points });
  }

  private addLabel(
    p: Point,
    texts: string[],
    box?: readonly Point[],
    cls = 'label',
    tier?: Tier,
    emoji?: string,
  ): void {
    const g = s('g', { class: cls });
    g.append(s('text', { y: 4 }, texts[0]));
    if (emoji) {
      // Google-style place marker above the name: a round badge in the category colour.
      const ico = s('g', { class: 'ico', transform: 'translate(0 -14)' });
      ico.append(s('circle', { r: 12 }), s('text', { y: 4.5 }, emoji));
      g.append(ico);
    }
    this.overlay.append(g);
    this.pins.push({
      p,
      el: g,
      ...(box && { fit: { texts, box } }),
      ...(tier && { tier }),
      ...(cls.includes('cat-') && { rank: RANK.room }),
    });
  }

  /** A rounded name tag (white pill with text), centred at (x, y) relative to its pin. */
  private tag(g: SVGGElement, text: string, x = 0, y = 0): number {
    const width = text.length * 6.4 + 14;
    g.append(
      s('rect', { x: x - width / 2, y: y - 10, width, height: 20, rx: 10 }),
      s('text', { x, y: y + 4 }, text),
    );
    return width;
  }

  /**
   * Small drawing details that make a plan read as a building: a door's swing (a quarter
   * circle into the room) and the treads of each staircase. Shown from close-up zoom.
   */
  private drawDetails(
    shapes: readonly Shape[],
    nodes: ReadonlyArray<Point & { kind: string }>,
  ): void {
    const DOOR = 0.9;
    for (const door of nodes) {
      if (door.kind !== 'door') continue;
      for (const shape of shapes) {
        if (shape.kind !== 'room') continue;
        for (const [a, b] of shapeSides(shape)) {
          const { point } = projectOnSegment(door, a, b);
          if (Math.hypot(point.x - door.x, point.y - door.y) > 0.4) continue;
          const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
          const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
          let n = { x: -u.y, y: u.x };
          if (!containsPoint(shape, { x: point.x + n.x * 0.3, y: point.y + n.y * 0.3 })) {
            n = { x: -n.x, y: -n.y };
          }
          const hinge = { x: point.x - (u.x * DOOR) / 2, y: point.y - (u.y * DOOR) / 2 };
          const leaf = { x: hinge.x + n.x * DOOR, y: hinge.y + n.y * DOOR };
          const end = { x: hinge.x + u.x * DOOR, y: hinge.y + u.y * DOOR };
          const sweep = u.x * n.y - u.y * n.x > 0 ? 0 : 1;
          const d = `M${hinge.x} ${hinge.y}L${leaf.x} ${leaf.y}A${DOOR} ${DOOR} 0 0 ${sweep} ${end.x} ${end.y}`;
          this.plan.append(s('path', { class: 'swing in', d }));
        }
      }
    }
    for (const shape of shapes) {
      if (shape.kind !== 'stairs') continue;
      const box = boundsOf(shapePoints(shape));
      if (!box) continue;
      const wide = box.maxX - box.minX >= box.maxY - box.minY;
      const steps = 7;
      for (let i = 1; i < steps; i++) {
        const k = i / steps;
        const line = wide
          ? {
              x1: box.minX + (box.maxX - box.minX) * k,
              y1: box.minY,
              x2: box.minX + (box.maxX - box.minX) * k,
              y2: box.maxY,
            }
          : {
              x1: box.minX,
              y1: box.minY + (box.maxY - box.minY) * k,
              x2: box.maxX,
              y2: box.minY + (box.maxY - box.minY) * k,
            };
        this.plan.append(s('line', { class: 'tread in', ...line }));
      }
    }
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
  /**
   * The floor just changed: play the floor stack, say which floor next to the switcher
   * ("↑ Floor 2" in its colour), and on a trip pulse the lift or stairs you arrive at.
   */
  private floorChanged(
    site: Site,
    fromId: string,
    toId: string,
    ghost: SVGSVGElement | null,
  ): void {
    const to = site.graph.levels.find((l) => l.id === toId);
    const from = site.graph.levels.find((l) => l.id === fromId);
    if (!to || !from) return;
    const owner = to.building ?? from.building;
    const plates = site.graph.levels.filter(
      (l) => l.building === undefined || l.building === owner,
    );
    const up = to.rank > from.rank;
    if (ghost && extras) {
      extras.playFloorChange(
        this.el,
        this.svg,
        ghost,
        plates.map((l) => ({ name: shortName(l.name), color: l.color })),
        plates.indexOf(from),
        plates.indexOf(to),
      );
    }
    this.floorToast.className = `floor-toast show lvl-${to.color}`;
    this.floorToast.textContent = `${up ? '↑' : '↓'} ${this.levelName(toId)}`;
    clearTimeout(this.toastTimer);
    // The "viewing another floor" note waits until the floor's name has gone.
    this.floorNote.classList.add('wait');
    this.toastTimer = window.setTimeout(() => {
      this.floorToast.classList.remove('show');
      this.floorNote.classList.remove('wait');
    }, 1600);
    // Next to the floor switcher, level with the new floor's button.
    requestAnimationFrame(() => {
      const button = this.floors.querySelector<HTMLElement>(`button[data-level="${toId}"]`);
      const box = this.el.getBoundingClientRect();
      const b = button?.getBoundingClientRect();
      if (!b || b.width === 0) {
        this.floorToast.style.removeProperty('top');
        this.floorToast.style.removeProperty('right');
        return;
      }
      this.floorToast.style.top = `${Math.round(b.top - box.top + b.height / 2)}px`;
      this.floorToast.style.right = `${Math.round(box.right - b.left + 10)}px`;
    });
    // On a trip: where you come out on the new floor (lift or stairs) pulses for a moment.
    const arrive = this.scene?.path
      .map((id) => site.graph.nodes.get(id))
      .find((n) => n?.level === toId && (n.kind === 'lift-stop' || n.kind === 'stairs-stop'));
    if (arrive && !this.browsing && extras) {
      const g = s('g', { class: 'arrive-pulse' });
      g.append(s('circle', { r: 10 }), s('circle', { r: 10, class: 'late' }));
      this.overlay.append(g);
      const pin: Pin = { p: arrive, el: g };
      this.pins.push(pin);
      setTimeout(() => {
        g.remove();
        this.pins = this.pins.filter((x) => x !== pin);
      }, 2600);
    }
  }

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
    // Floors the route passes through, and the destination's floor.
    const onRoute = new Set(scene.path.map((id) => scene.site.graph.nodes.get(id)?.level));
    const last = scene.path[scene.path.length - 1];
    const destLevel =
      (last ? scene.site.graph.nodes.get(last)?.level : undefined) ??
      (scene.selected
        ? scene.site.graph.nodes.get(
            scene.site.map.rooms.find((r) => r.id === scene.selected)?.doors[0] ?? '',
          )?.level
        : undefined);
    const signature = `${scene.levelId}|${scene.youLevel}|${building ?? ''}|${levels.length}|${[...onRoute].join()}|${destLevel ?? ''}`;
    if (this.floors.dataset['for'] !== signature) {
      this.floors.dataset['for'] = signature;
      const owner = building ? scene.site.map.buildings?.find((b) => b.id === building) : undefined;
      this.floors.replaceChildren(
        // Whose floors these are, and a highlight that slides to the floor shown.
        ...(owner
          ? [
              h(
                'div',
                { class: 'floor-bldg', title: owner.name, 'aria-hidden': 'true' },
                owner.name.length > 8 ? initials(owner.name) : owner.name,
              ),
            ]
          : []),
        this.floorThumb,
        ...levels.map((l) =>
          h(
            'button',
            {
              type: 'button',
              class: [
                `lvl-${l.color}`,
                l.id === scene.youLevel ? 'you' : '',
                onRoute.has(l.id) && scene.path.length > 1 ? 'route' : '',
                l.id === destLevel ? 'dest' : '',
              ]
                .filter(Boolean)
                .join(' '),
              'data-level': l.id,
              'aria-label': this.levelName(l.id),
              title:
                l.id === scene.youLevel
                  ? `${this.levelName(l.id)} · ${tr('map.you-short')}`
                  : this.levelName(l.id),
              onClick: () => {
                const current = this.scene;
                if (!current) return;
                this.browsing = l.id === current.levelId ? null : l.id;
                this.update(current);
              },
            },
            shortName(l.name),
          ),
        ),
      );
    }
    this.floors.hidden = levels.length < 2;
    this.updateFloorNote(scene, levelId);
    for (const button of this.floors.querySelectorAll('button')) {
      const on = button.dataset['level'] === levelId;
      button.classList.toggle('on', on);
      button.setAttribute('aria-pressed', String(on));
      if (on) {
        this.floorThumb.className = `floor-thumb lvl-${shown?.color ?? 'slate'}`;
        this.floorThumb.style.transform = `translateY(${button.offsetTop}px)`;
        this.floorThumb.style.height = `${button.offsetHeight}px`;
      }
    }
  }

  // ---------- route and markers ----------

  private drawRoute(scene: MapScene, levelId: string): void {
    const { site, path, at, next } = scene;
    this.routeLayer.replaceChildren();
    for (const marker of this.markers) marker.el.remove();
    this.markers = [];

    // Three colours: walked (grey), this leg up to the next checkpoint (Google blue), the rest
    // of the way (lighter blue). In the preview the whole route is one bright leg.
    const nextAt = next ? path.indexOf(next, at) : -1;
    const legEnd = nextAt >= at ? nextAt : path.length - 1;
    const lines = (from: number, to: number) =>
      to > from ? (routeLines(site.graph, path.slice(from, to + 1)).get(levelId) ?? []) : [];
    const walked = lines(0, at);
    const leg = lines(at, legEnd);
    const later = nextAt >= at ? lines(legEnd, path.length - 1) : [];
    for (const [cls, list] of [
      ['walked', walked],
      ['casing later-edge', later],
      ['later', later],
      ['casing', leg],
      ['ahead', leg],
    ] as const) {
      for (const line of list) {
        if (line.length > 1)
          this.routeLayer.append(s('polyline', { class: cls, points: flat(line) }));
      }
    }

    const marker = (
      nodeId: string | null,
      cls: string,
      build: (g: SVGGElement) => Pin['box'],
      angle?: number,
      p?: Point,
      rank?: number,
    ) => {
      const node = nodeId ? site.graph.nodes.get(nodeId) : undefined;
      if (!p && node?.level !== levelId) return;
      const g = s('g', { class: cls });
      const box = build(g) ?? undefined;
      this.overlay.append(g);
      const at = p ?? (node as Point);
      this.markers.push({
        p: at,
        el: g,
        ...(angle !== undefined && { angle }),
        ...(box && { box }),
        ...(rank !== undefined && { rank }),
      });
    };
    this.routeIds = new Set(path);

    // Closed (map authors) and blocked (this visitor) lines: red dashes and a 🚧.
    const blocked = new Set(scene.blocked);
    const signs: Point[] = [];
    for (const e of site.map.edges) {
      const a = site.graph.nodes.get(e.a);
      const b = site.graph.nodes.get(e.b);
      if (a?.level !== levelId || b?.level !== levelId) continue;
      if (!e.tags?.includes('closed') && !blocked.has(edgeKey(e.a, e.b))) continue;
      this.routeLayer.append(s('line', { class: 'closed', x1: a.x, y1: a.y, x2: b.x, y2: b.y }));
      // One 🚧 per closed stretch, not one per line: skip it near the last sign.
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (signs.some((p) => Math.hypot(p.x - mid.x, p.y - mid.y) < 80)) continue;
      signs.push(mid);
      marker(
        null,
        'works',
        (g) => {
          g.append(s('circle', { r: 10 }), s('text', { y: 4 }, '🚧'));
        },
        undefined,
        { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      );
    }

    // Arrows along the way still to walk, pointing where to go.
    const lengthOf = (line: readonly Point[]) => {
      let sum = 0;
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1] as Point;
        const b = line[i] as Point;
        sum += Math.hypot(b.x - a.x, b.y - a.y);
      }
      return sum;
    };
    for (const line of next === null ? [...leg, ...later] : leg.filter((l) => lengthOf(l) > 30)) {
      let carry = CHEVRON_EVERY / 2;
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1] as Point;
        const b = line[i] as Point;
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        const angle = (Math.atan2(b.x - a.x, -(b.y - a.y)) * 180) / Math.PI;
        for (let d = carry; d < length; d += CHEVRON_EVERY) {
          const p = { x: a.x + ((b.x - a.x) * d) / length, y: a.y + ((b.y - a.y) * d) / length };
          marker(
            null,
            'chev',
            (g) => {
              g.append(s('path', { d: 'M-4 2.5 0-1.5 4 2.5' }));
            },
            angle,
            p,
          );
        }
        carry = (((carry - length) % CHEVRON_EVERY) + CHEVRON_EVERY) % CHEVRON_EVERY;
      }
    }

    const last = path.length > 1 ? (path[path.length - 1] ?? null) : null;
    // Where the trip started (once the visitor has left it).
    const first = path[0] ?? null;
    if (path.length > 1 && first !== scene.here) {
      marker(first, 'start', (g) => {
        g.append(s('circle', { r: 6 }));
      });
    }

    // Checkpoints: ✓ when passed, numbered when still to come; the next one pulses.
    scene.checkpoints.forEach((id, i) => {
      if (id === scene.here || id === last || id === next) return;
      const passed = i < scene.done;
      // While walking only the next checkpoint stands out: the rest are small dots on the line.
      // The preview (no next yet) numbers them all, to match the step list.
      if (next !== null) {
        marker(id, passed ? 'cp done dot' : 'cp dot', (g) => {
          g.append(s('circle', { r: passed ? 3.5 : 4.5 }));
        });
        return;
      }
      marker(id, passed ? 'cp done' : 'cp', (g) => {
        g.append(s('circle', { r: 10.5 }));
        if (passed) g.append(s('path', { d: 'M-4 0-1.2 3 4-3' }));
        else g.append(s('text', { y: 4 }, String(i + 1)));
      });
    });

    // Where the route leaves this floor: "↑ Floor 2" at the lift or stairs.
    path.forEach((id, i) => {
      const node = site.graph.nodes.get(id);
      const following = site.graph.nodes.get(path[i + 1] ?? '');
      if (!node || !following || node.level === following.level || i < at) return;
      const to = site.graph.levels.find((l) => l.id === following.level);
      const from = site.graph.levels.find((l) => l.id === node.level);
      const text = `${(to?.ord ?? 0) > (from?.ord ?? 0) ? '↑' : '↓'} ${to?.name ?? ''}`;
      marker(id, `badge lvl-${to?.color ?? 'slate'}`, (g) => {
        g.append(s('rect', { x: 10, y: -12, rx: 11, width: text.length * 7.5 + 14, height: 22 }));
        g.append(s('text', { x: 17, y: 4 }, text));
      });
    });

    // Name tags: the next checkpoint (blue), the destination (red), and in the preview every
    // checkpoint, so the visitor can match the map with what they see in the corridor.
    const nameOf = (id: string) => {
      const node = site.graph.nodes.get(id);
      return node?.landmark ? shortPlace(node.landmark) : undefined;
    };
    if (next === null) {
      scene.checkpoints.forEach((id) => {
        const text = id !== last && id !== scene.here ? nameOf(id) : undefined;
        if (text)
          marker(
            id,
            'tag cp-name',
            (g) => ({ w: this.tag(g, text, 0, -20), h: 20, dy: -20 }),
            undefined,
            undefined,
            RANK.cp,
          );
      });
    }
    marker(
      next !== last ? next : null,
      'next',
      (g) => {
        g.append(s('circle', { class: 'pulse', r: 15 }), s('circle', { r: 7 }));
        const text = next ? nameOf(next) : undefined;
        return text ? { w: this.tag(g, text, 0, -26), h: 20, dy: -26 } : undefined;
      },
      undefined,
      undefined,
      RANK.next,
    );
    marker(
      last !== scene.here ? last : null,
      'dest',
      (g) => {
        g.append(
          s('path', { d: 'M0 0c-2-6-9-10-9-17a9 9 0 0 1 18 0c0 7-7 11-9 17Z' }),
          s('circle', { cx: 0, cy: -17, r: 3.5 }),
        );
        const room = site.map.rooms.find((r) => r.doors.includes(last ?? ''));
        const text = room?.name ?? (last ? nameOf(last) : undefined);
        if (!text) return undefined;
        const name = s('g', { class: 'tag dest-name' });
        const w = this.tag(name, text, 0, -44);
        g.append(name);
        return { w, h: 46, dy: -24 };
      },
      undefined,
      undefined,
      RANK.dest,
    );
    // Route preview: the time in a blue bubble halfway along the route (Google's callout).
    if (scene.bubble) {
      const onFloor = path.filter((id) => site.graph.nodes.get(id)?.level === levelId);
      const middle = onFloor[Math.floor(onFloor.length / 2)];
      const text = scene.bubble;
      if (middle) {
        marker(
          middle,
          'tag eta-bubble',
          (g) => ({ w: this.tag(g, text, 0, -22), h: 20, dy: -22 }),
          undefined,
          undefined,
          RANK.next,
        );
      }
    }

    // An open room card: a red pin on the room, with its name.
    if (scene.selected) {
      const room = site.map.rooms.find((r) => r.id === scene.selected);
      const door = site.graph.nodes.get(room?.doors[0] ?? '');
      const at = this.roomCenters.get(scene.selected) ?? (door?.level === levelId ? door : null);
      if (room && at) {
        marker(
          null,
          'dest',
          (g) => {
            g.append(
              s('path', { d: 'M0 0c-2-6-9-10-9-17a9 9 0 0 1 18 0c0 7-7 11-9 17Z' }),
              s('circle', { cx: 0, cy: -17, r: 3.5 }),
            );
            const name = s('g', { class: 'tag dest-name' });
            const w = this.tag(name, room.name, 0, -44);
            g.append(name);
            return { w, h: 46, dy: -24 };
          },
          undefined,
          at,
          RANK.dest,
        );
      }
    }
    // The beam: which way the visitor faces — the phone's compass when known, else the way
    // the route / QR sticker says. Its own pin, so it turns while the label stays upright.
    const here = scene.here ? site.graph.nodes.get(scene.here) : undefined;
    // The blue dot glides from the last checkpoint to this one instead of jumping.
    const youAt =
      here?.level === levelId && scene.here ? this.glideTo(scene.here, here) : undefined;
    if (youAt && (scene.facing !== null || this.liveHeading !== null)) {
      const beam = s('g', { class: 'beam' });
      beam.append(s('path', { class: 'cone', d: 'M0 0-17-36A40 40 0 0 1 17-36Z' }));
      this.overlay.append(beam);
      this.markers.push({ p: youAt, el: beam, angle: scene.facing ?? 0, live: true });
    }
    marker(
      youAt ? null : scene.here,
      'you',
      (g) => {
        g.append(s('circle', { class: 'halo', r: 16 }), s('circle', { class: 'dot', r: 8 }));
        g.append(s('text', { y: 30 }, tr('map.you')));
        return { w: 84, h: 52, dy: 8 };
      },
      undefined,
      youAt,
      RANK.you,
    );

    // A new route or leg draws itself along the way; a new destination pin drops in.
    const sig = `${levelId}|${path.join()}|${at}|${legEnd}`;
    if (sig !== this.routeSig && !reducedMotion()) {
      for (const line of this.routeLayer.querySelectorAll<SVGPolylineElement>('.ahead, .casing')) {
        line.setAttribute('pathLength', '1');
        line.style.strokeDasharray = '1';
        line.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], {
          duration: 650,
          easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
        }).onfinish = () => {
          line.removeAttribute('pathLength');
          line.style.removeProperty('stroke-dasharray');
        };
      }
    }
    this.routeSig = sig;
    const destKey = `${last ?? ''}|${scene.selected ?? ''}`;
    if (destKey !== this.destKey && !reducedMotion()) {
      for (const pin of this.overlay.querySelectorAll('.dest')) pin.classList.add('drop');
    }
    this.destKey = destKey;
  }

  /** The point to draw the blue dot at: `target`, reached by gliding from the last spot. */
  private glideTo(id: string, target: Point & { readonly level: string }): Point {
    const last = this.youPos;
    if (last?.id === id) return this.gliding ?? target;
    this.youPos = { id, level: target.level, p: target };
    cancelAnimationFrame(this.glideFrame);
    this.gliding = null;
    if (!last || last.level !== target.level || reducedMotion()) return target;
    const from = { x: last.p.x, y: last.p.y };
    const pos = { ...from };
    this.gliding = pos;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 650);
      const k = 1 - (1 - t) ** 3;
      pos.x = from.x + (target.x - from.x) * k;
      pos.y = from.y + (target.y - from.y) * k;
      this.requestDraw();
      if (t < 1) this.glideFrame = requestAnimationFrame(step);
      else this.gliding = null;
    };
    this.glideFrame = requestAnimationFrame(step);
    return pos;
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
    const pad = this.insets();
    this.pad = pad;
    const freeW = this.width - pad.left - pad.right;
    const freeH = this.height - pad.top - pad.bottom;
    const scale = Math.min(
      FIT_MAX_SCALE,
      Math.max(MIN_SCALE, Math.min((freeW - 48) / w, (freeH - 56) / hgt)),
    );
    // Centre the box in the free part of the map, not under the panels.
    const ox = (pad.left - pad.right) / 2 / scale;
    const oy = (pad.top - pad.bottom) / 2 / scale;
    const mx = (box.minX + box.maxX) / 2 - ox;
    const my = (box.minY + box.maxY) / 2 - oy;
    const b = rad(rot);
    return {
      cx: mx * Math.cos(b) - my * Math.sin(b),
      cy: mx * Math.sin(b) + my * Math.cos(b),
      s: scale,
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
    // A planned move (re-centre, framing) wins over a glide still running from a flick.
    cancelAnimationFrame(this.fling);
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
      // Land exactly on the target (e.g. 0°, not 360° after turning the short way round).
      if (t >= 1) this.view = target;
      this.draw();
      if (t < 1) this.animation = requestAnimationFrame(step);
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
    const placedAt = new Map<Pin, Point>();
    // Smooth zoom levels: one CSS variable per tier (cheap), labels follow below.
    const o = tierOpacity(scale, this.campus);
    const inside = o.in.toFixed(2);
    if (this.svg.style.getPropertyValue('--o-in') !== inside) {
      this.svg.style.setProperty('--o-in', inside);
    }
    const detail = o.detail.toFixed(2);
    if (this.svg.style.getPropertyValue('--o-detail') !== detail) {
      this.svg.style.setProperty('--o-detail', detail);
    }
    this.svg.classList.toggle('no-in', o.in < 0.02);
    for (const pin of [...this.pins, ...this.markers]) {
      const at = this.project(pin.p);
      // Off screen: skip it (big campuses have thousands of labels; only a few are in view).
      if (at.x < -160 || at.y < -160 || at.x > this.width + 160 || at.y > this.height + 160) {
        if (pin.el.style.display !== 'none') pin.el.style.display = 'none';
        continue;
      }
      const angle = pin.live && this.liveHeading !== null ? this.liveHeading : pin.angle;
      let deg = angle === undefined ? 0 : angle - rot;
      if (pin.upright) deg = (((deg + 90) % 360) + 360) % 360 >= 180 ? deg + 180 : deg;
      const turn = angle === undefined ? '' : ` rotate(${deg.toFixed(1)})`;
      pin.el.setAttribute('transform', `translate(${at.x.toFixed(1)} ${at.y.toFixed(1)})${turn}`);
      const fade = pin.tier ? o[pin.tier] : 1;
      const opacity = fade > 0.98 ? '' : fade.toFixed(2);
      if (pin.el.style.opacity !== opacity) pin.el.style.opacity = opacity;
      if (fade < 0.02) {
        pin.el.style.display = 'none';
      } else if (pin.tier === 'detail' && pin.id !== undefined && this.routeIds.has(pin.id)) {
        pin.el.style.display = 'none'; // the route already names this spot
      } else if (pin.fit) {
        // Room names give way to the "You are here" label just below the blue dot.
        const underYou =
          !!youAt && Math.abs(at.x - youAt.x) < 70 && Math.abs(at.y - youAt.y - 26) < 24;
        this.fitLabel(pin, underYou);
      } else if (pin.box) {
        pin.el.style.display = pin.id === this.scene?.here ? 'none' : '';
      }
      placedAt.set(pin, at);
    }
    this.declutter(placedAt);
    this.drawScaleBar(scale);
    this.drawVeil(o.in);
    const arrow = this.compass.firstElementChild as SVGElement | null;
    arrow?.setAttribute('style', `transform:rotate(${-rot}deg)`);
    this.compass.setAttribute('aria-label', tr(this.northUp ? 'map.facing-up' : 'map.north-up'));
    this.compass.hidden =
      this.scene?.facing === null && this.liveHeading === null && Math.abs(rot) < 1;
    // Google shows the compass only once the map is turned (CSS hides it at north on browse screens).
    this.compass.dataset['north'] = String(Math.abs(rot) < 1 || Math.abs(rot - 360) < 1);
    // Filled blue while the map follows the route; outlined once the visitor moved it away.
    this.locate.setAttribute('aria-pressed', String(!this.moved));
  }

  /**
   * Looking inside a building — on one of its floors, or zoomed into it on the ground — the
   * rest of the map is blurred and softened, so the building is what you see.
   */
  private drawVeil(inside: number): void {
    let focus = this.focusShape;
    if (!focus && this.campus && inside > 0.55) {
      const middle = this.unproject({ x: this.width / 2, y: this.height / 2 });
      focus = this.footprints.find((f) => containsPoint(f, middle)) ?? null;
    }
    if (!focus) {
      if (this.veilKey) {
        this.veilKey = '';
        this.focusVeil.classList.remove('on');
      }
      return;
    }
    const hole = shapePoints(focus)
      .map((p, i) => {
        const q = this.project(p);
        return `${i ? 'L' : 'M'}${q.x.toFixed(0)} ${q.y.toFixed(0)}`;
      })
      .join('');
    const path = `path(evenodd, 'M0 0H${this.width}V${this.height}H0Z${hole}Z')`;
    if (path === this.veilKey) return;
    this.veilKey = path;
    this.focusVeil.style.clipPath = path;
    this.focusVeil.classList.add('on');
  }

  /** The map key: what the colours on this floor mean (built by the lazy extras). */
  private fillKey(
    shapes = this.scene?.site.map.levels.find((l) => l.id === this.shownLevel)?.shapes ?? [],
  ): void {
    const site = this.scene?.site;
    if (!site) return;
    if (extras) this.keyPanel.replaceChildren(...extras.buildKey(site, shapes));
    else
      void import('./map-extras').then((module) => {
        extras = module;
        this.fillKey(shapes);
      });
  }

  /** Hide less important labels that would cover more important ones (greedy, by rank). */
  private declutter(placedAt: ReadonlyMap<Pin, Point>): void {
    const taken: Array<[number, number, number, number]> = [];
    const candidates = [...placedAt.keys()]
      .filter((pin) => pin.rank !== undefined && pin.el.style.display !== 'none')
      .sort((a, b) => (a.rank ?? 9) - (b.rank ?? 9));
    for (const pin of candidates) {
      const at = placedAt.get(pin);
      if (!at) continue;
      let box = pin.box;
      if (pin.fit) {
        const label = pin.el.firstElementChild as SVGTextElement;
        const y = Number(label.getAttribute('y') ?? 4);
        box = { w: (label.textContent ?? '').length * CHAR_PX, h: 14, dy: y - 4 };
      }
      if (!box) continue;
      const r: [number, number, number, number] = [
        at.x - box.w / 2,
        at.y + box.dy - box.h / 2,
        at.x + box.w / 2,
        at.y + box.dy + box.h / 2,
      ];
      const hit = taken.some((o) => r[0] < o[2] && r[2] > o[0] && r[1] < o[3] && r[3] > o[1]);
      if (hit && (pin.rank ?? 9) >= RANK.cp) pin.el.style.display = 'none';
      else taken.push(r);
    }
  }

  /** "10 m" bar, top-left of the free part of the map, like Google's scale. */
  private drawScaleBar(scale: number): void {
    const target = 80 / scale; // meters in ~80 px
    const nice = [1, 2, 5, 10, 20, 50, 100, 200, 500].find((m) => m >= target) ?? 1000;
    const px = nice * scale;
    const y = this.pad.top + 22;
    const x = this.pad.left + 14;
    this.scaleBar.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
    const [line, label] = [this.scaleBar.firstElementChild, this.scaleBar.lastElementChild];
    line?.setAttribute('d', `M0-5V0H${px.toFixed(1)}V-5`);
    if (label && label.textContent !== `${nice} m`) label.textContent = `${nice} m`;
  }

  /** Longest text that fits inside the room as drawn right now; none if the room is tiny. */
  private fitLabel(pin: Pin, hidden: boolean): void {
    if (!pin.fit) return;
    let width: number;
    let height: number;
    if (pin.run) {
      const [a, b, c] = pin.run.map((p) => this.project(p)) as [Point, Point, Point];
      width = Math.hypot(b.x - a.x, b.y - a.y) - 6;
      height = Math.hypot(c.x - b.x, c.y - b.y);
    } else {
      const box = boundsOf(pin.fit.box.map((p) => this.project(p)));
      width = box ? box.maxX - box.minX - 6 : 0;
      height = box ? box.maxY - box.minY : 0;
    }
    // The room's icon: above the name in a tall room, beside it in a low one, hidden if tiny.
    const ico = pin.el.querySelector<SVGGElement>('.ico');
    const roomy = !!ico && height >= ICON_ROOM_PX;
    const fits = (room: number) => pin.fit?.texts.find((t) => t.length * CHAR_PX <= room);
    // The name always wins over the icon: the icon goes beside it only if there is room left.
    const text = fits(width);
    const beside =
      !!ico && !roomy && text !== undefined && text.length * CHAR_PX + 24 <= width && height >= 22;
    // Number on top and name below, when both fit (Google's indoor labels).
    const two = pin.two;
    const stacked =
      !!two &&
      height >= (roomy ? 66 : 34) &&
      Math.max(two[0].length, two[1].length) * CHAR_PX <= width;
    // A room too small for any name still shows its icon.
    const iconOnly = !!ico && text === undefined && width + 6 >= 24 && height >= 24;
    const label = pin.el.firstElementChild as SVGTextElement;
    const mode = stacked ? '\n' : (text ?? '');
    if (label.dataset['mode'] !== mode) {
      label.dataset['mode'] = mode;
      if (stacked && two) {
        label.replaceChildren(
          s('tspan', { x: 0, class: 'num' }, two[0]),
          s('tspan', { x: 0, dy: '1.2em', class: 'name' }, two[1]),
        );
      } else label.textContent = text ?? '';
    }
    // Road names sit on the road itself, so a thin road is enough room.
    const minHeight = pin.run ? 5 : 16;
    pin.el.style.display = (text || iconOnly) && height >= minHeight && !hidden ? '' : 'none';
    if (ico) {
      const half = ((text?.length ?? 0) * CHAR_PX) / 2;
      ico.style.display = roomy || beside || iconOnly ? '' : 'none';
      ico.setAttribute(
        'transform',
        iconOnly
          ? 'scale(0.85)'
          : roomy
            ? `translate(0 ${stacked ? -20 : -14})`
            : `translate(${(-half - 2).toFixed(1)} 0) scale(0.8)`,
      );
      label.setAttribute('y', stacked ? (roomy ? '6' : '-3') : roomy ? '13' : '4');
      label.setAttribute('x', beside ? '11' : '0');
    } else if (stacked) label.setAttribute('y', '-3');
  }

  // ---------- gestures: drag to pan, pinch / wheel to zoom ----------

  private listen(): void {
    const local = (e: MouseEvent): Point => {
      const r = this.svg.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    this.svg.addEventListener('pointerdown', (e) => {
      cancelAnimationFrame(this.fling);
      this.velocity = { x: 0, y: 0, t: performance.now() };
      this.svg.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, local(e));
      if (this.pointers.size === 1) this.travel = 0;
      this.twist = 0;
      this.rotating = false;
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
        const mid = { x: (now.x + other.x) / 2, y: (now.y + other.y) / 2 };
        if (was > 0) this.zoomAt(mid, is / was);
        // Two-finger twist turns the map (after a small dead zone, so pinching stays steady).
        let turn =
          ((Math.atan2(now.y - other.y, now.x - other.x) -
            Math.atan2(before.y - other.y, before.x - other.x)) *
            180) /
          Math.PI;
        if (turn > 180) turn -= 360;
        if (turn < -180) turn += 360;
        this.twist += turn;
        if (this.rotating) this.rotateAt(mid, turn);
        else if (Math.abs(this.twist) > TWIST_DEG) {
          this.rotating = true;
          this.rotateAt(mid, this.twist);
        }
      } else if (e.shiftKey) {
        // Laptops: Shift + drag turns the map.
        this.rotateAt({ x: this.width / 2, y: this.height / 2 }, (now.x - before.x) * 0.5);
      } else {
        this.panBy(now.x - before.x, now.y - before.y);
        // Speed of the finger (px/ms), smoothed, for the glide after a flick.
        const t = performance.now();
        const dt = Math.max(1, t - this.velocity.t);
        this.velocity = {
          x: this.velocity.x * 0.6 + ((now.x - before.x) / dt) * 0.4,
          y: this.velocity.y * 0.6 + ((now.y - before.y) / dt) * 0.4,
          t,
        };
      }
      this.pointers.set(e.pointerId, now);
    });
    const up = (e: PointerEvent) => this.pointers.delete(e.pointerId);
    this.svg.addEventListener('pointerup', (e) => {
      const single = this.pointers.size === 1;
      up(e);
      if (single && this.travel < TAP_PX) this.tap(local(e));
      else if (single) this.glide();
    });
    this.svg.addEventListener('pointercancel', up);
    // Double-click zooms in there (Google Maps does the same).
    this.svg.addEventListener('dblclick', (e) => {
      e.preventDefault();
      this.zoomBy(2, local(e));
    });
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

  /**
   * Tapping a room picks it as the destination (on screens that allow it); tapping a building
   * on a zoomed-out campus zooms into it and lists its floors.
   */
  private tap(at: Point): void {
    if (!this.scene) return;
    const p = this.unproject(at);
    const far = this.campus && this.view.s < INSIDE_SCALE;
    if (!far && this.onPick) {
      const room = [...this.roomShapes].reverse().find((shape) => containsPoint(shape, p));
      if (room?.room) {
        this.onPick(room.room);
        return;
      }
    }
    if (!this.campus) return;
    const shape = this.footprints.find((f) => f.building !== undefined && containsPoint(f, p));
    if (!shape?.building) return;
    this.building = shape.building;
    this.fillPicker(this.scene, this.shownLevel);
    this.moved = true;
    this.animateTo(this.fitPoints(shapePoints(shape), this.view.rot));
  }

  /**
   * The phone's heading on the map, live from the compass (null = none). The beam follows it;
   * in "turn with me" mode the whole map turns with the phone, like Google Maps.
   */
  setLiveHeading(heading: number | null): void {
    this.liveHeading = heading;
    if (heading !== null) this.compassOffer?.remove();
    if (heading !== null && !this.northUp && !this.moved) {
      cancelAnimationFrame(this.animation);
      this.view.rot = heading;
    }
    if (this.scene && this.markers.every((m) => !m.live) && heading !== null) {
      this.drawRoute(this.scene, this.shownLevel); // first reading: the beam appears
    }
    this.requestDraw();
  }

  /** iPhone: a button to allow the compass (permission must come from a tap). */
  offerCompass(enable: () => Promise<boolean>): void {
    if (this.compassOffer || this.liveHeading !== null) return;
    const button = h('button', {
      type: 'button',
      class: 'map-btn heading',
      'aria-label': tr('map.heading'),
      title: tr('map.heading'),
      onClick: () => {
        void enable().then((ok) => {
          if (ok) button.remove();
        });
      },
    });
    button.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 7 21l5-4 5 4Z" fill="currentColor"/></svg>';
    this.compassOffer = button;
    this.tools.append(button);
  }

  /** Show a floor (the route preview's floor chips use this). */
  showFloor(levelId: string): void {
    const scene = this.scene;
    if (!scene) return;
    this.browsing = levelId === scene.levelId ? null : levelId;
    this.update(scene);
  }

  /** "Viewing Floor 2 · you're on Ground [Back]" whenever the shown floor isn't yours. */
  private updateFloorNote(scene: MapScene, levelId: string): void {
    const away = levelId !== scene.youLevel;
    this.floorNote.hidden = !away;
    if (!away) return;
    const back = h(
      'button',
      {
        type: 'button',
        onClick: () => {
          const current = this.scene;
          if (!current) return;
          this.browsing = current.youLevel === current.levelId ? null : current.youLevel;
          this.update(current);
        },
      },
      tr('map.back-to-floor'),
    );
    this.floorNote.replaceChildren(
      h(
        'span',
        {},
        tr('map.viewing', { floor: this.levelName(levelId), you: this.levelName(scene.youLevel) }),
      ),
      back,
    );
    // Measured now and once more after the screen settles: the panel on top (search bar and
    // its chips, a tall lift banner…) may have just changed.
    const place = () => {
      // Below the top panel and its chip row too (the chips don't count as covering the map).
      const bar = this.el.closest('.mapped')?.querySelector('.top');
      const below = bar
        ? bar.getBoundingClientRect().bottom - this.el.getBoundingClientRect().top
        : 0;
      this.floorNote.style.top = `${Math.round(Math.max(this.insets().top, below) + 8)}px`;
    };
    requestAnimationFrame(place);
    setTimeout(place, 250);
  }

  /** Route overview: frame the whole route on the floor being shown. */
  /** The whole route at once (the walking screen's menu). */
  overviewRoute(): void {
    this.showWholeRoute();
  }

  private showWholeRoute(): void {
    const scene = this.scene;
    if (!scene) return;
    const points = scene.path
      .map((id) => scene.site.graph.nodes.get(id))
      .filter((n): n is NonNullable<typeof n> => n?.level === this.shownLevel);
    if (points.length === 0) return;
    this.moved = true;
    this.animateTo(this.fitPoints(points, this.view.rot));
  }

  /** Turn the map by `deg` (clockwise on screen) around a screen point. */
  private rotateAt(at: Point, deg: number): void {
    cancelAnimationFrame(this.animation);
    const world = this.unproject(at);
    this.view.rot = (((this.view.rot - deg) % 360) + 360) % 360;
    if (this.northUp) this.userRot = this.view.rot;
    const moved = this.project(world);
    this.moved = true;
    this.panBy(at.x - moved.x, at.y - moved.y);
    this.requestDraw();
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

  /** After a flick the map keeps moving and slows down, like any phone map. */
  private glide(): void {
    let { x: vx, y: vy, t: last } = this.velocity;
    if (performance.now() - last > 80 || Math.hypot(vx, vy) < 0.25 || reducedMotion()) return;
    const step = (now: number) => {
      const dt = Math.min(32, now - last);
      last = now;
      this.panBy(vx * dt, vy * dt);
      const decay = 0.94 ** (dt / 16);
      vx *= decay;
      vy *= decay;
      if (Math.hypot(vx, vy) > 0.02) this.fling = requestAnimationFrame(step);
    };
    last = performance.now();
    this.fling = requestAnimationFrame(step);
  }

  /** Animated zoom by `factor` around a screen point (default: the middle of the map). */
  private zoomBy(factor: number, at: Point = { x: this.width / 2, y: this.height / 2 }): void {
    this.flashScale();
    const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.view.s * factor));
    const world = this.unproject(at);
    const k = this.view.s / s;
    this.moved = true;
    this.animateTo({
      cx: world.x + (this.view.cx - world.x) * k,
      cy: world.y + (this.view.cy - world.y) * k,
      s,
      rot: this.view.rot,
    });
  }

  /** The scale bar shows while the visitor zooms, then fades (Google does the same). */
  private flashScale(): void {
    this.svg.classList.add('zooming');
    clearTimeout(this.scaleTimer);
    this.scaleTimer = window.setTimeout(() => this.svg.classList.remove('zooming'), 1500);
  }

  private zoomAt(at: Point, factor: number): void {
    this.flashScale();
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

/** Icons for outlines that are not rooms (parking, lifts…), Google-style. */
/**
 * Soft colour pairs [background, wall] for rooms and buildings: each one gets its own, and
 * shapes that touch never share one, so every room and building stands out from its
 * neighbours. The category still shows in the room's icon.
 */
const TINTS: ReadonlyArray<readonly [string, string]> = [
  ['#e3effd', '#5b9be6'],
  ['#e0f4ea', '#43a67c'],
  ['#fdeadb', '#e08d4c'],
  ['#eee6fb', '#8f6fd4'],
  ['#fde5ec', '#dc6f8e'],
  ['#faf3d2', '#c4a227'],
  ['#ddf3f4', '#34a6aa'],
  ['#fde2dd', '#dd6c5e'],
  ['#e9f1de', '#7fa24d'],
  ['#e6e8fb', '#6c77d4'],
  ['#f4ebdf', '#a98757'],
  ['#fae3f4', '#c160ab'],
];

/** Rooms drawn without a room entry, coloured by what their label says. */
const LABEL_COLOURS: ReadonlyArray<readonly [RegExp, string]> = [
  [/toilet|wash ?room|wc/i, '#00838f'],
  [/water/i, '#1e6fd9'],
];

/**
 * Inline style per shape: buildings get their own colour pair; rooms are coloured by what
 * they are (their category's colour), and two touching rooms of the same kind get two
 * shades of it, so the colour means something and neighbours still stand apart.
 */
function tintShapes(
  shapes: readonly Shape[],
  rooms: ReadonlyMap<string, Room>,
): Map<Shape, string> {
  const pairs = tintPairs(shapes.filter((x) => x.kind === 'building'));
  const out = new Map<Shape, string>();
  for (const [shape, [bg, wall]] of pairs) out.set(shape, `--rf:${bg};--rw:${wall}`);
  const roomShapes = shapes.filter((x) => x.kind === 'room');
  const boxes = roomShapes.map((x) => boundsOf(shapePoints(x)));
  const alt: boolean[] = [];
  roomShapes.forEach((shape, i) => {
    const room = shape.room ? rooms.get(shape.room) : undefined;
    if (!room) {
      const colour = LABEL_COLOURS.find(([test]) => test.test(shape.label ?? ''))?.[1];
      if (colour) out.set(shape, `--c:${colour}`);
      return;
    }
    const a = boxes[i];
    const sameNear = roomShapes.some((other, j) => {
      const b = boxes[j];
      return (
        j < i &&
        !alt[j] &&
        !!a &&
        !!b &&
        other.room !== undefined &&
        rooms.get(other.room)?.category === room.category &&
        a.minX <= b.maxX + 1.5 &&
        b.minX <= a.maxX + 1.5 &&
        a.minY <= b.maxY + 1.5 &&
        b.minY <= a.maxY + 1.5
      );
    });
    alt[i] = sameNear;
    if (sameNear) out.set(shape, '--shade:28%');
  });
  return out;
}

function tintPairs(shapes: readonly Shape[]): Map<Shape, readonly [string, string]> {
  const list = shapes;
  const boxes = list.map((x) => boundsOf(shapePoints(x)));
  const touch = (i: number, j: number) => {
    const a = boxes[i];
    const b = boxes[j];
    const gap = 1.5; // meters: rooms across a narrow corridor count as neighbours too
    return (
      !!a &&
      !!b &&
      a.minX <= b.maxX + gap &&
      b.minX <= a.maxX + gap &&
      a.minY <= b.maxY + gap &&
      b.minY <= a.maxY + gap
    );
  };
  const out = new Map<Shape, readonly [string, string]>();
  const picked: number[] = [];
  list.forEach((shape, i) => {
    const used = new Set<number>();
    for (let j = 0; j < i; j++) {
      const k = picked[j];
      if (k !== undefined && list[j]?.kind === shape.kind && touch(i, j)) used.add(k);
    }
    // Start from a spot that depends on the name, so colours look mixed, not striped.
    const key = shape.room ?? shape.building ?? '';
    let start = 0;
    for (const ch of key) start = (start * 31 + ch.charCodeAt(0)) % TINTS.length;
    let k = start;
    for (let n = 0; n < TINTS.length && used.has(k); n++) k = (k + 1) % TINTS.length;
    picked[i] = k;
    const tint = TINTS[k];
    if (tint) out.set(shape, tint);
  });
  return out;
}

/** A four-corner band (a road or path): [start, end, across] along its longer side. */
function bandRun(shape: Shape): [Point, Point, Point] | undefined {
  const p = shapePoints(shape);
  if (p.length !== 4) return undefined;
  const [a, b, c, d] = p as [Point, Point, Point, Point];
  const side = (u: Point, v: Point) => Math.hypot(v.x - u.x, v.y - u.y);
  // Through the middle of the band, so the name sits on the road, not its edge.
  const mid = (u: Point, v: Point): Point => ({ x: (u.x + v.x) / 2, y: (u.y + v.y) / 2 });
  return side(a, b) >= side(b, c)
    ? [mid(a, d), mid(b, c), { x: mid(b, c).x + (c.x - b.x), y: mid(b, c).y + (c.y - b.y) }]
    : [mid(b, a), mid(c, d), { x: mid(c, d).x + (d.x - c.x), y: mid(c, d).y + (d.y - c.y) }];
}

function shapeIcon(shape: Shape): string | undefined {
  switch (shape.kind) {
    case 'parking':
      return '🅿️';
    case 'lift':
      return '🛗';
    case 'stairs':
      return '🪜';
    default:
      return undefined;
  }
}
