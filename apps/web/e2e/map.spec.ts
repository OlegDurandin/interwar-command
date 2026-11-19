import { expect, test } from '@playwright/test';
import { fitCamera, hexToPixel } from '../src/renderer/geometry';

test('production map loads Rust, selects cells and follows camera changes', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('requestfailed', req => errors.push(req.url()));
  page.on('response', res => { if (res.status() >= 400) errors.push(`${res.status()} ${res.url()}`); });
  const wasmResponse = page.waitForResponse(res => new URL(res.url()).pathname.endsWith('.wasm'));
  await page.goto('/?demo');
  const wasm = await wasmResponse;
  expect(wasm.ok()).toBe(true);
  expect([...((await wasm.body()).subarray(0, 4))]).toEqual([0, 97, 115, 109]);
  await expect(page.getByRole('status')).toHaveText('Карта готова');

  const canvas = page.locator('canvas');
  await expect(canvas).toHaveCount(1);
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas is missing');
  const camera = fitCamera(box.width, box.height);
  const position = (q: number, r: number) => {
    const p = hexToPixel({ q, r });
    return { x: box.x + camera.x + p.x * camera.scale, y: box.y + camera.y + p.y * camera.scale };
  };
  const coords = page.getByTestId('coordinates');
  const distance = page.getByTestId('distance');
  const start = position(2, 3);
  const before = await canvas.screenshot();
  await page.mouse.click(start.x, start.y);
  await expect(coords).toHaveText('(2, 3)');
  await expect(distance).toHaveText('5');
  expect((await canvas.screenshot()).equals(before)).toBe(false);

  const anchor = position(4, 4);
  await page.mouse.move(anchor.x, anchor.y);
  await page.mouse.down();
  const dx = 64;
  const dy = -36;
  await page.mouse.move(anchor.x + dx, anchor.y + dy, { steps: 5 });
  await page.mouse.up();
  await expect(coords).toHaveText('(2, 3)');
  // Doubling the scale about this anchor moves a distant cell to a different screen hex.
  const delta = -462;
  const factor = Math.exp(-delta * 0.0015);
  await page.mouse.wheel(0, delta);
  await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  const target = position(6, 3);
  const x = anchor.x + dx + (target.x - anchor.x) * factor;
  const y = anchor.y + dy + (target.y - anchor.y) * factor;
  await page.mouse.click(x, y);
  await expect(coords).toHaveText('(6, 3)');
  await expect(distance).toHaveText('9');

  await page.setViewportSize({ width: 1100, height: 750 });
  await expect.poll(async () => (await canvas.boundingBox())?.width).toBeLessThan(box.width);
  const resized = await canvas.boundingBox();
  if (!resized) throw new Error('Canvas disappeared after resize');
  const shiftX = resized.x - box.x + (resized.width - box.width) / 2;
  const shiftY = resized.y - box.y + (resized.height - box.height) / 2;
  await page.mouse.click(anchor.x + dx + shiftX, anchor.y + dy + shiftY);
  await expect(coords).toHaveText('(4, 4)');
  await expect(distance).toHaveText('8');
  expect(errors).toEqual([]);
});

test('unavailable WASM produces a visible error', async ({ page }) => {
  await page.route('**/*.wasm', route => route.abort());
  await page.goto('/?demo');
  await expect(page.getByRole('alert')).toContainText('Не удалось загрузить ядро WebAssembly');
  await expect(page.locator('canvas')).toHaveCount(0);
  await expect(page.getByTestId('distance')).toHaveText('—');
});
