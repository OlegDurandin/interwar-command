import { type Page, expect } from '@playwright/test';

import { fitCamera, hexToPixel, zoomAt, type Camera } from '../src/renderer/geometry';

export const map = (page:Page) => page.getByLabel('Гексагональная карта, 8 на 5 клеток');

export async function geometry(page:Page) {
  const box=await map(page).boundingBox();
  if (!box) throw new Error('Map missing');
  const mid={x:box.width/2,y:box.height/2};
  const fit=fitCamera(box.width,box.height,8,5);
  return {box,mid,camera:box.width<480 ? zoomAt(fit,mid,1.65) : fit};
}

export async function tapHex(page:Page,q:number,r:number, transform?:(camera:Camera)=>Camera) {
  const {box,camera}=await geometry(page);
  const c=transform?.(camera) ?? camera;
  const p=hexToPixel({q,r});
  await page.touchscreen.tap(box.x+c.x+c.scale*p.x,box.y+c.y+c.scale*p.y);
}

export async function clickCell(page:Page,q:number,r:number) {
  const canvas=page.getByLabel('Гексагональная карта, 8 на 5 клеток');
  await canvas.scrollIntoViewIfNeeded();
  const box=await canvas.boundingBox();
  if(!box) throw new Error('Missing scenario canvas');
  const camera=fitCamera(box.width,box.height,8,5);
  const p=hexToPixel({q,r});
  await canvas.click({position:{x:camera.x+p.x*camera.scale,y:camera.y+p.y*camera.scale}});
}

// Each AI order is rendered separately. Require progress for every order until control returns.
export async function finishAiPhase(page:Page) {
  const button=page.locator('.phase-controls button');
  const journal=page.locator('.dispatches');
  for(let i=0;i<32 && !await button.isEnabled();i++) {
    const before=await journal.innerText();
    await expect.poll(async()=>await button.isEnabled() || (await journal.innerText())!==before).toBe(true);
  }
  await expect(button).toBeEnabled();
}

export async function startCrossing(page:Page, commander='both') {
  await page.goto('/');
  await page.getByRole('button',{name:'Начать',exact:true}).click();
  await page.getByLabel('Командование').selectOption(commander);
  await page.getByRole('button',{name:'Начать операцию'}).click();
  await expect(page.locator('.counter-row')).toHaveCount(6);
  page.on('dialog',dialog=>void dialog.accept());
}
