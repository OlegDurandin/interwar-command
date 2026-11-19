import { expect, test } from '@playwright/test';
import { startCrossing } from './start';

const vkChunk = /\/assets\/bridge-[^/]+\.js$/;

test('standalone and Telegram ignore VK launch parameters and do not load the bridge', async ({page}) => {
  const requests:string[]=[];
  page.on('request', r => { if (vkChunk.test(r.url())) requests.push(r.url()); });
  const url='/?vk_app_id=123&vk_platform=mobile_android';
  await page.goto(url);
  await expect(page.locator('html')).toHaveAttribute('data-platform','standalone');
  await page.addInitScript(() => Object.assign(window,{
    TelegramWebviewProxy:{postEvent() {}}, Telegram:{WebApp:{ready() {}}},
  }));
  await page.goto(url);
  await expect(page.locator('html')).toHaveAttribute('data-platform','telegram');
  expect(requests).toEqual([]);
});

test('an untrusted parent cannot activate VK; a VK Web parent receives Init through the official bridge', async ({page}) => {
  const baseURL='https://interwar.test';
  // Serve the local build as HTTPS to match the parent frame's deployment scheme.
  await page.route(baseURL+'/**', route => {
    const path=new URL(route.request().url()).pathname;
    if (path==='/') return route.fulfill({path:'dist/index.html'});
    if (/^\/assets\/[\w.-]+$/.test(path)) return route.fulfill({path:'dist'+path});
    return route.abort();
  });
  const requests:string[]=[];
  page.on('request', r => { if (vkChunk.test(r.url())) requests.push(r.url()); });
  for (const origin of ['https://vk.ru.example.org','https://vk.ru']) {
    await page.route(origin+'/app123', route => route.fulfill({contentType:'text/html', body:
      `<script>addEventListener('message', e => {
        if (e.origin !== '${baseURL}' || e.data?.type !== 'vk-connect') return;
        const {handler,params}=e.data;
        const supported=handler==='SetSupportedHandlers';
        e.source.postMessage({type:supported ? handler : handler+'Result',data:{
          request_id:params.request_id,...(supported ? {supportedHandlers:[]} : {result:true})
        }},e.origin);
      });</script><iframe src="${baseURL}/?vk_app_id=123&vk_platform=desktop_web"></iframe>`,
    }));
    await page.goto(origin+'/app123');
    const frame=page.frameLocator('iframe');
    const trusted=origin==='https://vk.ru';
    await expect(frame.locator('html')).toHaveAttribute('data-platform',trusted ? 'vk' : 'standalone');
    expect(requests).toHaveLength(trusted ? 1 : 0);
  }
});

test('the menu works while Init is pending and a late VK acknowledgement attaches to the current screen', async ({page}) => {
  await page.addInitScript(() => Object.assign(window,{AndroidBridge:{
    VKWebAppInit(payload:string) {
      window.addEventListener('acknowledge-test-init',()=>window.dispatchEvent(new CustomEvent('VKWebAppEvent',{
        detail:{type:'VKWebAppInitResult',data:{...JSON.parse(payload),result:true}},
      })),{once:true});
      document.documentElement.dataset.initAttempt='true';
    },
  }}));
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-init-attempt','true');
  await expect(page.locator('html')).toHaveAttribute('data-platform','standalone');
  await page.getByRole('button',{name:'Настройки'}).click();
  await expect(page.getByRole('button',{name:'Назад'})).toBeVisible();
  await page.evaluate(()=>window.dispatchEvent(new Event('acknowledge-test-init')));
  await expect(page.locator('html')).toHaveAttribute('data-platform','vk');
  await page.evaluate(()=>history.back());
  await expect(page.getByRole('navigation',{name:'Главное меню'})).toBeVisible();
});

test('rejected VK initialization leaves the on-screen controls and saves usable', async ({page}) => {
  await page.addInitScript(() => Object.assign(window,{AndroidBridge:{
    VKWebAppInit(payload:string) {
      document.documentElement.dataset.initAttempt='true';
      const {request_id}=JSON.parse(payload);
      window.dispatchEvent(new CustomEvent('VKWebAppEvent',{detail:{
        type:'VKWebAppInitFailed',data:{request_id,error_type:'client_error'},
      }}));
    },
  }}));
  await startCrossing(page);
  await expect(page.locator('html')).toHaveAttribute('data-init-attempt','true');
  await expect(page.locator('html')).toHaveAttribute('data-platform','standalone');
  await page.getByRole('button',{name:/Окопаться/}).click();
  await expect(page.locator('.save-status')).toHaveText('Сохранено');
  await page.getByRole('button',{name:'В меню'}).click();
  await page.getByRole('button',{name:'Продолжить партию'}).click();
  await expect(page.locator('.dispatches')).toContainText('окопы 1');
});
