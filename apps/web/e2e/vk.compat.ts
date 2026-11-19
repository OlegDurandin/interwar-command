import { expect, test, type Page } from '@playwright/test';
import { tapHex } from './start';

interface Request { request_id:string; history?:boolean }
interface NativeFixture { calls:string[]; swipes:boolean[]; event:(type:string,data?:object)=>void }
type FixtureWindow = typeof window & { vkFixture:NativeFixture };

async function nativeClient(page:Page, client:'ios'|'android', enhancements:boolean) {
  // Install only the host transport. The production bundle supplies the real @vkontakte/vk-bridge.
  await page.addInitScript(({client,enhancements})=>{
    const calls:string[]=[], swipes:boolean[]=[];
    function event(type:string,data:object={}) {
      window.dispatchEvent(new CustomEvent('VKWebAppEvent',{detail:{type,data}}));
    }
    function respond(name:string, request:Request) {
      calls.push(name);
      let data:object={result:true};
      if (name==='VKWebAppInit') {
        event('VKWebAppUpdateInsets',{insets:{top:18,bottom:10,left:0,right:0}});
      } else if (name==='VKWebAppGetConfig') {
        data={app:'vkclient',insets:{top:0,bottom:0,left:0,right:0}};
      } else if (name==='VKWebAppSetSwipeSettings') {
        swipes.push(request.history===true);
      }
      event(name+'Result',{...data,request_id:request.request_id});
    }
    const methods=['VKWebAppInit',...(enhancements ? ['VKWebAppGetConfig','VKWebAppSetSwipeSettings'] : [])];
    Object.assign(window,{vkFixture:{calls,swipes,event}});
    if (client==='android') {
      Object.assign(window,{AndroidBridge:Object.fromEntries(methods.map(name=>
        [name,(payload:string)=>respond(name, JSON.parse(payload) as Request)]))});
    } else {
      const messageHandlers={VKWebAppClose:{},...Object.fromEntries(methods.map(name=>
        [name,{postMessage:(data:Request)=>respond(name,data)}]))};
      Object.defineProperty(window,'webkit',{configurable:true,value:{messageHandlers}});
    }
  },{client,enhancements});
}

async function snapshot(page:Page) {
  // Read every surviving unit from both sides of the roster, including its axial coordinates.
  const roster=await page.locator('.roster-group').evaluateAll(groups=>groups.map(group=>({
    faction:group.querySelector('h3')?.textContent,
    units:[...group.querySelectorAll('.counter-row')].map(row=>({
      kind:row.querySelector('span')?.textContent, at:row.querySelector('small')?.textContent?.match(/\(-?\d+, -?\d+\)$/)?.[0],
    })),
  })));
  return {round:await page.locator('.turn span').innerText(),
    faction:await page.locator('.turn strong').innerText(), roster};
}

test.use({viewport:{width:390,height:844},isMobile:true,hasTouch:true});

test('VK game orders, AI phase and confirmed IndexedDB round trip', async ({page,browserName},info)=>{
  test.setTimeout(90_000);
  await nativeClient(page,browserName==='webkit'?'ios':'android',true);
  const errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',d=>void d.accept());
  await page.goto('/?vk_app_id=123&vk_platform='+ (browserName==='webkit'?'mobile_iphone':'mobile_android'));
  await expect(page.locator('html')).toHaveAttribute('data-platform','vk');
  await page.getByRole('button',{name:'Начать',exact:true}).tap();
  await page.getByLabel('Командование').selectOption('blue');
  await page.getByRole('button',{name:'Начать операцию'}).tap();
  await expect(page.locator('.order .location')).toContainText('(1, 2)');
  await expect(page.locator('.operation')).toHaveCSS('padding-top','18px');
  await expect.poll(()=>page.evaluate(()=>(window as FixtureWindow).vkFixture.swipes.at(-1))).toBe(false);

  await tapHex(page,1,2);
  await tapHex(page,4,2);
  await expect(page.getByRole('status')).toContainText('заняла клетку (4, 2)');
  await tapHex(page,5,2);
  const preview=page.getByRole('region',{name:'Предпросмотр боя'});
  await expect(preview).toContainText('Пехота (5, 2)');
  await preview.getByRole('button',{name:'Атаковать'}).tap();
  await expect(page.getByRole('status')).toContainText('Бой завершён');
  await page.evaluate(()=>{
    window.addEventListener('click',()=>(window as FixtureWindow).vkFixture.event('VKWebAppViewHide'),{once:true});
  });
  const phase=page.locator('.phase-controls button');
  await phase.tap();
  await expect(page.locator('.turn strong')).toHaveText('Красные');
  const journal=await page.locator('.dispatches').textContent();
  // The foreground AI issues an order every 160 ms.
  await page.waitForTimeout(450);
  expect(await page.locator('.dispatches').textContent()).toBe(journal);
  await page.evaluate(()=>(window as FixtureWindow).vkFixture.event('VKWebAppViewRestore'));
  await expect(page.locator('.turn span')).toHaveText('Раунд 2');
  await expect(page.locator('.turn strong')).toHaveText('Синие');
  await expect(phase).toBeEnabled();
  await expect(page.locator('.save-status')).toHaveText('Сохранено');
  const before=await snapshot(page);
  expect(before.roster).toHaveLength(2);
  for (const side of before.roster) {
    expect(side.units.length).toBeGreaterThan(0);
    for (const unit of side.units) expect(unit.at).toMatch(/\(\d+, \d+\)/);
  }
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-platform','vk');
  await page.getByRole('button',{name:'Продолжить партию'}).tap();
  await expect(page.getByRole('status')).toHaveText('Партия восстановлена.');
  expect(await snapshot(page)).toEqual(before);
  await info.attach('restored-position',{body:JSON.stringify(before,null,2),contentType:'application/json'});
  expect(errors).toEqual([]);
});

test('Back returns to the menu without optional VK methods', async ({page,browserName})=>{
  await nativeClient(page,browserName==='webkit'?'ios':'android',false);
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-platform','vk');
  await page.getByRole('button',{name:'Настройки'}).tap();
  await page.evaluate(()=>history.back());
  await expect(page.getByRole('navigation',{name:'Главное меню'})).toBeVisible();
  await page.getByRole('button',{name:'Настройки'}).tap();
  await page.getByRole('button',{name:'Назад'}).tap();
  await expect(page.getByRole('navigation',{name:'Главное меню'})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>Boolean(history.state?.interwarVkBack))).toBe(false);
  expect(await page.evaluate(()=>(window as FixtureWindow).vkFixture.calls)).toEqual(['VKWebAppInit']);
});
