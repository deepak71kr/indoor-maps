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
  await expect(offline.getByText(/turn around and walk past/)).toBeVisible();
  await walkToTheEnd(offline);
  await expect(offline.getByRole('heading', { name: /CT scan is on your RIGHT/ })).toBeVisible();
});

test('an unfinished trip survives closing the browser', async ({ page }) => {
  await page.goto('/?at=G-MAIN');
  await page.getByRole('button', { name: /Radiology/ }).click();
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
  await expect(map.getByText('Pharmacy')).toBeVisible(); // room names drawn from the plan

  await page.getByRole('button', { name: /Radiology/ }).click();
  await expect(page.locator('.map .route .ahead')).not.toHaveCount(0);
  await expect(map.getByText('↑ Floor 2')).toBeVisible(); // where the route leaves this floor

  // Peek at Floor 2 with the floor picker: the destination pin is there.
  await page.getByRole('combobox', { name: 'Floor' }).selectOption('2');
  await expect(map).toHaveAccessibleName('Map of Floor 2');
  await expect(page.locator('.map .dest')).toBeVisible();

  // Taking the lift brings the map to the visitor's new floor by itself.
  for (let i = 0; i < 3; i++) await iAmHere(page).click();
  await expect(page.getByText('Step 4 of 5')).toBeVisible();
  await expect(map).toHaveAccessibleName('Map of Floor 2');

  // Drag the map away, then come back to the route.
  const box = await map.boundingBox();
  if (!box) throw new Error('map not laid out');
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 220, box.y + 160, { steps: 5 });
  await page.mouse.up();
  const recentre = page.getByRole('button', { name: 'Back to my route' });
  await expect(recentre).toBeVisible();
  await recentre.click();
  await expect(recentre).toBeHidden();
  await page.screenshot({ path: test.info().outputPath('map-floor2.png') });
});

test('map first: bottom sheet on a phone, side panel on a laptop', async ({ page }) => {
  await page.goto('/?at=G-MAIN');
  const map = page.getByRole('img', { name: /^Map of / });
  const sheet = page.locator('.sheet');
  await expect(map).toBeVisible();

  // Phone: the map is on top and the sheet below it; the handle makes the sheet taller.
  const mapBox = await map.boundingBox();
  const closed = await sheet.boundingBox();
  if (!mapBox || !closed) throw new Error('not laid out');
  expect(closed.y).toBeGreaterThan(mapBox.y + 150);
  await page.getByRole('button', { name: 'Show more' }).click();
  await expect(page.getByRole('button', { name: 'Show less' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect
    .poll(async () => (await sheet.boundingBox())?.height ?? 0)
    .toBeGreaterThan(closed.height);

  // Laptop: the panel sits beside the map, which fills the rest of the screen.
  await page.setViewportSize({ width: 1366, height: 768 });
  await expect.poll(async () => (await map.boundingBox())?.x ?? 0).toBeGreaterThanOrEqual(399);
  const wide = await map.boundingBox();
  expect(wide?.height).toBeGreaterThan(700);
  await expect(page.getByRole('button', { name: 'Show more' })).toBeHidden();
});
