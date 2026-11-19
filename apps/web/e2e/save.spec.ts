import { startCrossing } from './start';
import { expect, test } from '@playwright/test';

test('autosave resumes after reload, and a manual checkpoint restores an earlier order', async ({page})=>{
  await startCrossing(page);
  await page.getByRole('button',{name:'Сохранить позицию'}).click();
  await expect(page.locator('.save-status')).toHaveText('Сохранено');
  await page.getByRole('button',{name:/Окопаться/}).click();
  await expect(page.locator('.dispatches')).toContainText('окопы 1');
  await expect(page.locator('.save-status')).toHaveText('Сохранено');
  await page.reload();
  await page.getByRole('button',{name:'Продолжить партию'}).click();
  await expect(page.getByRole('status')).toHaveText('Партия восстановлена.');
  await expect(page.getByRole('button',{name:/Окопаться/})).toHaveCount(0);
  await expect(page.locator('.dispatches')).toContainText('окопы 1');
  await page.getByRole('button',{name:'Загрузить позицию'}).click();
  await expect(page.locator('.dispatches')).not.toContainText('окопы 1');
  await expect(page.getByRole('button',{name:/Окопаться/})).toBeEnabled();
  await expect(page.locator('.save-status')).toHaveText('Сохранено');
});

test('an aborted save keeps the last committed revision recoverable',async ({page})=>{
  await startCrossing(page);
  await page.getByRole('button',{name:/Окопаться/}).click();
  await expect(page.locator('.save-status')).toHaveText('Сохранено');
  await page.evaluate(()=>{
    const put=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(...args:Parameters<typeof put>) {
      const request=put.apply(this,args); this.transaction.abort(); return request;
    };
  });
  await page.getByRole('button',{name:/Завершить фазу/}).click();
  await expect(page.locator('.turn')).toContainText('Красные');
  await expect(page.locator('.save-status')).toContainText('Ошибка сохранения');
  await page.reload();
  await page.getByRole('button',{name:'Продолжить партию'}).click();
  await expect(page.locator('.turn')).toContainText('Синие');
  await expect(page.locator('.dispatches')).toContainText('окопы 1');
});

test('portrait command room keeps map, roster and orders accessible',async ({page})=>{
  await page.setViewportSize({width:390,height:844});
  await startCrossing(page);
  const map=page.getByLabel('Гексагональная карта, 8 на 5 клеток');
  await expect(map).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
  await page.getByRole('button',{name:'Части',exact:true}).click();
  await page.getByRole('button',{name:/Кавалерия/}).click();
  await expect(page.locator('.order h2')).toHaveText('Кавалерия');
  await expect(page.getByRole('button',{name:'Приказ',exact:true})).toHaveAttribute('aria-pressed','true');
});
