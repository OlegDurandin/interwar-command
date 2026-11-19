import { expect, test } from '@playwright/test';
import { geometry, map, startCrossing } from './start';
import { hexToPixel } from '../src/renderer/geometry';

for (const portrait of [false,true]) {
  const device=portrait?'portrait':'desktop';
  test.describe(device,()=>{
    test.use({viewport:portrait ? {width:390,height:844} : {width:1440,height:900},hasTouch:portrait,isMobile:portrait});
    test('select infantry on the open ground of its hex and inspect the crossing',async({page},info)=>{
      test.setTimeout(90_000);
      await startCrossing(page,'blue');
      const canvas=map(page);
      await expect(canvas).toHaveAttribute('data-unit-style','miniatures');
      await expect(canvas).toHaveAttribute('data-terrain-style','illustrated');
      await expect(page.locator('.save-status')).toHaveText('Сохранено');
      async function choose(q:number,r:number,dx=0,dy=0) {
        const {box,camera}=await geometry(page);
        const p=hexToPixel({q,r});
        const x=box.x+camera.x+(p.x+dx)*camera.scale, y=box.y+camera.y+(p.y+dy)*camera.scale;
        if(portrait) await page.touchscreen.tap(x,y);else await page.mouse.click(x,y);
      }
      // Select a different piece first so the full-hex hit test has an observable outcome.
      await choose(2,1);
      await expect(page.locator('.order h2')).toHaveText('Кавалерия');
      await choose(1,2,-19,7);
      await expect(page.locator('.order h2')).toHaveText('Пехота');
      await expect(page.locator('.order .location')).toContainText('(1, 2)');
      await page.screenshot({path:info.outputPath(device+'.png')});
      const graphics=await page.evaluate(()=>performance.getEntriesByType('resource')
        .filter((r):r is PerformanceResourceTiming=>r instanceof PerformanceResourceTiming && /\.(?:png|webp|avif)(?:\?|$)/.test(r.name))
        .map(r=>({url:new URL(r.name).pathname,bytes:r.encodedBodySize})));
      expect(graphics.filter(r=>r.url.includes('interwar-miniatures'))).toHaveLength(1);
      expect(graphics.find(r=>r.url.includes('interwar-miniatures'))?.bytes).toBeGreaterThan(0);
      expect(graphics.filter(r=>r.url.includes('countryside'))).toHaveLength(1);
      expect(graphics.find(r=>r.url.includes('countryside'))?.bytes).toBeGreaterThan(0);
      console.log(device,'map graphics',JSON.stringify(graphics));
      if (!portrait) {
        const more=page.getByRole('button',{name:'Увеличить масштаб'});
        const less=page.getByRole('button',{name:'Уменьшить масштаб'});
        for (let i=0;i<3;i++) await more.click();
        await canvas.screenshot({path:info.outputPath('detail.png')});
        for (let i=0;i<3;i++) await less.click();
      }
      await choose(4,2);
      await expect(page.locator('.itinerary')).toContainText('(3, 2)');
      await expect(page.getByRole('status')).toContainText('заняла клетку (4, 2)');
      await choose(5,2);
      const preview=page.getByRole('region',{name:'Предпросмотр боя'});
      await expect(preview).toContainText('Пехота (5, 2)');
      if (portrait) await page.setViewportSize({width:844,height:390});
      await expect(preview.getByRole('button',{name:'Атаковать',exact:true})).toBeInViewport();
      if (portrait) await page.screenshot({path:info.outputPath('rotated.png')});
      await preview.getByRole('button',{name:'Отмена'}).click();
      if (portrait) await page.getByRole('button',{name:'Слои',exact:true}).click();
      const supply=page.getByRole('checkbox',{name:/Прогноз снабжения/});
      const before=await canvas.screenshot();
      await supply.check();
      await expect.poll(async()=>before.equals(await canvas.screenshot())).toBe(false);
      const less=page.getByRole('button',{name:'Уменьшить масштаб'});
      for(let i=0;i<5;i++) await less.click();
      await expect(canvas).toHaveAttribute('data-unit-style','compact');
      const more=page.getByRole('button',{name:'Увеличить масштаб'});
      for(let i=0;i<5;i++) await more.click();
      await expect(canvas).toHaveAttribute('data-unit-style','miniatures');
    });
  });
}
