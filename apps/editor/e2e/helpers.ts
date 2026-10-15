import type { Page } from '@playwright/test';

/** Screen position of a map point (meters) on the canvas, from the canvas transform. */
export async function screen(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ([wx, wy]) => {
      const svg = document.querySelector('.canvas svg');
      const g = svg?.querySelector(':scope > g');
      const m = /translate\(([-\d.e]+) ([-\d.e]+)\) scale\(([-\d.e]+)\)/.exec(
        g?.getAttribute('transform') ?? '',
      );
      const rect = svg?.getBoundingClientRect();
      if (!m || !rect) throw new Error('canvas not ready');
      const [tx, ty, s] = [Number(m[1]), Number(m[2]), Number(m[3])];
      return { x: rect.left + tx + wx * s, y: rect.top + ty + wy * s };
    },
    [x, y] as const,
  );
}

export async function clickAt(page: Page, x: number, y: number): Promise<void> {
  const p = await screen(page, x, y);
  await page.mouse.click(p.x, p.y);
}

/** Press at one map point and release at another (drag). */
export async function dragFrom(page: Page, from: [number, number], to: [number, number]) {
  const a = await screen(page, ...from);
  const b = await screen(page, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
}

export async function tool(page: Page, name: string): Promise<void> {
  // Tool buttons are named by their label; the emoji is hidden from screen readers.
  const toolbar = page.getByRole('navigation', { name: 'Tools' });
  await toolbar.getByRole('button', { name, exact: true }).click();
}
