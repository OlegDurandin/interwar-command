import { expect, test, type Locator } from '@playwright/test';
import { hexToPixel, radius, zoomAt, type Camera } from '../src/renderer/geometry';
import { geometry, map, startCrossing, tapHex } from './start';

test.use({ viewport: {width:390,height:844}, isMobile:true, hasTouch:true });

async function reachableControl(control:Locator) {
  await expect(control).toBeInViewport({ratio:1});
  expect(await control.evaluate(el=>{
    const r=el.getBoundingClientRect();
    return r.width>=44 && r.height>=44 && el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));
  })).toBe(true);
}

test('a touch order survives rotation and the attack can be cancelled and confirmed',async({page},info)=>{
  test.setTimeout(60_000);
  await startCrossing(page,'blue');
  await tapHex(page,1,2);
  await page.screenshot({path:info.outputPath('command-room-mobile.png')});
  await tapHex(page,4,2);
  await expect(page.getByRole('status')).toContainText('заняла клетку (4, 2)');
  await tapHex(page,5,2);
  const preview=page.getByRole('region',{name:'Предпросмотр боя'});
  await expect(preview).toContainText('Пехота (5, 2)');
  const cancel=preview.getByRole('button',{name:'Отмена'});
  const attack=preview.getByRole('button',{name:'Атаковать'});
  await reachableControl(cancel);
  await reachableControl(attack);
  const phase=page.getByRole('button',{name:'Завершить фазу'});
  await reachableControl(phase);
  await page.setViewportSize({width:844,height:390});
  await expect(preview).toContainText('Пехота (5, 2)');
  await reachableControl(attack);
  await reachableControl(phase);
  await page.screenshot({path:info.outputPath('command-room-landscape.png')});
  await cancel.tap();
  await expect(preview).toHaveCount(0);
  await tapHex(page,5,2);
  await attack.tap();
  await expect(page.getByRole('status')).toContainText('Бой завершён');
  await phase.tap();
  await expect(page.locator('.turn')).toContainText('Раунд 2');
  await expect(page.locator('.turn')).toContainText('Синие');
  await page.setViewportSize({width:320,height:568});
  const tabs=page.getByRole('navigation',{name:'Панели карты'});
  for(const name of ['Части','Слои','Сводка','Запись','Приказ']) {
    const tab=tabs.getByRole('button',{name,exact:true});
    await reachableControl(tab);
    await tab.tap();
    await expect(tab).toHaveAttribute('aria-pressed','true');
  }
  await reachableControl(phase);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(320);
});

test('double tapping the selected unit centers the camera without spending its move',async({page})=>{
  await startCrossing(page);
  const {box,camera,mid}=await geometry(page);
  const p=hexToPixel({q:1,r:2});
  const x=box.x+camera.x+camera.scale*p.x,y=box.y+camera.y+camera.scale*p.y;
  const before=await map(page).screenshot();
  await page.touchscreen.tap(x,y);
  await page.touchscreen.tap(x,y);
  await expect.poll(async()=>before.equals(await map(page).screenshot())).toBe(false);
  await expect(page.locator('.order .location')).toContainText('(1, 2)');
  const destination=hexToPixel({q:3,r:2});
  const scale=zoomAt(camera,mid,1.35).scale;
  await page.touchscreen.tap(box.x+mid.x+(destination.x-p.x)*scale,box.y+mid.y+(destination.y-p.y)*scale);
  await expect(page.getByRole('status')).toContainText('заняла клетку (3, 2)');
  await expect(page.locator('.order dd').last()).toHaveText('95');
});

test('touchscreen route inspection can change destination, cancel or confirm without a keyboard',async({page})=>{
  test.setTimeout(60_000);
  await startCrossing(page,'blue');
  await tapHex(page,1,2);
  const inspect=page.getByRole('button',{name:'Маршрут',exact:true});
  await reachableControl(inspect);
  await inspect.tap();
  await expect(inspect).toHaveAttribute('aria-pressed','true');
  await tapHex(page,3,2);
  await expect(page.locator('.itinerary')).toContainText('(1, 2) → (2, 2) → (3, 2)');
  await tapHex(page,4,2);
  await expect(page.locator('.itinerary')).toContainText('(4, 2)');
  await expect(page.locator('.order .location')).toContainText('(1, 2)');
  const cancel=page.getByRole('button',{name:'Отмена',exact:true});
  await reachableControl(cancel);
  await cancel.tap();
  await expect(inspect).toHaveAttribute('aria-pressed','false');
  await expect(page.locator('.itinerary')).toHaveCount(0);
  await inspect.tap();
  await tapHex(page,4,2);
  const commit=page.getByRole('button',{name:'Переместить в (4, 2)'});
  await reachableControl(commit);
  await commit.tap();
  await expect(page.locator('.order .location')).toContainText('(4, 2)');
  await expect(page.locator('.order dd').last()).toHaveText('95');
});

for (const scenario of ['initial zoom','reduced zoom','editor playtest at reduced zoom']) {
  test(`${scenario}: one destination tap moves infantry exactly once and leaves attack pending`,async({page})=>{
    const small=scenario!=='initial zoom';
    if (scenario==='editor playtest at reduced zoom') {
      await page.setViewportSize({width:1280,height:840});
      await page.goto('/?editor');
      await page.getByRole('button',{name:'Тестовая партия',exact:true}).click();
      await expect(page.getByRole('button',{name:'Вернуться в редактор'})).toBeVisible();
      await page.setViewportSize({width:390,height:844});
    } else {
      await startCrossing(page,'blue');
    }
    if (small) {
      await page.getByRole('button',{name:'Слои',exact:true}).tap();
      const less=page.getByRole('button',{name:'Уменьшить масштаб'});
      await less.tap();
      await less.tap();
      await page.getByRole('button',{name:'Приказ',exact:true}).tap();
    }
    const {camera,mid}=await geometry(page);
    const zoom=(fit:Camera)=>small ? zoomAt(fit,mid,.8**2) : fit;
    const width=Math.sqrt(3)*radius*zoom(camera).scale;
    if (small) expect(width).toBeLessThan(44);
    else expect(width).toBeGreaterThan(44);

    // Switch from cavalry in route inspection to infantry in ordinary movement.
    await tapHex(page,2,1,zoom);
    await expect(page.locator('.order h2')).toHaveText('Кавалерия');
    const inspect=page.getByRole('button',{name:'Маршрут',exact:true});
    await inspect.tap();
    await tapHex(page,1,2,zoom);
    await expect(page.locator('.order h2')).toHaveText('Пехота');
    await expect(inspect).toHaveAttribute('aria-pressed','false');

    const moves=page.locator('.dispatches li').filter({hasText:' → '});
    const attacks=page.locator('.dispatches li').filter({hasText:'Бой · потери'});
    await expect(moves).toHaveCount(0);
    await tapHex(page,4,2,zoom);
    await expect(page.locator('.order .location')).toContainText('(4, 2)');
    await expect(page.getByRole('button',{name:/Переместить в/})).toHaveCount(0);
    await expect(moves).toHaveCount(1);
    await expect(moves).toHaveText('Пехота → (4, 2)');
    await tapHex(page,5,2,zoom);
    await expect(page.getByRole('region',{name:'Предпросмотр боя'})).toContainText('Пехота (5, 2)');
    await expect(page.locator('.counter-row[aria-pressed=true]')).toContainText('(4, 2)');
    await expect(moves).toHaveCount(1);
    await expect(attacks).toHaveCount(0);
  });
}
