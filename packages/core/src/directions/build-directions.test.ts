import { describe, expect, it } from 'vitest';
import type { MessageKey, Messages } from '../i18n/en';
import { en } from '../i18n/en';
import { createTranslator } from '../i18n/translator';
import type { Site } from '../site/site';
import { loadSite } from '../site/site';
import { demoMap } from '../test-support';
import type { Destination } from '../usecases/find-route';
import { findRoute } from '../usecases/find-route';
import type { DirectionsOptions, Step } from './build-directions';
import { buildDirections } from './build-directions';

const site = loadSite(demoMap());

/** Route from a QR code (using its facing) or a node id, then build steps. */
function directions(
  from: string,
  to: Destination,
  extra: DirectionsOptions & { stepFree?: boolean; on?: Site } = {},
): Step[] {
  const on = extra.on ?? site;
  const qr = on.findQr(from);
  const result = findRoute(on, {
    from: qr?.node ?? from,
    to,
    profile: { stepFree: extra.stepFree ?? false },
  });
  if (!result.ok) throw new Error(result.error.code);
  return buildDirections(on, result.value, {
    ...(qr ? { startFacing: qr.facing } : {}),
    ...extra,
  });
}

/** Human-readable listing, reviewed by both founders (PHASES.md Phase 3 checkpoint). */
const read = (steps: Step[]) =>
  steps
    .map((s, i) => `${i + 1}. [${s.levelName}] ${s.text}${s.meters ? ` (${s.meters} m)` : ''}`)
    .join('\n');

const room = (roomId: string): Destination => ({ type: 'room', roomId });
const node = (nodeId: string): Destination => ({ type: 'node', nodeId });

describe('golden directions (read these aloud)', () => {
  it('Main Entrance → Radiology', () => {
    expect(read(directions('G-MAIN', room('radiology')))).toMatchInlineSnapshot(`
      "1. [Ground] With the sign in front of you, go straight to Reception desk (blue board), Lift A lobby. (6 m)
      2. [Ground] Turn RIGHT and walk to Lift A. (4 m)
      3. [Floor 2] Take Lift A up to Floor 2.
      4. [Floor 2] Exit Lift A, then go straight to Lift A lobby, Floor 2. (4 m)
      5. [Floor 2] Turn RIGHT and walk to Radiology waiting hall. (7 m)
      6. [Floor 2] Radiology is straight ahead 🎉 (3 m)"
    `);
  });

  it('Emergency entrance → OPD 101', () => {
    expect(read(directions('G-EMR', room('opd-101')))).toMatchInlineSnapshot(`
      "1. [Ground] With the sign in front of you, go straight past Emergency department to West corridor end (red floor line to Emergency). (11 m)
      2. [Ground] Turn RIGHT and walk past Billing counter and Canteen to Pharmacy counter (green board). (25 m)
      3. [Ground] Turn RIGHT and walk to Reception desk (blue board), Lift A lobby. (7 m)
      4. [Ground] Turn LEFT and walk to Lift A. (4 m)
      5. [Floor 1] Take Lift A up to Floor 1.
      6. [Floor 1] Exit Lift A, then go straight to Lift A lobby, Floor 1. (4 m)
      7. [Floor 1] Turn RIGHT and walk to OPD nurses' station. (7 m)
      8. [Floor 1] Turn LEFT and walk to OPD 101–102 (yellow signboard). (12 m)
      9. [Floor 1] General Medicine is on your RIGHT 🎉 (3 m)"
    `);
  });

  it('Lift B lobby → CT scan (turn around first)', () => {
    expect(read(directions('2-WEST', room('ct-scan')))).toMatchInlineSnapshot(`
      "1. [Floor 2] With the sign in front of you, turn around and walk past Radiology reception (purple board) to MRI and CT scan corridor. (37 m)
      2. [Floor 2] CT scan is on your RIGHT 🎉 (3 m)"
    `);
  });

  it('West corridor → Doctors lounge (lift that skips a floor, locked room)', () => {
    expect(read(directions('G-WEST', room('doctors-lounge')))).toMatchInlineSnapshot(`
      "1. [Ground] With the sign in front of you, turn RIGHT and walk to Lift B (west). (5 m)
      2. [Floor 2] Take Lift B up to Floor 2.
      3. [Floor 2] Exit Lift B, then go straight to Lift B lobby (west). (5 m)
      4. [Floor 2] Doctors' lounge is straight ahead 🎉 This is a staff-only area 🔒 Please ask at the door. (3 m)"
    `);
  });

  it('Floor 2 lift lobby → nearest toilet (stairs down)', () => {
    expect(read(directions('2-LIFT', { type: 'amenity', kinds: ['toilet'] })))
      .toMatchInlineSnapshot(`
      "1. [Floor 2] With the sign in front of you, turn LEFT and walk to Radiology waiting hall. (7 m)
      2. [Floor 2] Turn RIGHT and walk past MRI and CT scan corridor to Floor 2 landing, east staircase. (25 m)
      3. [Floor 2] Turn RIGHT and walk to East staircase. (5 m)
      4. [Floor 1] Use the East staircase to go down to Floor 1.
      5. [Floor 1] On Floor 1, walk to Floor 1 toilets, near the east staircase. (5 m)
      6. [Floor 1] You have arrived at Toilet 🎉"
    `);
  });

  it('Floor 1 east → Floor 2 east, step-free', () => {
    expect(read(directions('1-EAST', node('2-E'), { stepFree: true }))).toMatchInlineSnapshot(`
      "1. [Floor 1] With the sign in front of you, turn around and walk past Children's play corner to OPD nurses' station. (25 m)
      2. [Floor 1] Turn LEFT and walk to Lift A lobby, Floor 1. (7 m)
      3. [Floor 1] Turn LEFT and walk to Lift A. (4 m)
      4. [Floor 2] Take Lift A up to Floor 2.
      5. [Floor 2] Exit Lift A, then go straight to Lift A lobby, Floor 2. (4 m)
      6. [Floor 2] Turn RIGHT and walk to Radiology waiting hall. (7 m)
      7. [Floor 2] Turn RIGHT and walk past MRI and CT scan corridor to Floor 2 landing, east staircase. (25 m)
      8. [Floor 2] You have arrived at Floor 2 landing, east staircase 🎉"
    `);
  });

  it('Ground east → Floor 2 east by stairs (two flights, one step)', () => {
    expect(read(directions('G-E', node('2-E')))).toMatchInlineSnapshot(`
      "1. [Ground] Walk to East staircase. (5 m)
      2. [Floor 2] Use the East staircase to go up to Floor 2.
      3. [Floor 2] On Floor 2, walk to Floor 2 landing, east staircase. (5 m)
      4. [Floor 2] You have arrived at Floor 2 landing, east staircase 🎉"
    `);
  });

  it('West corridor → Ground-floor toilets (long straight corridor)', () => {
    expect(read(directions('G-WEST', node('G-E')))).toMatchInlineSnapshot(`
      "1. [Ground] With the sign in front of you, turn around and walk past Billing counter and Canteen to X-Ray waiting area (blue chairs). (37 m)
      2. [Ground] Go straight to Ground-floor toilets, near the east staircase. (13 m)
      3. [Ground] You have arrived at Ground-floor toilets, near the east staircase 🎉"
    `);
  });
});

describe('rules', () => {
  it('a floor change is walk → ride → walk', () => {
    const kinds = directions('G-MAIN', room('radiology')).map((s) => s.kind);
    expect(kinds).toEqual(['walk', 'walk', 'ride', 'walk', 'walk', 'arrive']);
  });

  it('the ride step belongs to the arrival floor and carries its color', () => {
    const ride = directions('G-MAIN', room('radiology')).find((s) => s.kind === 'ride');
    expect(ride).toMatchObject({
      icon: 'lift',
      levelId: '2',
      levelColor: 'violet',
      target: '2-LA',
    });
  });

  it('every step except the arrival has a target to confirm', () => {
    const steps = directions('G-EMR', room('opd-101'));
    const route = findRoute(site, { from: 'G-ENT2', to: room('opd-101') });
    const routeNodes = route.ok ? route.value.nodes.map((n) => n.id) : [];
    for (const s of steps) expect(routeNodes).toContain(s.target);
    expect(steps.at(-1)?.target).toBe('1-N18');
  });

  it('the QR facing decides the first turn', () => {
    const facingWest = directions('G-W', node('G-LB'), { startFacing: 270 })[0];
    const facingNorth = directions('G-W', node('G-LB'), { startFacing: 0 })[0];
    expect(facingWest?.icon).toBe('right');
    expect(facingNorth?.icon).toBe('straight');
    expect(facingNorth?.text).toMatch(/^With the sign in front of you, go straight/);
  });

  it('without a facing, the first step just says where to walk', () => {
    const first = directions('G-W', node('G-LB'))[0];
    expect(first).toMatchObject({ icon: 'walk', text: 'Walk to Lift B (west).' });
  });

  it('an unnamed turn point is described by distance', () => {
    const map = demoMap();
    const lobby = map.nodes.find((n) => n.id === 'G-LOB');
    if (lobby) delete lobby.landmark;
    const first = directions('G-MAIN', room('radiology'), { on: loadSite(map) })[0];
    expect(first?.text).toBe(
      'With the sign in front of you, go straight to the corner about 6 m ahead.',
    );
  });

  it('a long straight corridor gets a reassurance step at a landmark', () => {
    const steps = directions('G-W', node('G-E'));
    expect(steps.map((s) => s.target)).toEqual(['G-C42', 'G-E', 'G-E']);
  });

  it('starting at the destination says so', () => {
    expect(read(directions('G-N30', room('pharmacy')))).toBe(
      '1. [Ground] You are already at Pharmacy 🎉',
    );
  });
});

describe('translations', () => {
  it('uses whatever templates the translator provides', () => {
    // A pretend language that puts the verb last, to prove nothing is glued in English order.
    const reversed = Object.fromEntries(
      Object.entries(en).map(([key, text]) => [key, `«${text}»`]),
    ) as Record<MessageKey, string> as Messages;
    // 2-LIFT faces east; Radiology waiting hall is to the north → the first step turns left.
    const steps = directions('2-LIFT', room('radiology'), {
      translator: createTranslator({
        ...reversed,
        'walk.turn': '{target} — {turn}',
        'turn.left': 'बाएं मुड़ें',
      }),
    });
    expect(steps[0]?.text).toContain('Radiology waiting hall — बाएं मुड़ें');
    expect(steps[0]?.text).toMatch(/^«with the sign in front of you, /);
  });
});
