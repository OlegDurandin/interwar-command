import { expect,test } from '@playwright/test';
import { fitCamera,hexToPixel,zoomAt } from '../src/renderer/geometry';

import { startCrossing } from './start';

test('tapping an enemy immediately after the destination previews combat for the moved infantry',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await startCrossing(page);
  const canvas=page.getByLabel('Гексагональная карта, 8 на 5 клеток');
  await canvas.scrollIntoViewIfNeeded();
  const box=await canvas.boundingBox();
  if(!box) throw new Error('Missing scenario canvas');
  const camera=zoomAt(fitCamera(box.width,box.height,8,5),{x:box.width/2,y:box.height/2},1.65);
  const p=hexToPixel({q:4,r:2});
  const enemy=hexToPixel({q:5,r:2});
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:box.x+camera.x+p.x*camera.scale,y:box.y+camera.y+p.y*camera.scale}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:box.x+camera.x+enemy.x*camera.scale,y:box.y+camera.y+enemy.y*camera.scale}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect(page.getByRole('region',{name:'Предпросмотр боя'})).toContainText('Пехота (5, 2)');
  await expect(page.locator('.dispatches li').filter({hasText:' → '})).toHaveText(['Пехота → (4, 2)']);
  await cdp.detach();
});

test('pinching across reachable destinations preserves the camera anchor and issues no move',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  await startCrossing(page);
  const canvas=page.locator('canvas');
  await canvas.scrollIntoViewIfNeeded();
  const box=await canvas.boundingBox();
  if(!box) throw new Error('Missing map canvas');
  const fit=fitCamera(box.width,box.height,8,5);
  const camera=zoomAt(fit,{x:box.width/2,y:box.height/2},1.65);
  const target=hexToPixel({q:3,r:2});
  const mid={x:camera.x+target.x*camera.scale,y:camera.y+target.y*camera.scale};
  const pair=(distance:number)=>[-1,1].map((sign,i)=>({id:i+1,x:box.x+mid.x+sign*distance,y:box.y+mid.y}));
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:pair(24)});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:pair(48)});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect(page.locator('.order .location')).toContainText('(1, 2)');
  await expect(page.locator('.dispatches li').filter({hasText:' → '})).toHaveCount(0);
  const zoomed=zoomAt(camera,mid,2);
  const p=hexToPixel({q:4,r:2});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:box.x+zoomed.x+p.x*zoomed.scale,y:box.y+zoomed.y+p.y*zoomed.scale}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect(page.locator('.order .location')).toContainText('(4, 2)');
  await cdp.detach();
});

test('mobile controls respect display insets and interrupted touches cannot issue a move', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  const edges={top:24,right:12,bottom:30,left:12};
  await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets:edges});
  await startCrossing(page);
  const menu=page.getByRole('button',{name:'В меню'});
  const end=page.getByRole('button',{name:'Завершить фазу'});
  for (const control of [menu,end]) {
    const rect=await control.boundingBox();
    if (!rect) throw new Error('Missing mobile control');
    expect(rect.x).toBeGreaterThanOrEqual(edges.left);
    expect(rect.y).toBeGreaterThanOrEqual(edges.top);
    expect(rect.x+rect.width).toBeLessThanOrEqual(390-edges.right);
    expect(rect.y+rect.height).toBeLessThanOrEqual(844-edges.bottom);
  }
  const canvas=page.locator('canvas');
  const box=await canvas.boundingBox();
  if (!box) throw new Error('Missing scenario canvas');
  const mid={x:box.width/2,y:box.height/2};
  const camera=zoomAt(fitCamera(box.width,box.height,8,5),mid,1.65);
  const target=hexToPixel({q:3,r:2});
  const point={id:1,x:box.x+camera.x+target.x*camera.scale,y:box.y+camera.y+target.y*camera.scale};
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
  // Headless Chromium keeps the tab visible. Deliver the lifecycle notifications explicitly.
  await page.evaluate(()=>{
    window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));
    window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));
  });
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect(page.locator('.order .location')).toContainText('(1, 2)');
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
  await expect(page.locator('.order .location')).toContainText('(1, 2)');

  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
  await page.waitForTimeout(650);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect(page.locator('.order .location')).toContainText('(1, 2)');
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
  const shifted={...point,y:point.y+55};
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[shifted]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect(page.locator('.order .location')).toContainText('(1, 2)');
  await expect(page.locator('.dispatches li').filter({hasText:' → '})).toHaveCount(0);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[shifted]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect(page.getByRole('status')).toContainText('заняла клетку (3, 2)');
  await cdp.detach();
});
