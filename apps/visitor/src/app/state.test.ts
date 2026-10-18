import { loadSite } from '@innermap/core';
import type { MapFile } from '@innermap/schema';
import { describe, expect, it } from 'vitest';
import demo from '../../../../samples/demo-hospital/map.json';
import { nearbyLandmarks, resolvePosition, amenityChips, searchRooms, codeFromQr } from './search';
import type { KeyValue } from './session';
import { loadTrip, persistTrip, TRIP_TTL_MS } from './session';
import type { Action, State, Target } from './state';
import { currentNode, initialState, reducer } from './state';

const site = loadSite(demo as MapFile);
const radiology: Target = {
  destination: { type: 'room', roomId: 'radiology' },
  label: 'Radiology',
};
const atMain = { node: 'G-ENT', facing: 0, source: 'qr' as const };

const run = (...actions: Action[]): State => actions.reduce(reducer, initialState);
const loaded = (...actions: Action[]) => run({ type: 'map-loaded', site }, ...actions);

describe('visitor state machine', () => {
  it('starts at "where am I?" once the map loads', () => {
    expect(loaded().screen).toEqual({ name: 'where-am-i' });
  });

  it('QR scan → choose → preview the whole route → Start → navigate', () => {
    const chosen = loaded({ type: 'set-position', position: atMain });
    expect(chosen.screen.name).toBe('choose');
    const preview = reducer(chosen, { type: 'choose', target: radiology });
    expect(preview.screen).toEqual({ name: 'preview' });
    expect(preview.path[0]).toBe('G-ENT');
    expect(preview.path.at(-1)).toBe('2-N30');
    expect(reducer(preview, { type: 'confirm' })).toBe(preview); // nothing to confirm yet
    const nav = reducer(preview, { type: 'start' });
    expect(nav.screen).toEqual({ name: 'navigate', step: 0 });
    expect(nav.steps.at(-1)?.kind).toBe('arrive');
    expect(nav.steps[0]?.text).toMatch(/^With the sign in front of you/); // QR facing used
  });

  it('looks ahead and back at other steps without moving the trip', () => {
    let s = loaded(
      { type: 'set-position', position: atMain },
      { type: 'choose', target: radiology },
      { type: 'start' },
      { type: 'peek', step: 2 },
    );
    expect(s.screen).toEqual({ name: 'navigate', step: 0, peek: 2 });
    s = reducer(s, { type: 'peek', step: 99 }); // clamped to the last walking step
    expect(s.screen).toEqual({ name: 'navigate', step: 0, peek: s.steps.length - 2 });
    s = reducer(s, { type: 'peek', step: 0 }); // back to now
    expect(s.screen).toEqual({ name: 'navigate', step: 0 });
    s = reducer(reducer(s, { type: 'peek', step: 3 }), { type: 'confirm' });
    expect(s.screen).toEqual({ name: 'navigate', step: 1 }); // "Reached" ends the look-ahead
  });

  it('confirming every step ends on Arrived (the arrive message is not a card)', () => {
    let s = loaded(
      { type: 'set-position', position: atMain },
      { type: 'choose', target: radiology },
      { type: 'start' },
    );
    const cards = s.steps.length - 1;
    for (let i = 0; i < cards; i++) s = reducer(s, { type: 'confirm' });
    expect(s.screen.name).toBe('arrived');
    expect(currentNode(s)).toBe('2-N30');
  });

  it('back never goes below the first step', () => {
    const s = loaded(
      { type: 'set-position', position: atMain },
      { type: 'choose', target: radiology },
      { type: 'start' },
      { type: 'back' },
    );
    expect(s.screen).toEqual({ name: 'navigate', step: 0 });
  });

  it('lost → scan another QR → SAME destination, re-routed, with a notice', () => {
    const s = loaded(
      { type: 'set-position', position: atMain },
      { type: 'choose', target: radiology },
      { type: 'start' },
      { type: 'lost' },
      { type: 'set-position', position: { node: '1-LOB', facing: 90, source: 'qr' } },
    );
    expect(s.target).toEqual(radiology);
    expect(s.screen).toEqual({ name: 'navigate', step: 0 });
    expect(s.notice).toBe('rerouted');
    expect(s.position?.node).toBe('1-LOB');
  });

  it('"I found my way" returns to the same step', () => {
    const s = loaded(
      { type: 'set-position', position: atMain },
      { type: 'choose', target: radiology },
      { type: 'start' },
      { type: 'confirm' },
      { type: 'lost' },
      { type: 'found-way' },
    );
    expect(s.screen).toEqual({ name: 'navigate', step: 1 });
  });

  it('choosing a destination before a position asks where you are, then routes', () => {
    const asked = loaded({ type: 'choose', target: radiology });
    expect(asked.screen.name).toBe('where-am-i');
    const s = reducer(asked, { type: 'set-position', position: atMain });
    expect(s.screen.name).toBe('preview');
    expect(s.notice).toBeNull();
  });

  it('step-free mid-trip re-plans from where you are, without stairs', () => {
    const s = loaded(
      { type: 'set-position', position: { node: '1-E' } },
      {
        type: 'choose',
        target: { destination: { type: 'node', nodeId: '2-E' }, label: 'Landing' },
      },
      { type: 'start' },
    );
    expect(s.steps.some((step) => step.icon === 'stairs')).toBe(true);
    const free = reducer(s, { type: 'toggle-step-free' });
    expect(free.stepFree).toBe(true);
    expect(free.steps.some((step) => step.icon === 'stairs')).toBe(false);
  });

  it('starting at the destination goes straight to Arrived', () => {
    const s = loaded(
      { type: 'set-position', position: { node: 'G-N30' } },
      {
        type: 'choose',
        target: { destination: { type: 'room', roomId: 'pharmacy' }, label: 'Pharmacy' },
      },
    );
    expect(s.screen.name).toBe('arrived');
  });

  it('new destination starts from where you arrived', () => {
    let s = loaded(
      { type: 'set-position', position: atMain },
      { type: 'choose', target: radiology },
      { type: 'start' },
    );
    while (s.screen.name === 'navigate') s = reducer(s, { type: 'confirm' });
    s = reducer(s, { type: 'new-destination' });
    expect(s.screen.name).toBe('choose');
    expect(s.position?.node).toBe('2-N30');
  });

  it('step-free in the preview re-plans the preview', () => {
    const s = loaded(
      { type: 'set-position', position: { node: '1-E' } },
      {
        type: 'choose',
        target: { destination: { type: 'node', nodeId: '2-E' }, label: 'Landing' },
      },
      { type: 'toggle-step-free' },
    );
    expect(s.screen).toEqual({ name: 'preview' });
    expect(s.steps.some((step) => step.icon === 'stairs')).toBe(false);
  });

  it('a room card: open it from the map or a list, then Directions plans the route', () => {
    const chosen = loaded({ type: 'set-position', position: atMain });
    const card = reducer(chosen, { type: 'show-place', roomId: 'radiology' });
    expect(card.screen).toEqual({ name: 'place', roomId: 'radiology' });
    expect(reducer(card, { type: 'close-place' }).screen.name).toBe('choose');
    expect(reducer(chosen, { type: 'show-place', roomId: 'nope' })).toBe(chosen);
    const preview = reducer(card, { type: 'choose', target: radiology });
    expect(preview.screen.name).toBe('preview');
    expect(preview.recent).toEqual([radiology]);
  });

  it('remembers recent rooms, newest first, without duplicates', () => {
    const pharmacy: Target = {
      destination: { type: 'room', roomId: 'pharmacy' },
      label: 'Pharmacy',
    };
    let s = loaded({ type: 'set-position', position: atMain });
    for (const target of [radiology, pharmacy, radiology]) {
      s = reducer(s, { type: 'choose', target });
      s = reducer(s, { type: 'new-destination' });
    }
    expect(s.recent.map((r) => r.label)).toEqual(['Radiology', 'Pharmacy']);
  });

  it('swap in the preview: walk back from the destination to the start', () => {
    const s = loaded(
      { type: 'set-position', position: atMain },
      { type: 'choose', target: radiology },
      { type: 'swap' },
    );
    expect(s.screen.name).toBe('preview');
    expect(s.position?.node).toBe('2-N30');
    expect(s.path.at(-1)).toBe('G-ENT');
    expect(s.target?.label).toBe('Main Entrance');
  });

  it('"Path blocked?" avoids the line ahead and routes around it from here', () => {
    const s = loaded(
      { type: 'set-position', position: atMain },
      { type: 'choose', target: radiology },
      { type: 'start' },
      { type: 'confirm' }, // at the Reception desk, about to turn right to Lift A
    );
    expect(s.path).toContain('G-LA');
    const around = reducer(s, { type: 'block-ahead' });
    expect(around.blocked).toHaveLength(1);
    expect(around.notice).toBe('blocked');
    expect(around.screen).toEqual({ name: 'navigate', step: 0 });
    expect(around.path[0]).toBe('G-LOB');
    expect(around.path[1]).not.toBe('G-LA'); // another way up (Lift B or the stairs)
    expect(around.path.at(-1)).toMatch(/^2-/);
  });

  it('shortest vs fastest re-plans the preview', () => {
    const s = loaded(
      { type: 'set-position', position: { node: 'G-E' } },
      {
        type: 'choose',
        target: { destination: { type: 'node', nodeId: '1-E' }, label: 'Landing' },
      },
      { type: 'set-preference', preference: 'shortest' },
    );
    expect(s.preference).toBe('shortest');
    expect(s.screen.name).toBe('preview');
    expect(s.steps.some((step) => step.icon === 'stairs')).toBe(true);
  });

  it('resume restores the saved step (clamped to the route)', () => {
    const s = loaded({
      type: 'resume',
      position: atMain,
      target: radiology,
      step: 99,
      stepFree: false,
    });
    expect(s.screen).toEqual({ name: 'navigate', step: s.steps.length - 2 });
  });

  it('ignores actions that make no sense on the current screen', () => {
    const s = loaded();
    expect(reducer(s, { type: 'confirm' })).toBe(s);
    expect(reducer(s, { type: 'lost' })).toBe(s);
  });
});

describe('search', () => {
  const label = (c: string) => c;

  it('lists every room, lowest floor first', () => {
    const all = searchRooms(site, '', label);
    expect(all).toHaveLength(site.map.rooms.length);
    expect(all[0]?.levelId).toBe('G');
    expect(all.at(-1)?.levelId).toBe('2');
  });

  it('matches name, number and category', () => {
    expect(searchRooms(site, 'radio', label).map((r) => r.room.id)).toEqual(['radiology']);
    expect(searchRooms(site, '204', label).map((r) => r.room.id)).toEqual(['ct-scan']);
    expect(searchRooms(site, 'opd', label)).toHaveLength(5);
  });

  it('toilet chip includes accessible toilets; step-free restricts to them', () => {
    const toilet = (stepFree: boolean) =>
      amenityChips(site, stepFree).find((c) => c.labelKey === 'chip.toilet');
    expect(toilet(false)?.kinds).toEqual(['toilet', 'toilet-accessible']);
    expect(toilet(true)?.kinds).toEqual(['toilet-accessible']);
  });

  it('resolves typed QR codes (with facing), room numbers and names', () => {
    expect(resolvePosition(site, ' g-lift ')).toEqual({
      node: 'G-LOB',
      facing: 90,
      source: 'typed',
    });
    expect(resolvePosition(site, '201')).toEqual({ node: '2-N18', source: 'typed' });
    expect(resolvePosition(site, 'nowhere')).toBeNull();
  });

  it('nearby landmarks are on the same floor, closest first', () => {
    const near = nearbyLandmarks(site, '2-C30', 3);
    expect(near[0]?.id).toBe('2-C30');
    expect(near.every((n) => n.id.startsWith('2-'))).toBe(true);
  });

  it('reads codes from our QR links or bare codes', () => {
    expect(codeFromQr('https://innermap.in/?site=demo-hospital&at=G-MAIN')).toBe('G-MAIN');
    expect(codeFromQr('G-MAIN')).toBe('G-MAIN');
  });
});

describe('saved trip', () => {
  const memory = (): KeyValue & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => void data.set(k, v),
      removeItem: (k) => void data.delete(k),
    };
  };
  const navigating = loaded(
    { type: 'set-position', position: atMain },
    { type: 'choose', target: radiology },
    { type: 'start' },
    { type: 'confirm' },
  );

  it('saves during a trip and loads it back', () => {
    const store = memory();
    persistTrip(store, 'demo-hospital', navigating, 1000);
    expect(loadTrip(store, 'demo-hospital', 2000)).toMatchObject({ step: 1, target: radiology });
  });

  it('expires after 3 hours and ignores other sites', () => {
    const store = memory();
    persistTrip(store, 'demo-hospital', navigating, 0);
    expect(loadTrip(store, 'demo-hospital', TRIP_TTL_MS + 1)).toBeNull();
    expect(loadTrip(store, 'other-site', 1)).toBeNull();
  });

  it('clears once the trip is over', () => {
    const store = memory();
    persistTrip(store, 'demo-hospital', navigating, 0);
    persistTrip(store, 'demo-hospital', reducer(navigating, { type: 'new-destination' }), 1);
    expect(store.data.size).toBe(0);
  });

  it('never throws when storage is broken or missing', () => {
    const broken: KeyValue = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
      removeItem: () => undefined,
    };
    expect(() => persistTrip(broken, 's', navigating, 0)).not.toThrow();
    expect(loadTrip(broken, 's', 0)).toBeNull();
    expect(loadTrip(null, 's', 0)).toBeNull();
  });
});
