import { readFileSync } from 'node:fs';
import type { MapFile } from '@innermap/schema';
import { validateMapFile } from '@innermap/schema/validate';
import { expect, test } from '@playwright/test';

test('⚡ Quick build: wizard, copy a floor up, room list, auto-connect → a valid map', async ({
  page,
}) => {
  await page.goto('/');
  page.on('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'New' }).click();

  // The wizard draws a three-floor building that passes every check.
  await page.getByRole('button', { name: /Building wizard/ }).click();
  await page.getByRole('button', { name: 'Build it' }).click();
  await expect(page.locator('.quick-note')).toContainText('3 floors drawn');
  await expect(page.getByText('No problems found')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Floor 2' })).toBeVisible();

  // The same plan one floor higher: Floor 3, rooms numbered 3xx.
  await page.getByRole('tab', { name: 'Floor 2' }).click();
  await page.getByRole('button', { name: /Copy floor up/ }).click();
  await expect(page.getByRole('tab', { name: 'Floor 3' })).toBeVisible();
  await expect(page.locator('.quick-note')).toContainText('Floor copied');

  // Room names and kinds from a pasted spreadsheet.
  await page.getByRole('button', { name: /Room list/ }).click();
  await page
    .locator('.wizard textarea')
    .fill('Room No,Name,Type,Popular\nG01,Admission office,Admin,yes\n301,Physics lab,Laboratory,');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.locator('.quick-note')).toContainText('2 rooms updated');

  // Nothing left to join on a freshly built floor.
  await page.getByRole('button', { name: /Auto-connect/ }).click();
  await expect(page.locator('.quick-note')).toContainText('Nothing to do');

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export' }).click();
  const path = await (await download).path();
  const doc = JSON.parse(readFileSync(path, 'utf8')) as MapFile;
  expect(validateMapFile(doc).ok).toBe(true);
  expect(doc.rooms.find((r) => r.number === 'G01')).toMatchObject({
    name: 'Admission office',
    category: 'admin',
    popular: true,
  });
  expect(doc.rooms.find((r) => r.number === '301')?.category).toBe('lab');
  expect(doc.levels).toHaveLength(4);
});
