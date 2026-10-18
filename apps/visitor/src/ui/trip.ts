/**
 * The trip screens: room card, route preview, walking directions, arrival. Loaded just after
 * the first screen (see loadTripScreens in views.ts), so the first visit downloads less.
 */
import './trip.css';
import type { Step } from '@innermap/core';
import { findRoute, roomIcon } from '@innermap/core';
import { CATEGORY, tr } from '../app/i18n';
import { amenityChips } from '../app/search';
import { currentNode, tripStats, walkMinutes } from '../app/state';
import { h, replace } from './dom';
import { icon } from './icons';
import { shortName, shortPlace } from './map-view';
import type { ViewContext } from './parts';
import {
  mapView,
  mapScreen,
  setSheetOpen,
  title,
  floorBadge,
  floorBadgeText,
  buildingOf,
  button,
  showRouteOverview,
  roundButton,
} from './parts';

/** A short tick when a checkpoint is confirmed (only while sound is on). */
function tick(): void {
  try {
    const audio = new AudioContext();
    const tone = audio.createOscillator();
    const gain = audio.createGain();
    tone.frequency.value = 880;
    gain.gain.setValueAtTime(0.12, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.12);
    tone.connect(gain).connect(audio.destination);
    tone.start();
    tone.stop(audio.currentTime + 0.13);
    tone.onended = () => void audio.close();
  } catch {
    // No audio on this phone: the vibration is enough.
  }
}

/**
 * When the visitor should be near the next checkpoint (by the step's length at a slow walk),
 * the "I'm here" pill glows. It never moves on by itself: the visitor still confirms.
 */
const stepClock = { index: -1, at: 0 };
function glowWhenNear(pill: HTMLElement, index: number, meters: number): void {
  if (stepClock.index !== index) Object.assign(stepClock, { index, at: Date.now() });
  const due = stepClock.at + Math.max(3000, (meters / 1.1) * 1000 * 0.8);
  const wait = due - Date.now();
  if (wait <= 0) pill.classList.add('near');
  else setTimeout(() => pill.classList.add('near'), wait);
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

export function stepView(ctx: ViewContext, index: number): HTMLElement {
  const { steps, target, notice, site } = ctx.state;
  const step = steps[index];
  if (!step) return h('section');
  const total = steps.length - 1; // the last one is the arrival message
  // One thing at a time: what to do now, and one button that says where you should be when
  // it is done ("Reached Reception desk"). Tapping it shows the next direction right here.
  const place = step.kind === 'ride' ? step.levelName : step.to ? shortPlace(step.to) : '';
  const reached = button(
    place ? tr('step.reached', { place }) : tr('step.here'),
    () => {
      navigator.vibrate?.(15);
      if (voiceOn()) tick();
      ctx.dispatch({ type: 'confirm' });
    },
    'btn primary go reached',
    'check',
  );
  glowWhenNear(reached, index, step.meters);
  const toggleMenu = (e: Event) => {
    const sheet = (e.currentTarget as HTMLElement).closest<HTMLElement>('.sheet');
    if (!sheet) return;
    const open = !sheet.classList.contains('open');
    setSheetOpen(sheet, open);
    (e.currentTarget as HTMLElement).setAttribute('aria-expanded', String(open));
  };

  return mapScreen(ctx, `trip lvl-${step.levelColor}`, {
    top: [
      notice === 'rerouted' && h('p', { class: 'toast', role: 'status' }, tr('rerouted')),
      notice === 'blocked' && h('p', { class: 'toast', role: 'status' }, tr('blocked.rerouted')),
    ],
    sheet: [
      // The step card: the direction, then "Reached …" right under it.
      banner(
        step,
        index,
        steps[index + 1],
        index === 0 && ctx.state.position?.facing !== undefined,
        floorBadgeText(step.levelName, buildingOf(ctx.state, step.target)),
        total,
      ),
      h(
        'div',
        { class: 'trip-bar nav-bar' },
        h(
          'button',
          {
            type: 'button',
            class: 'exit-x',
            'aria-label': tr('step.end'),
            title: tr('step.end'),
            onClick: () => ctx.dispatch({ type: 'new-destination' }),
          },
          icon('close'),
          h('span', { class: 'sr-only' }, tr('step.exit')),
        ),
        reached,
        h(
          'button',
          {
            type: 'button',
            class: 'more-x',
            'aria-label': tr('step.list'),
            title: tr('step.list'),
            'aria-expanded': 'false',
            onClick: toggleMenu,
          },
          icon('list'),
        ),
      ),
      // The menu (⋯ or pull the card up): everything else, and every step.
      h(
        'div',
        { class: 'trip-menu' },
        h(
          'p',
          { class: 'trip-head' },
          tr('step.to', { place: '' }),
          h('strong', {}, target?.label ?? ''),
        ),
        h(
          'div',
          { class: 'menu-row' },
          button(tr('step.back'), () => ctx.dispatch({ type: 'back' }), 'chip', 'back'),
          button(tr('step.lost'), () => ctx.dispatch({ type: 'lost' }), 'chip lost', 'help'),
          button(tr('map.overview'), showRouteOverview, 'chip', 'directions'),
          button(
            tr('blocked.button'),
            () => ctx.dispatch({ type: 'block-ahead' }),
            'chip report',
            'warn',
          ),
          voiceButton(ctx, 'chip'),
        ),
        site && site.map.qr.length > 0 && h('p', { class: 'tip' }, icon('qr'), tr('step.tip')),
        stepList(steps, index),
      ),
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

/**
 * A room's card, Google style: the room highlighted on its floor, name, number · category,
 * floor, how far it is from you, and Directions / Start / Share.
 */
export function placeView(ctx: ViewContext, roomId: string): HTMLElement {
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
function banner(
  step: Step,
  index: number,
  next: Step | undefined,
  sign: boolean,
  floorLabel = step.levelName,
  total = 0,
): HTMLElement {
  // "Then …" only when the next move comes right after this one.
  const soon = next && next.kind !== 'arrive' && step.meters > 0 && step.meters < 12;
  return h(
    'article',
    // Coloured by the move (on the arrow tile), so "follow the colour" works for everyone.
    { class: `banner step move-${step.icon}`, 'data-step': index },
    h('p', { class: 'step-text sr-only', 'aria-live': 'polite' }, step.text),
    total > 0 && h('p', { class: 'sr-only' }, tr('step.of', { n: index + 1, total })),
    h(
      'div',
      { class: 'banner-main', 'aria-hidden': 'true' },
      step.kind === 'ride'
        ? // Lifts and stairs: the floor to go to, in that floor's colour.
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
        h(
          'p',
          { class: 'step-title' },
          h('span', { class: 'grow' }, step.title),
          step.meters > 0 && h('span', { class: 'step-meters' }, tr('step.m', { m: step.meters })),
        ),
        sign && h('p', { class: 'route-line sign' }, tr('step.sign')),
        step.kind === 'ride'
          ? h(
              'p',
              { class: 'route-line press' },
              step.icon === 'lift'
                ? tr('step.press', { floor: shortName(step.levelName) })
                : tr('step.get-off', { floor: step.levelName }),
            )
          : (step.from || step.to) &&
              h(
                'p',
                { class: 'route-line' },
                step.from ? tr('step.from', { place: '' }) : null,
                step.from ? h('b', {}, step.from) : null,
                step.to ? h('span', { class: 'arrow' }, ' → ') : null,
                step.to ? h('b', {}, step.to) : null,
              ),
      ),
      h('span', { class: `floor-chip lvl-${step.levelColor}` }, floorLabel),
    ),
    soon &&
      h(
        'p',
        { class: 'then' },
        h('span', {}, tr('step.then')),
        icon(next.icon),
        h('span', { class: 'grow' }, next.title),
      ),
    // How far along the trip: a thin bar under the card.
    total > 0 &&
      h(
        'div',
        { class: 'step-progress', 'aria-hidden': 'true' },
        h('i', { style: { width: `${Math.round(((index + 1) / total) * 100)}%` } }),
      ),
  );
}

/**
 * Before walking, Google-style: From / To on top, the whole route on the map with numbered
 * checkpoints, time and distance, the floors it crosses, every step, and a big Start button.
 */
export function previewView(ctx: ViewContext): HTMLElement {
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

export function arrivedView(ctx: ViewContext): HTMLElement {
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
      h(
        'div',
        { class: 'arrive-row' },
        h('div', { class: 'step-icon' }, icon('check', 'icon huge')),
        h(
          'div',
          { class: 'grow' },
          h('h1', { tabindex: '-1', class: 'step-text' }, arrive?.text ?? ''),
          arrive &&
            floorBadge(arrive.levelName, arrive.levelColor, buildingOf(ctx.state, arrive.target)),
        ),
      ),
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
