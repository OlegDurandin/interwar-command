import { expect, test } from '@playwright/test';
import { startCrossing } from './start';

const sdk = 'https://telegram.org/js/telegram-web-app.js*';

test('launch parameters alone leave standalone mode fully local', async ({page}) => {
  let requests = 0;
  await page.route(sdk, route => { requests++; return route.abort(); });
  await page.goto('/?platform=telegram#tgWebAppPlatform=android&tgWebAppVersion=8.0');
  await page.getByRole('button',{name:'Начать',exact:true}).click();
  await page.getByRole('button',{name:'Начать операцию'}).click();
  await expect(page.locator('.order .location')).toContainText('(1, 2)');
  await expect(page.locator('html')).toHaveAttribute('data-platform','standalone');
  expect(requests).toBe(0);
});

test('an unavailable SDK leaves the game and its local save usable', async ({page}) => {
  await page.addInitScript(() => Object.assign(window, {TelegramWebviewProxy:{postEvent() {}}}));
  let requests = 0;
  await page.route(sdk, route => { requests++; return route.abort(); });
  await startCrossing(page);
  await page.getByRole('button',{name:/Окопаться/}).click();
  await expect(page.locator('.save-status')).toHaveText('Сохранено');
  await page.reload();
  await page.getByRole('button',{name:'Продолжить партию'}).click();
  await expect(page.locator('.dispatches')).toContainText('окопы 1');
  await expect(page.locator('html')).toHaveAttribute('data-platform','standalone');
  expect(requests).toBe(2);
});

test('a minimal host without optional methods uses the in-game navigation', async ({page}) => {
  await page.addInitScript(() => Object.assign(window, {
    TelegramWebviewProxy:{postEvent() {}},
    Telegram:{WebApp:{ ready() { document.documentElement.dataset.testReady='true'; } }},
  }));
  await startCrossing(page);
  await expect(page.locator('html')).toHaveAttribute('data-platform','telegram');
  await expect(page.locator('html')).toHaveAttribute('data-test-ready','true');
  await page.getByRole('button',{name:'В меню'}).click();
  await expect(page.getByRole('navigation',{name:'Главное меню'})).toBeVisible();
});

test('only a Telegram Web parent can activate the embedded adapter without a native bridge', async ({page,baseURL}) => {
  await page.addInitScript(() => Object.assign(window,{Telegram:{WebApp:{ready() {}}}}));
  for (const origin of ['https://example.org','https://web.telegram.org']) {
    await page.route(origin + '/frame', route => route.fulfill({
      contentType:'text/html',body:'<iframe src="' + baseURL + '/"></iframe>',
    }));
    await page.goto(origin + '/frame');
    await expect(page.frameLocator('iframe').locator('html')).toHaveAttribute(
      'data-platform',origin === 'https://web.telegram.org' ? 'telegram' : 'standalone');
  }
});
