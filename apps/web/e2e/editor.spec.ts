import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { clickCell, geometry, map, startCrossing } from './start';
import { hexToPixel } from '../src/renderer/geometry';
import type { Document } from '../src/editor/document';

async function saveSlots(page:Page) {
  return page.evaluate(async()=> {
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{
      const req=indexedDB.open('interwar-command');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
    });
    try {
      const tx=db.transaction('games','readonly');
      const all=tx.objectStore('games').getAll();
      return await new Promise<string[]>((resolve,reject)=>{tx.oncomplete=()=>resolve(all.result);tx.onabort=()=>reject(tx.error);});
    } finally {db.close();}
  });
}

test('edit a bridge and a starting position, round-trip the file and playtest without changing either player slot',async({page})=>{
  test.setTimeout(100_000);
  await startCrossing(page);
  await page.getByRole('button',{name:'Сохранить позицию'}).click();
  await expect(page.locator('.save-status')).toHaveText('Сохранено');
  await page.getByRole('button',{name:/Окопаться/}).click();
  await expect(page.locator('.save-status')).toHaveText('Сохранено');
  const saved=await saveSlots(page);
  expect(saved).toHaveLength(2);expect(saved[0]).not.toBe(saved[1]);
  await page.getByRole('button',{name:'В меню'}).click();
  await page.getByRole('link',{name:'Редактор сценариев'}).click();
  const button=(name:string)=>page.getByRole('button',{name,exact:true});
  await button('Копия «Переправы»').click();
  await clickCell(page,3,2);
  await button('Ребро').click();
  await clickCell(page,4,2);
  await expect(page.getByLabel('Мост',{exact:true})).toBeChecked();
  await page.getByLabel('Мост',{exact:true}).uncheck();
  await button('Применить к ребру').click();
  await button('Часть').click();
  const unit=page.getByLabel('Редактируемая часть');
  await unit.selectOption('west_inf');
  await clickCell(page,2,2);
  await button('Разместить в (2, 2)').click();
  await expect(unit.locator('option:checked')).toContainText('(2, 2)');
  await button('Отменить').click();
  await expect(unit.locator('option:checked')).toContainText('(1, 2)');
  await button('Повторить').click();
  await expect(unit.locator('option:checked')).toContainText('(2, 2)');
  async function exportFile() {
    const pending=page.waitForEvent('download');await button('Экспорт JSON').click();
    const path=await (await pending).path();expect(path).toBeTruthy();return readFile(path!,'utf8');
  }
  const json=await exportFile(), doc=JSON.parse(json) as Document;
  expect(doc.units.find(u=>u.id==='west_inf')).toMatchObject({q:2,r:2});
  expect(doc.map.edges.find(e=>e.a.join()==='3,2' && e.b.join()==='4,2')).toMatchObject({bridge:false,river:true});
  const file=page.locator('input[type=file]');
  await button('Копия «Переправы»').click();
  await file.setInputFiles({name:'copy.json',mimeType:'application/json',buffer:Buffer.from(json)});
  await expect(page.getByRole('status')).toContainText('copy.json');
  await file.setInputFiles({name:'bad.json',mimeType:'application/json',
    buffer:Buffer.from(JSON.stringify({...doc,units:[{...doc.units[0],q:999},...doc.units.slice(1)]}))});
  await expect(page.getByRole('alert')).toContainText('units[0].q');
  await button('Тестовая партия').click();
  await expect(page.locator('.order .location')).toContainText('(2, 2)');
  await clickCell(page,3,2);
  await expect(page.locator('.order .location')).toContainText('(3, 2)');
  await button('Вернуться в редактор').click();
  expect(JSON.parse(await exportFile())).toEqual(doc);
  expect(await saveSlots(page)).toEqual(saved);
  await page.getByRole('link',{name:'В меню'}).click();
  await button('Продолжить партию').click();
  await expect(page.locator('.dispatches')).toContainText('окопы 1');
  await expect(page.locator('.order .location')).toContainText('(1, 2)');
});

// Read the rendered crossing at each edge midpoint, independently of the editor checkbox.
async function visibleBridges(page:Page) {
  const {camera,box}=await geometry(page);
  const png=(await map(page).screenshot()).toString('base64');
  return page.evaluate(async({png,width,camera,centers})=>{
    const image=new Image();image.src='data:image/png;base64,'+png;await image.decode();
    const surface=document.createElement('canvas');surface.width=image.width;surface.height=image.height;
    const ctx=surface.getContext('2d')!;
    ctx.drawImage(image,0,0);
    const data=ctx.getImageData(0,0,image.width,image.height).data, ratio=image.width/width;
    return centers.map(p=>{
      // The middle of these two river edges contains either warm decking or open blue water.
      let wood=0,water=0;
      for(const across of [-1.5,0,1.5]) for(const along of [-1.5,0,1.5]) {
        const x=Math.floor((camera.x+(p.x+along)*camera.scale)*ratio);
        const y=Math.floor((camera.y+(p.y+across)*camera.scale)*ratio);
        const i=4*(y*image.width+x);
        const [red,green,blue]=[data[i]!,data[i+1]!,data[i+2]!];
        if(red-green>15 && green-blue>15) wood++;
        if(green-red>10 && blue-red>10) water++;
      }
      return wood>=6 ? 'deck' : water>=6 ? 'water' : 'unknown';
    });
  },{png,width:box.width,camera,centers:[2,1].map(r=>hexToPixel({q:3.5,r}))});
}

test('moving a bridge changes the crossing visible in both the atlas and the playtest',async({page})=>{
  test.setTimeout(90_000);
  await page.goto('/?editor');
  const button=(name:string)=>page.getByRole('button',{name,exact:true});
  await map(page).waitFor({state:'visible'});
  await expect(map(page)).toHaveAttribute('data-unit-style','miniatures');
  await expect(map(page)).toHaveAttribute('data-terrain-style','illustrated');
  await expect.poll(()=>visibleBridges(page)).toEqual(['deck','water']);
  for(const [r,add] of [[2,false],[1,true]] as const) {
    await button('Клетка').click();await clickCell(page,3,r);
    await button('Ребро').click();await clickCell(page,4,r);
    await page.getByLabel('Мост',{exact:true}).setChecked(add);
    await button('Применить к ребру').click();
  }
  await button('Клетка').click();await clickCell(page,0,0);
  await expect.poll(()=>visibleBridges(page)).toEqual(['water','deck']);
  await button('Тестовая партия').click();
  await map(page).waitFor({state:'visible'});
  await expect(map(page)).toHaveAttribute('data-unit-style','miniatures');
  await expect(map(page)).toHaveAttribute('data-terrain-style','illustrated');
  await clickCell(page,0,0);
  await expect.poll(()=>visibleBridges(page)).toEqual(['water','deck']);
});

test('create a blank map, keep invalid drafts editable, fill terrain and place sources and a goal',async({page})=>{
  await page.goto('/?editor');
  const button=(name:string)=>page.getByRole('button',{name,exact:true});
  await button('Новая карта').click();await button('Создать карту').click();
  await button('Проверить').click();await expect(page.getByRole('alert')).toBeVisible();
  await button('Заливка').click();await clickCell(page,3,2);
  await button('Клетка').click();await clickCell(page,7,4);
  await expect(page.getByLabel('Местность')).toHaveValue('forest');
  await page.getByLabel('Контроль').selectOption('red');await page.getByLabel('Источник снабжения').check();
  await page.getByLabel('Город · ID').fill('east');await button('Применить к клетке').click();
  await clickCell(page,0,0);await page.getByLabel('Контроль').selectOption('blue');
  await page.getByLabel('Источник снабжения').check();await button('Применить к клетке').click();
  await button('Цель').click();await button('Сохранить цель').click();
  await button('Сценарий').click();
  await page.getByLabel('Стартовая сторона').selectOption('red');
  await page.getByLabel('ID стороны 2').fill('east');
  await page.getByLabel('Лимит раундов').fill('3');await button('Применить настройки').click();
  await button('Проверить').click();await expect(page.getByRole('status')).toContainText('прошёл проверку');
});
