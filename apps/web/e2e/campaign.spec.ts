import { expect,test } from '@playwright/test';
import { clickCell,finishAiPhase,startCrossing } from './start';

test('blue infantry takes the objective, attacks, plays against red AI through the result and recovers a checkpoint',async({page})=>{
  test.setTimeout(90000);
  const errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));
  await startCrossing(page,'blue');
  await page.getByRole('button',{name:/Пехота.*1, 2/}).click();
  await clickCell(page,4,2);
  await expect(page.locator('.order .location')).toContainText('(4, 2)');
  await clickCell(page,5,2);
  await expect(page.getByRole('region',{name:'Предпросмотр боя'})).toBeVisible();
  await page.getByRole('button',{name:'Атаковать',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('Бой завершён');
  await page.getByRole('button',{name:'Сохранить позицию'}).click();
  await expect(page.locator('.save-status')).toHaveText('Сохранено');
  const end=page.getByRole('button',{name:/Завершить фазу/});
  await end.click();
  await finishAiPhase(page);
  await expect(page.locator('.turn')).toContainText('Раунд 2');
  await expect(page.locator('.turn')).toContainText('Синие');
  await expect(page.locator('.dispatches')).toContainText(/окопы|потери| → |заняли/);
  for(let round=2;round<=8;round++) {
    if(await page.getByRole('button',{name:'Начать заново'}).count()) break;
    await end.click();
    await expect(page.locator('.turn')).not.toContainText('Раунд '+round+'Синие');
    await finishAiPhase(page);
  }
  await expect(page.locator('.phase-controls h2')).toHaveText(/Победа|Поражение|Ничья/);
  await page.getByRole('button',{name:'Начать заново'}).click();
  await expect(page.locator('.turn')).toContainText('Раунд 1');
  await expect(page.getByRole('button',{name:/Пехота.*1, 2/})).toBeVisible();
  await page.getByRole('button',{name:'В меню'}).click();
  await page.getByRole('button',{name:'Загрузить позицию'}).click();
  await expect(page.getByRole('status')).toHaveText('Партия восстановлена.');
  await expect(page.getByRole('button',{name:/Пехота.*4, 2/})).toBeVisible();
  expect(errors).toEqual([]);
});

test('red commander watches the blue opening in landscape',async({page})=>{
  await page.setViewportSize({width:844,height:390});
  await startCrossing(page,'red');
  await finishAiPhase(page);
  await expect(page.locator('.turn')).toContainText('Красные');
  await expect(page.getByRole('button',{name:/Завершить фазу/})).toBeEnabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(844);
  await expect(page.locator('.dispatches')).toContainText(/окопы|потери| → |заняли/);
});
