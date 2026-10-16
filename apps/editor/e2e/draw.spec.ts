import { readFileSync } from 'node:fs';
import { buildDirections, findRoute, loadSite } from '@innermap/core';
import { validateMapFile } from '@innermap/schema/validate';
import type { MapFile } from '@innermap/schema';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { clickAt, tool } from './helpers';

/** Select the dot at (x, y) and give it a landmark name (and optionally a kind). */
async function nameDot(page: Page, x: number, y: number, landmark: string, kind?: string) {
  await tool(page, 'Select / move');
  await clickAt(page, x, y);
  const field = page.getByLabel('Landmark people can see');
  await field.fill(landmark);
  await field.press('Tab');
  if (kind) await page.getByLabel('Kind').selectOption({ label: kind });
}

async function nameRoom(page: Page, name: string, number: string, category: string) {
  await page.getByRole('textbox', { name: 'Name' }).first().fill(name);
  await page.getByRole('textbox', { name: 'Name' }).first().press('Tab');
  await page.getByLabel('Number on the door').fill(number);
  await page.getByLabel('Number on the door').press('Tab');
  await page.getByLabel('Category').selectOption(category);
}

test('draw a two-floor clinic with the tools and export a valid, routable map', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New' }).click();
  await page.getByRole('button', { name: '+ Floor' }).click();
  await page.getByRole('tab', { name: /Ground/ }).click();

  // Ground floor: a corridor with three clicks.
  await tool(page, 'Path');
  await clickAt(page, 5, 10);
  await clickAt(page, 30, 10);
  await clickAt(page, 50, 10);
  await page.keyboard.press('Escape');

  // A door below the corridor — it joins the corridor by itself.
  await tool(page, 'Door');
  await clickAt(page, 20, 14);
  await page.getByLabel('Landmark people can see').fill('Pharmacy');
  await page.getByLabel('Landmark people can see').press('Tab');

  // Make it a room.
  await tool(page, 'Room');
  await clickAt(page, 20, 14);
  await nameRoom(page, 'Pharmacy', 'G1', 'pharmacy');

  // A lift on both floors, joined to the corridor end with the Path tool.
  await tool(page, 'Lift');
  await clickAt(page, 50, 16);
  await expect(page.getByRole('heading', { name: /Lift/ })).toBeVisible();
  await tool(page, 'Path');
  await clickAt(page, 50, 16);
  await clickAt(page, 50, 10);
  await page.keyboard.press('Escape');

  await nameDot(page, 5, 10, 'Main Entrance', 'Entrance');
  await nameDot(page, 30, 10, 'Reception desk (blue board)');
  await nameDot(page, 50, 10, 'Lift lobby');

  // Floor 1: from the lift to Radiology.
  await page.getByRole('tab', { name: /Floor 1/ }).click();
  await tool(page, 'Path');
  await clickAt(page, 50, 16);
  await clickAt(page, 50, 10);
  await clickAt(page, 20, 10);
  await page.keyboard.press('Escape');
  await tool(page, 'Door');
  await clickAt(page, 20, 6);
  await page.getByLabel('Landmark people can see').fill('Radiology');
  await page.getByLabel('Landmark people can see').press('Tab');
  await tool(page, 'Room');
  await clickAt(page, 20, 6);
  await nameRoom(page, 'Radiology', '101', 'diagnostics');
  await nameDot(page, 50, 10, 'Floor 1 lift lobby');
  await nameDot(page, 20, 10, 'Radiology waiting area');

  // Undo / redo still work after all that.
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+y');

  // No errors in the live checks.
  await expect(page.locator('.side h2', { hasText: 'Checks' })).not.toContainText(
    /[1-9]\d* errors/,
  );

  // Export and inspect the file.
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export' }).click();
  const path = await (await download).path();
  const map = JSON.parse(readFileSync(path, 'utf8')) as MapFile;
  expect(map.levels).toHaveLength(2);
  expect(map.rooms.map((r) => r.name).sort()).toEqual(['Pharmacy', 'Radiology']);
  expect(map.connectors).toEqual([expect.objectContaining({ kind: 'lift' })]);
  expect(Object.keys(map.connectors[0]?.stops ?? {}).sort()).toEqual(['1', 'G']);
  expect(map.nodes.find((n) => n.landmark === 'Main Entrance')?.kind).toBe('entrance');
  // Ground: 3 corridor + 1 split for the door + door + lift stop; Floor 1: 2 + door + lift stop.
  expect(map.nodes.filter((n) => n.lvl === 'G')).toHaveLength(6);
  expect(map.nodes.filter((n) => n.lvl === '1')).toHaveLength(4);

  // The exported map routes from the entrance to Radiology on the other floor —
  // checked with the same packages the visitor app uses.
  const valid = validateMapFile(map);
  expect(valid.ok ? [] : valid.issues).toEqual([]);
  if (!valid.ok) return;
  const site = loadSite(valid.map);
  const entrance = valid.map.nodes.find((n) => n.landmark === 'Main Entrance')?.id ?? '';
  const radiology = valid.map.rooms.find((r) => r.name === 'Radiology')?.id ?? '';
  const route = findRoute(site, { from: entrance, to: { type: 'room', roomId: radiology } });
  expect(route.ok).toBe(true);
  if (!route.ok) return;
  expect(buildDirections(site, route.value).map((step) => step.text)).toEqual([
    'Walk past Reception desk (blue board) to Lift lobby.',
    'Turn RIGHT and walk to Lift A.',
    'Take Lift A up to Floor 1.',
    'Exit Lift A, then go straight to Floor 1 lift lobby.',
    'Turn LEFT and walk to Radiology waiting area.',
    'Radiology is on your RIGHT 🎉',
  ]);

  // 📱 Open on phone: publish to the visitor dev server and open the link like a phone would.
  await page.getByRole('button', { name: '📱 Open on phone' }).click();
  const link = page.getByRole('dialog', { name: 'Open on phone' }).getByRole('link');
  await expect(link).toBeVisible();
  const url = (await link.getAttribute('href')) ?? '';
  expect(url).toContain('site=my-site');
  const phone = await page.context().newPage();
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.goto(url);
  await phone.getByRole('button', { name: 'Main Entrance' }).click();
  await phone.getByRole('button', { name: /Radiology/ }).click();
  await phone.getByRole('button', { name: 'Start' }).click();
  await expect(phone.locator('.step-text')).toHaveText(
    'Walk past Reception desk (blue board) to Lift lobby.',
  );
});
