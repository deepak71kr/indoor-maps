import { readFileSync } from 'node:fs';
import type { MapFile } from '@innermap/schema';
import { validateMapFile } from '@innermap/schema/validate';
import { expect, test } from '@playwright/test';
import { clickAt, dragFrom, tool } from './helpers';

test('trace rooms over the plan: rectangle, corner by corner, reshape, export', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Load demo' }).click();
  const outlines = page.locator('.plan-shapes polygon');
  await expect(outlines).toHaveCount(12); // Ground floor of the demo

  // Select the Billing outline by clicking inside it, and delete it.
  await tool(page, 'Select / move');
  await clickAt(page, 15, 6);
  await expect(page.getByRole('heading', { name: 'Outline: Room' })).toBeVisible();
  await expect(page.getByLabel('Linked room')).toHaveValue('billing');
  await page.keyboard.press('Delete');
  await expect(outlines).toHaveCount(11);

  // Redraw it with a rectangle: it finds its room by the door on its wall.
  await tool(page, 'Outline');
  await page.getByRole('radio', { name: /Room/ }).click();
  await dragFrom(page, [12.2, 4.1], [23.8, 11.9]); // snaps to the neighbours' corners
  await expect(outlines).toHaveCount(12);
  await expect(page.getByLabel('Linked room')).toHaveValue('billing');

  // A courtyard, corner by corner, closed by clicking the first corner again.
  await page.getByRole('radio', { name: /Courtyard/ }).click();
  for (const [x, y] of [
    [40, 27],
    [46, 27],
    [46, 31],
    [40, 27],
  ] as const) {
    await clickAt(page, x, y);
  }
  await expect(outlines).toHaveCount(13);
  await page.getByLabel('Label on the map').fill('Garden');
  await page.getByLabel('Label on the map').press('Tab');
  await expect(page.locator('.shape-label', { hasText: 'Garden' })).toBeVisible();

  // Reshape: drag a corner.
  await dragFrom(page, [46, 31], [44, 32]);
  await expect(page.getByText('3 corners')).toBeVisible();

  // Undo the reshape, the label and the courtyard.
  for (let i = 0; i < 3; i++) await page.keyboard.press('Control+z');
  await expect(outlines).toHaveCount(12);
  await page.screenshot({ path: test.info().outputPath('outlines.png') });

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export' }).click();
  const map = JSON.parse(readFileSync(await (await download).path(), 'utf8')) as MapFile;
  const valid = validateMapFile(map);
  expect(valid.ok ? [] : valid.issues).toEqual([]);
  expect(map.levels[0]?.shapes?.find((s) => s.room === 'billing')?.pts).toEqual([
    12, 4, 24, 4, 24, 12, 12, 12,
  ]);
});
