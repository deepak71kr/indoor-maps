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
  await expect(page.getByText('To Radiology')).toBeVisible();

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
  await expect(page.getByText('To Radiology')).toBeVisible();
});
