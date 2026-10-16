import { readFileSync } from 'node:fs';
import type { MapFile } from '@innermap/schema';
import { validateMapFile } from '@innermap/schema/validate';
import { expect, test } from '@playwright/test';
import { dragFrom, tool } from './helpers';

test('campus: add a building, trace its footprint and a road, give it its own floor', async ({
  page,
}) => {
  await page.goto('/');
  page.on('dialog', (dialog) => void dialog.accept('Hostel'));
  await page.getByRole('button', { name: '+ Building' }).click();
  await expect(page.getByLabel('Name of Hostel')).toBeVisible();

  // Footprint on the Ground floor: links itself to the building not drawn yet.
  await tool(page, 'Outline');
  await page.getByRole('radio', { name: /Building/ }).click();
  await dragFrom(page, [0, 0], [20, 12]);
  await expect(page.getByLabel('Linked building')).toHaveValue('hostel');
  await expect(page.locator('.shape-label', { hasText: 'Hostel' })).toBeVisible();

  // A road below it, drawn underneath (first in the list).
  await page.getByRole('radio', { name: /Road/ }).click();
  await dragFrom(page, [0, 14], [20, 18]);
  await expect(page.locator('.plan-shapes polygon').first()).toHaveClass(/road/);

  // A new floor, then move it into the Hostel: its tab now says so.
  await page.getByRole('button', { name: '+ Floor' }).click();
  await page.getByLabel('Belongs to').selectOption('hostel');
  await expect(page.getByRole('tab', { name: /Hostel · Floor 1/ })).toBeVisible();
  // On the Hostel's own floor the campus shows faded underneath, to line it up.
  await expect(page.locator('.plan-shapes .ghost')).toHaveCount(2);

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export' }).click();
  const map = JSON.parse(readFileSync(await (await download).path(), 'utf8')) as MapFile;
  const valid = validateMapFile(map);
  expect(valid.ok ? [] : valid.issues).toEqual([]);
  expect(map.buildings).toEqual([{ id: 'hostel', name: 'Hostel' }]);
  expect(map.levels.map((l) => [l.id, l.building ?? null])).toEqual([
    ['G', null],
    ['1', 'hostel'],
  ]);
  expect(map.levels[0]?.shapes?.map((s) => s.kind)).toEqual(['road', 'building']);
});

test('Load campus: the Demo College opens with its buildings and floors', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Load campus' }).click();
  await expect(page.getByRole('tab')).toHaveText([
    'Ground',
    'Block A · Floor 1',
    'Block A · Floor 2',
    'Library · Floor 1',
  ]);
  await expect(page.getByText('No problems found.')).toBeVisible();
});
