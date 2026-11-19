import { expect, test } from '@playwright/test';
import { geometry, map, startCrossing } from './start';
import { fitCamera, hexToPixel, zoomAt } from '../src/renderer/geometry';

test('Переправа: preview a Rust route, move the counter and pass the phase', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', res => { if (res.status() >= 400) errors.push(res.url()); });
  await startCrossing(page);
  const canvas=page.getByLabel('Гексагональная карта, 8 на 5 клеток');
  await expect(page.getByRole('heading',{name:'Переправа'})).toBeVisible();
  await expect(page.locator('.counter-row')).toHaveCount(6);
  await expect(page.locator('.turn')).toContainText('Синие');
  const box=await canvas.boundingBox();
  if (!box) throw new Error('Missing map');
  const camera=fitCamera(box.width,box.height,8,5);
  const p=hexToPixel({q:3,r:2});
  const position={x:camera.x+p.x*camera.scale,y:camera.y+p.y*camera.scale};
  await page.getByRole('button',{name:'Маршрут',exact:true}).click();
  await canvas.click({position});
  await expect(page.locator('.order .location')).toContainText('(1, 2)');
  await expect(page.getByRole('button',{name:'Переместить в (3, 2)'})).toBeVisible();
  await expect(page.locator('.itinerary')).toContainText('(1, 2) → (2, 2) → (3, 2)');
  await expect(page.locator('.itinerary')).toContainText('Стоимость: 2 ОД');
  await page.getByRole('button',{name:'Отмена',exact:true}).click();
  await canvas.click({position});
  await expect(page.locator('.itinerary strong')).toHaveText('Пройденный путь');
  await expect(page.getByRole('status')).toContainText('заняла клетку (3, 2)');
  await expect(page.locator('.counter-row[aria-pressed=true]')).toContainText('(3, 2)');
  await expect(page.locator('.order dd').last()).toHaveText('95');
  await page.getByRole('button',{name:'Завершить фазу'}).click();
  await expect(page.locator('.turn')).toContainText('Красные');
  expect(errors).toEqual([]);
});

test('panning does not move the unit; a click on a small destination does',async({page})=>{
  await startCrossing(page);
  const canvas=map(page);
  await canvas.scrollIntoViewIfNeeded();
  const {box,camera,mid}=await geometry(page);
  const destination=hexToPixel({q:3,r:2});
  const startX=box.x+camera.x+destination.x*camera.scale;
  const startY=box.y+camera.y+destination.y*camera.scale;
  await page.mouse.move(startX,startY);
  await page.mouse.down();
  await page.mouse.move(startX+18,startY,{steps:4});
  await page.mouse.up();
  await expect(page.locator('.order .location')).toContainText('(1, 2)');
  await expect(page.locator('.itinerary')).toHaveCount(0);

  const smaller=page.getByRole('button',{name:'Уменьшить масштаб'});
  for(let i=0;i<3;i++) await smaller.click();
  const zoomed=zoomAt({...camera,x:camera.x+18},mid,.8**3);
  await canvas.click({position:{x:zoomed.x+destination.x*zoomed.scale,y:zoomed.y+destination.y*zoomed.scale}});
  await expect(page.locator('.order .location')).toContainText('(3, 2)');
  await expect(page.locator('.itinerary strong')).toHaveText('Пройденный путь');
  await expect(page.getByRole('button',{name:/Переместить в/})).toHaveCount(0);
});
