import { expect, test } from '@playwright/test';
import { clickAt, dragFrom, screen, tool } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Load demo' }).click();
  await expect(page.locator('.side h2', { hasText: 'Checks' })).toContainText('✅');
});

test('a check points at the problem and clicking it shows it on the map', async ({ page }) => {
  // Break it: remove the line joining Lift A to the Floor 1 lobby.
  await page.getByRole('tab', { name: /Floor 1/ }).click();
  await clickAt(page, 32, 22);
  await expect(page.getByRole('heading', { name: /Line/ })).toBeVisible();
  await page.keyboard.press('Delete');

  const issue = page.getByRole('button', { name: /Lift A on Floor 1 isn't joined to a corridor/ });
  await expect(issue).toBeVisible();
  await page.getByRole('tab', { name: /Ground/ }).click();
  await issue.click();
  // Jumps to Floor 1 and selects the lift stop.
  await expect(page.getByRole('tab', { name: /Floor 1/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: /Lift stop/ })).toBeVisible();

  await page.keyboard.press('Control+z');
  await expect(page.locator('.side h2', { hasText: 'Checks' })).toContainText('✅');
});

test('drag an amenity from the palette onto the map', async ({ page }) => {
  const before = await page.locator('.amenities text').count();
  const drop = await screen(page, 30.5, 14.5); // next to the Pharmacy counter dot
  const svgBox = await page.locator('.canvas svg').boundingBox();
  await page.getByRole('button', { name: 'Drinking water' }).dragTo(page.locator('.canvas svg'), {
    targetPosition: { x: drop.x - (svgBox?.x ?? 0), y: drop.y - (svgBox?.y ?? 0) },
  });
  await expect(page.locator('.amenities text')).toHaveCount(before + 1);
  await expect(page.getByRole('heading', { name: 'Amenity' })).toBeVisible();
  await expect(page.getByText('At: Pharmacy counter (green board)')).toBeVisible();
});

test('QR tool: press on a dot and drag toward the wall', async ({ page }) => {
  await tool(page, 'QR sticker');
  await dragFrom(page, [42, 15], [42, 5]); // X-Ray waiting area, aiming north
  await expect(page.getByRole('heading', { name: /QR sticker/ })).toBeVisible();
  await expect(page.getByLabel('Code printed under the QR')).toHaveValue('G-1');
  await expect(page.getByText(/Reader faces .*: 0°/)).toBeVisible();

  await dragFrom(page, [42, 15], [52, 15]); // turn it to face east
  await expect(page.getByText(/Reader faces .*: 90°/)).toBeVisible();
  // Ground floor had 5 stickers; turning it again doesn't add a second one.
  await expect(page.locator('.qr-marker')).toHaveCount(6);
});

test('▶ Test route shows exactly what a visitor will read', async ({ page }) => {
  await tool(page, 'Test route');
  await clickAt(page, 30, 28); // Main Entrance — has the G-MAIN sticker facing north
  await page.locator('.test-panel select').selectOption({ label: 'Radiology (201) — Floor 2' });
  const steps = page.locator('.test-panel .steps li');
  await expect(steps).toHaveCount(6);
  await expect(steps.first()).toContainText(
    'With the sign in front of you, go straight to Reception desk (blue board), Lift A lobby.',
  );
  await expect(steps.last()).toContainText('Radiology is straight ahead 🎉');
  // A straight vertical line has a zero-width box, so count instead of toBeVisible.
  await expect(page.locator('.route line')).not.toHaveCount(0);
  await page.screenshot({ path: 'test-results/test-route.png' });

  // Clicking a step shows that floor.
  await steps.last().getByRole('button').click();
  await expect(page.getByRole('tab', { name: /Floor 2/ })).toHaveAttribute('aria-selected', 'true');

  await page.getByLabel('♿ Step-free').check();
  await expect(steps.first()).toBeVisible();
});

test('print an A4 sheet of QR stickers', async ({ page }) => {
  const popup = page.waitForEvent('popup');
  await page.getByRole('button', { name: /Print QR \(10\)/ }).click();
  const sheet = await popup;
  await expect(sheet.locator('.sticker')).toHaveCount(10);
  await expect(sheet.locator('.sticker svg')).toHaveCount(10);
  await expect(sheet.locator('.code', { hasText: 'G-MAIN' })).toBeVisible();
  await expect(sheet.getByText('You are at: Main Entrance')).toBeVisible();
});
