import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { tapHex } from './start';

const sdkURL = 'https://telegram.org/js/telegram-web-app.js?65';
const events = {
  viewport:'viewport_changed', safe:'safe_area_changed', content:'content_safe_area_changed',
  back:'back_button_pressed', visibility:'visibility_changed',
} as const;
interface NativeMessage { name:string; data:Record<string, unknown> }
type ClientWindow = typeof window & {
  Telegram: { WebView: {receiveEvent(name:string, data:object):void} };
  nativeMessages: NativeMessage[];
}

async function receive(page:Page, name:string, data:object = {}) {
  await page.evaluate(({name,data}) => (window as ClientWindow).Telegram.WebView.receiveEvent(name,data), {name,data});
}

async function lastMessage(page:Page,name:string) {
  return page.evaluate(name => (window as ClientWindow).nativeMessages.filter(m=>m.name===name).at(-1)?.data,name);
}

let sdk:Buffer;
test.beforeAll(async ({request}, info) => {
  const file=process.env.INTERWAR_TELEGRAM_SDK_FILE;
  if (file) sdk=await readFile(file);
  else {
    const response=await request.get(sdkURL);
    expect(response.ok()).toBe(true);
    sdk=await response.body();
  }
  info.annotations.push({type:'SDK SHA-256', description:createHash('sha256').update(sdk).digest('hex')});
});
test.beforeEach(async ({page}) => {
  await page.route(sdkURL, route => route.fulfill({contentType:'text/javascript',body:sdk}));
  // Only the native end of the bridge is emulated. WebApp and WebView come from Telegram's script.
  await page.addInitScript(() => {
    const nativeMessages:NativeMessage[]=[];
    Object.assign(window,{nativeMessages, TelegramWebviewProxy:{
      postEvent(name:string,payload:string) { nativeMessages.push({name,data:JSON.parse(payload || '{}') ?? {}}); },
    }});
  });
});

test.use({viewport:{width:390,height:844},hasTouch:true,isMobile:true});

test('SDK 8.0 launch, native controls, safe areas, suspend, campaign result and restore', async ({page}) => {
  test.setTimeout(100_000);
  const errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',dialog=>void dialog.accept());
  await page.goto('/#tgWebAppPlatform=android&tgWebAppVersion=8.0');
  await expect.poll(()=>lastMessage(page,'web_app_ready')).toBeDefined();
  await expect.poll(()=>lastMessage(page,'web_app_expand')).toBeDefined();
  const root=page.locator('html');
  await expect(root).toHaveAttribute('data-platform','telegram');
  await page.getByRole('button',{name:'Настройки'}).tap();
  await expect.poll(()=>lastMessage(page,'web_app_setup_back_button')).toMatchObject({is_visible:true});
  await receive(page,events.back);
  await expect(page.getByRole('navigation',{name:'Главное меню'})).toBeVisible();
  await expect.poll(()=>lastMessage(page,'web_app_setup_back_button')).toMatchObject({is_visible:false});
  await page.getByRole('button',{name:'Начать',exact:true}).tap();
  await page.getByRole('button',{name:'Начать операцию'}).tap();
  await expect(page.locator('.order .location')).toContainText('(1, 2)');
  await expect.poll(()=>lastMessage(page,'web_app_setup_swipe_behavior')).toMatchObject({allow_vertical_swipe:false});

  await receive(page,events.viewport,{height:710,is_expanded:true,is_state_stable:true});
  await receive(page,events.viewport,{height:685,is_expanded:false,is_state_stable:false});
  await receive(page,events.safe,{top:16,bottom:12,left:0,right:0});
  await receive(page,events.content,{top:24,bottom:4,left:5,right:9});
  const game=page.locator('.operation');
  await expect(game).toHaveCSS('height','710px');
  await expect(game).toHaveCSS('padding-top','40px');
  await expect(game).toHaveCSS('padding-bottom','16px');
  await expect(game).toHaveCSS('padding-right','9px');
  await page.evaluate(() => {
    window.addEventListener('pointerup', () => {
      (window as ClientWindow).Telegram.WebView.receiveEvent('visibility_changed',{is_visible:false});
    }, {once:true,capture:true});
  });
  await tapHex(page,4,2);
  await receive(page,events.visibility,{is_visible:true});
  await page.waitForTimeout(400);
  await expect(page.locator('.order .location')).toContainText('(1, 2)');
  await tapHex(page,4,2);
  await expect(page.getByRole('status')).toContainText('заняла клетку (4, 2)');
  await tapHex(page,5,2);
  const preview=page.getByRole('region',{name:'Предпросмотр боя'});
  await expect(preview).toBeVisible();
  await receive(page,events.back);
  await expect(preview).toHaveCount(0);
  await tapHex(page,5,2);
  await page.setViewportSize({width:844,height:390});
  await receive(page,events.viewport,{height:365,is_expanded:true,is_state_stable:true});
  await receive(page,events.safe,{top:0,bottom:8,left:24,right:24});
  await receive(page,events.content,{top:8,bottom:0,left:0,right:0});
  await expect(preview.getByRole('button',{name:'Атаковать'})).toBeInViewport({ratio:1});
  await preview.getByRole('button',{name:'Атаковать'}).tap();
  await expect(page.getByRole('status')).toContainText('Бой завершён');

  await page.evaluate(() => {
    document.querySelector('.phase-controls button')!.addEventListener('click',() => {
      (window as ClientWindow).Telegram.WebView.receiveEvent('visibility_changed',{is_visible:false});
    },{once:true});
  });
  const phase=page.locator('.phase-controls button');
  await phase.tap();
  await expect(page.locator('.turn')).toContainText('Красные');
  await expect(page.locator('.save-status')).toHaveText('Сохранено');
  const journal=await page.locator('.dispatches').textContent();
  // The active AI normally issues an order every 160 ms.
  await page.waitForTimeout(500);
  expect(await page.locator('.dispatches').textContent()).toBe(journal);
  await receive(page,events.visibility,{is_visible:true});
  await expect(page.locator('.turn')).toContainText('Раунд 2');
  await expect(phase).toBeEnabled();
  for (let round=2;round<=8;round++) {
    if (await phase.textContent()==='Начать заново') break;
    await phase.tap();
    await expect(page.locator('.turn')).not.toHaveText('Раунд '+round+'Синие');
    await expect(phase).toBeEnabled();
  }
  await expect(phase).toHaveText('Начать заново');
  const result=await page.locator('.phase-controls h2').textContent();
  await expect(page.locator('.save-status')).toHaveText('Сохранено');
  await receive(page,events.back);
  await expect.poll(()=>lastMessage(page,'web_app_setup_swipe_behavior')).toMatchObject({allow_vertical_swipe:true});
  await page.reload();
  await page.getByRole('button',{name:'Продолжить партию'}).tap();
  await expect(page.locator('.phase-controls h2')).toHaveText(result!);
  expect(errors).toEqual([]);
});

test('6.0 client keeps local navigation and never receives newer host commands', async ({page}) => {
  await page.goto('/#tgWebAppPlatform=ios&tgWebAppVersion=6.0');
  await expect.poll(()=>lastMessage(page,'web_app_ready')).toBeDefined();
  await page.getByRole('button',{name:'Начать',exact:true}).tap();
  await page.getByRole('button',{name:'Начать операцию'}).tap();
  await expect(page.locator('.order .location')).toContainText('(1, 2)');
  await page.getByRole('button',{name:'В меню'}).tap();
  await expect(page.getByRole('navigation',{name:'Главное меню'})).toBeVisible();
  expect(await lastMessage(page,'web_app_setup_back_button')).toBeUndefined();
  expect(await lastMessage(page,'web_app_setup_swipe_behavior')).toBeUndefined();
  expect(await lastMessage(page,'web_app_request_fullscreen')).toBeUndefined();
});
