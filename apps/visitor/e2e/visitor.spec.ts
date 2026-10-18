import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

/** A cheap phone on a bad connection: ~2G bandwidth, high latency, 4× slower CPU. */
async function slowPhone(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 800, // ms round trip
    downloadThroughput: (250 * 1024) / 8, // 250 kbit/s
    uploadThroughput: (50 * 1024) / 8,
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
}

const iAmHere = (page: Page) => page.getByRole('button', { name: "I'm here" });

/** Taps "I'm here" until the Arrived screen. */
async function walkToTheEnd(page: Page): Promise<void> {
  for (let i = 0; i < 20 && (await iAmHere(page).count()) > 0; i++) await iAmHere(page).click();
}

test('full trip on 2G with a 4× slower CPU', async ({ page }) => {
  await slowPhone(page);

  const started = Date.now();
  await page.goto('/?at=G-MAIN');
  await expect(page.getByRole('heading', { name: 'Where to?' })).toBeVisible();
  const firstScreenMs = Date.now() - started;
  test.info().annotations.push({ type: 'first screen on 2G', description: `${firstScreenMs} ms` });
  // Measured ≈ 3.3 s locally (Phase 5); 8 s leaves room for slower CI machines.
  expect(firstScreenMs).toBeLessThan(8_000);

  // Choose Radiology (another floor) and start walking.
  await page.getByRole('searchbox').fill('radio');
  await page.getByRole('button', { name: /Radiology/ }).click();
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByText('Step 1 of 5')).toBeVisible();
  await iAmHere(page).click();

  // Lost → type the code of a sticker on Floor 1 → re-routed to the SAME destination.
  await page.getByRole('button', { name: "I'm lost" }).click();
  await page.getByRole('textbox').fill('1-LIFT');
  await page.getByRole('button', { name: 'Go' }).click();
  await expect(page.getByText('New route from here')).toBeVisible();
  await expect(page.getByText('Route to Radiology')).toBeVisible();

  await walkToTheEnd(page);
  await expect(page.getByRole('heading', { name: /Radiology is straight ahead/ })).toBeVisible();
});

test('second visit works in airplane mode', async ({ page, context }) => {
  // First visit online: the service worker installs and the map is saved.
  await page.goto('/?at=G-MAIN');
  await expect(page.getByRole('heading', { name: 'Where to?' })).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() => page.evaluate(() => caches.has('im-maps')), { message: 'map saved for offline' })
    .toBe(true);

  await context.setOffline(true);

  // A QR scan while offline opens the app from the phone's cache.
  const offline = await context.newPage();
  await offline.goto('/?at=2-WEST');
  await expect(offline.getByRole('heading', { name: 'Where to?' })).toBeVisible();
  await offline.getByRole('button', { name: /CT scan/ }).click();
  await offline.getByRole('button', { name: 'Start' }).click();
  await expect(offline.getByText(/turn around and walk past/)).toBeVisible();
  await walkToTheEnd(offline);
  await expect(offline.getByRole('heading', { name: /CT scan is on your RIGHT/ })).toBeVisible();
});

test('an unfinished trip survives closing the browser', async ({ page }) => {
  await page.goto('/?at=G-MAIN');
  await page.getByRole('button', { name: /Radiology/ }).click();
  await page.getByRole('button', { name: 'Start' }).click();
  await iAmHere(page).click();
  await expect(page.getByText('Step 2 of 5')).toBeVisible();

  await page.reload();
  await expect(page.getByText('Step 2 of 5')).toBeVisible();
  await expect(page.getByText('Route to Radiology')).toBeVisible();
});

test('the 2D map follows the trip: route line, floor change, pan and re-centre', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 }); // a small phone
  await page.goto('/?at=G-MAIN');
  const map = page.getByRole('img', { name: /^Map of / });
  await expect(map).toHaveAccessibleName('Map of Ground');
  await expect(map.getByText('You are here')).toBeVisible();
  await expect(map.getByText('Pharmacy', { exact: true })).toBeVisible(); // room names from the plan

  await page.getByRole('button', { name: /Radiology/ }).click();
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.locator('.map .route .ahead')).not.toHaveCount(0);
  await expect(map.getByText('↑ Floor 2')).toBeVisible(); // where the route leaves this floor

  // Peek at Floor 2 with the floor buttons: the destination pin is there.
  const floors = page.getByRole('group', { name: 'Floor' });
  await expect(floors.getByRole('button')).toHaveText(['2', '1', 'G']);
  await floors.getByRole('button', { name: 'Floor 2', exact: true }).click();
  await expect(floors.getByRole('button', { name: 'Floor 2', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(map).toHaveAccessibleName('Map of Floor 2');
  await expect(page.locator('.map > .map-svg:not(.floor-ghost) .dest')).toBeVisible();

  // Taking the lift brings the map to the visitor's new floor by itself.
  for (let i = 0; i < 3; i++) await iAmHere(page).click();
  await expect(page.getByText('Step 4 of 5')).toBeVisible();
  await expect(map).toHaveAccessibleName('Map of Floor 2');

  // Let the floor-change animation finish (the map is tilted while it plays).
  await expect(page.locator('.floor-ghost')).toHaveCount(0);
  // Drag the map away (the middle is free: banner on top, sheet below), then come back.
  const box = await map.boundingBox();
  if (!box) throw new Error('map not laid out');
  const recentre = page.getByRole('button', { name: 'Back to my route' });
  await expect(recentre).toHaveAttribute('aria-pressed', 'true'); // following the route
  await page.mouse.move(box.x + 60, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + box.height / 2 + 40, { steps: 5 });
  await page.mouse.up();
  await expect(recentre).toHaveAttribute('aria-pressed', 'false');
  await recentre.click();
  await expect(recentre).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: test.info().outputPath('map-floor2.png') });
});

test('Google Maps layout: full-screen map, search bar, bottom sheet / side panel', async ({
  page,
}) => {
  await page.goto('/?at=G-MAIN');
  const map = page.getByRole('img', { name: /^Map of / });
  const sheet = page.locator('.sheet');
  await expect(map).toBeVisible();

  // Phone: the map fills the screen; search bar on top, sheet at the bottom.
  const mapBox = await map.boundingBox();
  const closed = await sheet.boundingBox();
  const search = await page.getByRole('searchbox').boundingBox();
  if (!mapBox || !closed || !search) throw new Error('not laid out');
  expect(mapBox.height).toBeGreaterThan(800); // the whole Pixel 7 screen
  expect(search.y).toBeLessThan(40);
  expect(closed.y).toBeGreaterThan(mapBox.y + mapBox.height / 2);
  await page.getByRole('button', { name: 'Show more' }).click();
  await expect(page.getByRole('button', { name: 'Show less' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect
    .poll(async () => (await sheet.boundingBox())?.height ?? 0)
    .toBeGreaterThan(closed.height);

  // Typing opens the full-screen search page; the back arrow returns to the map.
  await page.getByRole('searchbox').fill('lab');
  await expect(page.getByRole('button', { name: /Pathology lab/ })).toBeVisible();
  await page.getByRole('button', { name: 'Back to the map' }).click();
  await expect(page.locator('.search-page')).toBeHidden();
  await expect(page.getByRole('searchbox')).toHaveValue('');

  // Laptop: a floating panel on the left, the map still fills the whole screen.
  await page.setViewportSize({ width: 1366, height: 768 });
  await expect.poll(async () => (await sheet.boundingBox())?.width ?? 0).toBeLessThan(400);
  const wide = await map.boundingBox();
  expect(wide?.width).toBe(1366);
  await expect(page.getByRole('button', { name: 'Show more' })).toBeHidden();
});

test('campus: gate → a lab on another building’s Floor 2, with the campus map', async ({
  page,
}) => {
  await page.goto('/?site=demo-campus&at=GATE');
  const map = page.getByRole('img', { name: /^Map of / });
  await expect(map).toHaveAccessibleName('Map of Ground');
  // Zoomed out: buildings with their names, not their rooms.
  await expect(map.getByText('Block A', { exact: true })).toBeVisible();
  await expect(map.getByText('Library', { exact: true })).toBeVisible();
  await expect(map.getByText('A-G01 · Seminar hall')).toBeHidden();

  // Tap Block A: the map zooms in and the floor picker lists its floors.
  const label = await map.getByText('Block A', { exact: true }).boundingBox();
  if (!label) throw new Error('no Block A label');
  await page.mouse.click(label.x + label.width / 2, label.y + label.height + 12);
  const floors = page.getByRole('group', { name: 'Floor' }).getByRole('button');
  await expect(floors).toHaveText(['2', '1', 'G']);
  await expect(floors.first()).toHaveAccessibleName('Block A · Floor 2');
  await expect(map.getByText('Block A', { exact: true })).toBeHidden(); // rooms show instead

  // Search by building, then walk: road → entrance → lift → Floor 2.
  await page.getByRole('searchbox').fill('block a');
  await page.getByRole('button', { name: /Computer lab/ }).click();
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.locator('.banner')).toContainText('Fountain circle');
  for (let i = 0; i < 4; i++) await iAmHere(page).click();
  await expect(map).toHaveAccessibleName('Map of Block A · Floor 2');
  await expect(page.locator('.banner .floor-chip')).toHaveText('Block A · Floor 2');
  await walkToTheEnd(page);
  await expect(page.getByRole('heading', { name: /Computer lab is on your RIGHT/ })).toBeVisible();
});

test('pick on the map → preview the whole route → walk: colours, checkpoints, rotate', async ({
  page,
}) => {
  await page.goto('/?at=G-MAIN');
  const map = page.getByRole('img', { name: /^Map of / });

  // Tap the Pharmacy room on the map: it becomes the destination.
  const room = await map.locator('.label', { hasText: 'Pharmacy' }).first().boundingBox();
  if (!room) throw new Error('no Pharmacy label');
  await page.mouse.click(room.x + room.width / 2, room.y + room.height / 2 + 8);
  // Its card opens (Google style): name, floor, how far, Directions / Start / Share.
  await expect(page.getByRole('heading', { name: 'Pharmacy' })).toBeVisible();
  await expect(page.getByText('from you')).toBeVisible();
  await expect(map.locator('.room.selected')).toHaveCount(1);
  await page.getByRole('button', { name: 'Directions' }).click();
  await expect(page.getByRole('button', { name: 'To: Pharmacy' })).toBeVisible();
  // Reverse the route, then back again.
  await page.getByRole('button', { name: 'Reverse the route' }).click();
  await expect(page.getByRole('button', { name: 'To: Main Entrance' })).toBeVisible();
  await page.getByRole('button', { name: 'Reverse the route' }).click();

  // Change the destination from the To field, by search.
  await page.getByRole('button', { name: 'To: Pharmacy' }).click();
  await page.getByRole('searchbox').fill('radio');
  await page.getByRole('button', { name: /Radiology/ }).click();
  await page.getByRole('button', { name: 'Directions' }).click();

  // Preview: From/To, time, floors, every step, numbered checkpoints, the whole route in blue.
  await expect(page.getByRole('button', { name: 'From: Main Entrance' })).toBeVisible();
  await expect(page.getByText('5 checkpoints')).toBeVisible();
  await expect(page.locator('.steps li')).toHaveCount(6);
  await expect(map.locator('.cp')).not.toHaveCount(0);
  await expect(page.locator('.map .route .walked')).toHaveCount(0);

  // Start, pass a checkpoint: walked grey + ✓, this leg blue, the rest lighter with arrows.
  await page.getByRole('button', { name: 'Start' }).click();
  await iAmHere(page).click();
  await expect(page.locator('.map .route .walked')).not.toHaveCount(0);
  await expect(page.locator('.map .route .ahead')).not.toHaveCount(0);
  await expect(map.locator('.next')).toHaveCount(1);
  // Checkpoints are named: the banner says from where to where, the map tags the next one.
  await expect(page.locator('.banner .route-line').first()).toContainText('from Reception desk');
  await expect(map.locator('.next .tag, .next text').first()).toBeVisible();
  // The step list (Google's Steps) highlights where you are; the overview shows it all.
  await page.getByRole('button', { name: 'Steps' }).click();
  await expect(page.locator('.steps li.now')).toContainText('Turn RIGHT');
  await page.getByRole('button', { name: 'Show the whole route' }).click();
  await page.getByRole('button', { name: 'Steps' }).click(); // close the list again

  // Rotate (Shift + drag on a laptop), then the compass turns it back to north.
  const turned = () =>
    page.evaluate(() => {
      const g = document.querySelector('.map-svg > g:not(.overlay):not(defs)');
      return Number(/rotate\(([-\d.e]+)\)/.exec(g?.getAttribute('transform') ?? '')?.[1] ?? 0);
    });
  // The map stays north-up while walking: it never turns by itself.
  await expect.poll(turned).toBeCloseTo(0, 0);
  await expect(page.getByRole('button', { name: 'Turn the map the way I face' })).toBeVisible();
  const box = await map.boundingBox();
  if (!box) throw new Error('map not laid out');
  await page.keyboard.down('Shift');
  // A clear part of the map (the Re-center pill sits lower left once the map moves).
  await page.mouse.move(box.x + 140, box.y + box.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(box.x + 260, box.y + box.height * 0.4, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect.poll(turned).not.toBeCloseTo(0, 0);
  await page.locator('.compass').click();
  await expect.poll(turned).toBeCloseTo(0, 0);
});

test('recent places and a shared room link', async ({ page }) => {
  await page.goto('/?at=G-MAIN');
  await page
    .locator('.places')
    .getByRole('button', { name: /Pharmacy/ })
    .click();
  await page.getByRole('button', { name: 'Directions' }).click();
  await page.getByRole('button', { name: 'Back to the map' }).click();
  await expect(page.locator('.recent')).toContainText('Pharmacy');

  // Someone shares a link to Radiology: it opens the route there from the scanned sticker.
  await page.goto('/?at=G-MAIN&to=radiology');
  await expect(page.getByRole('button', { name: 'To: Radiology' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start' })).toBeVisible();
});

test('big campus (stress test): opens fast, finds a lab, walks through floors', async ({
  page,
}) => {
  const started = Date.now();
  await page.goto('/?site=demo-mesra&at=MAIN-GATE');
  await expect(page.getByRole('heading', { name: 'Where to?' })).toBeVisible();
  expect(Date.now() - started).toBeLessThan(8_000);
  const map = page.getByRole('img', { name: /^Map of / });
  // Zoomed out, the Main Building is small: its name may show as initials.
  await expect(map.getByText(/^(Main Building|MB)$/).first()).toBeVisible();

  await page.getByRole('searchbox').fill('digital library');
  await page.getByRole('button', { name: /Digital library/ }).click();
  await page.getByRole('button', { name: 'Directions' }).click();
  await expect(page.getByRole('button', { name: 'To: Digital library' })).toBeVisible();
  await page.getByRole('button', { name: 'Start' }).click();
  await walkToTheEnd(page);
  await expect(page.getByRole('heading', { name: /Digital library is/ })).toBeVisible();
});

test('compass: the beam turns with the phone, calibrated at the QR sticker', async ({ page }) => {
  await page.goto('/?at=G-MAIN'); // this sticker faces "up" on the map (0°)
  await expect(page.getByRole('heading', { name: 'Where to?' })).toBeVisible();
  /** Pretend the phone points `heading` degrees from north (Android's absolute alpha). */
  const point = (heading: number) =>
    page.evaluate((h) => {
      const type =
        'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
      window.dispatchEvent(
        new DeviceOrientationEvent(type, { alpha: (360 - h) % 360, absolute: true }),
      );
    }, heading);
  const beam = () =>
    page.evaluate(() => {
      const t = document.querySelector('.map .beam')?.getAttribute('transform') ?? '';
      return Number(/rotate\(([-\d.]+)\)/.exec(t)?.[1] ?? NaN);
    });

  // Just after the scan the phone points where the sticker faces: compass 40° = map "up".
  await point(40);
  await expect.poll(beam).toBeCloseTo(0, 0);
  await page.waitForTimeout(2100); // calibration settles
  // Turn the phone 90° right: the beam turns 90° right on the (north-up) map.
  for (let i = 0; i < 40; i++) await point(130);
  await expect.poll(beam).toBeCloseTo(90, 0);
  // The map itself did not turn.
  const turned = await page.evaluate(() => {
    const g = document.querySelector('.map-svg > g:not(.overlay):not(.scale)');
    return /rotate\(([-\d.e]+)\)/.exec(g?.getAttribute('transform') ?? '')?.[1];
  });
  expect(Number(turned)).toBeCloseTo(0, 0);
});

test('route options and "Path blocked?": shortest / fastest, detour around a blockage', async ({
  page,
}) => {
  await page.goto('/?at=G-MAIN');
  await page
    .locator('.places')
    .getByRole('button', { name: /Radiology/ })
    .click();
  await page.getByRole('button', { name: 'Directions' }).click();
  const options = page.getByRole('group', { name: 'Route options' });
  await expect(options.getByRole('button', { name: '⚡ Fastest' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await options.getByRole('button', { name: '📏 Shortest' }).click();
  await expect(options.getByRole('button', { name: '📏 Shortest' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // Walk one step, then the way to the lift is blocked: a new way round, the blockage in red.
  await page.getByRole('button', { name: 'Start' }).click();
  await iAmHere(page).click();
  await page.getByRole('button', { name: 'Path blocked?' }).click();
  await expect(page.getByText('New way around the blocked path')).toBeVisible();
  await expect(page.locator('.map .closed')).not.toHaveCount(0);
  await walkToTheEnd(page);
  await expect(page.getByRole('heading', { name: /Radiology/ })).toBeVisible();
});

test('Google-style details: Save + Saved tab, Walk / Step-free tabs, Exit and arrival time', async ({
  page,
}) => {
  await page.goto('/?at=G-MAIN');
  await page
    .locator('.places')
    .getByRole('button', { name: /Radiology/ })
    .click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible();

  await page.getByRole('button', { name: 'Directions' }).click();
  const modes = page.getByRole('tablist', { name: 'How to go' });
  await expect(modes.getByRole('tab', { name: /Walk/ })).toHaveAttribute('aria-selected', 'true');
  await modes.getByRole('tab', { name: /Step-free/ }).click();
  await expect(modes.getByRole('tab', { name: /Step-free/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.locator('.map .eta-bubble')).toHaveCount(1);

  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByRole('button', { name: 'End route' })).toHaveText('Exit');
  await expect(page.locator('.trip-sub')).toHaveText(/\d+ m · \d{1,2}:\d{2}/);
  await page.getByRole('button', { name: 'End route' }).click();

  await page.getByRole('tab', { name: /Saved/ }).click();
  await expect(page.locator('.tab-saved')).toContainText('Radiology');
});

test('floors: colour per floor, "viewing another floor" note, floor chips, lift tile', async ({
  page,
}) => {
  await page.goto('/?at=G-MAIN');
  const map = page.getByRole('img', { name: /^Map of / });
  await expect(map).toHaveClass(/lvl-teal/); // Ground is teal
  await expect(page.locator('.map .entry-bar')).not.toHaveCount(0); // ways in and out, in green

  await page
    .locator('.places')
    .getByRole('button', { name: /Radiology/ })
    .click();
  await page.getByRole('button', { name: 'Directions' }).click();
  // The floor chips in the preview show that floor's part of the route.
  await page.getByRole('button', { name: 'Map of Floor 2' }).click();
  await expect(map).toHaveAccessibleName('Map of Floor 2');
  await expect(map).toHaveClass(/lvl-violet/);
  const note = page.locator('.floor-note');
  await expect(note).toContainText('Viewing Floor 2 · you are on Ground');
  await note.getByRole('button', { name: 'Back' }).click();
  await expect(map).toHaveAccessibleName('Map of Ground');
  await expect(note).toBeHidden();

  // The lift step: a big tile with the floor to press.
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  for (let i = 0; i < 2; i++) await iAmHere(page).click();
  await expect(page.locator('.banner .floor-tile')).toHaveText('2');
  await expect(page.locator('.banner')).toContainText('Press 2 in the lift');
});
