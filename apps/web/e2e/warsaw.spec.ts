import { expect, test } from '@playwright/test';
import { finishAiPhase } from './start';


test('the Warsaw bridgehead opens from the catalogue, plays through the result with AI, restores and restarts the same operation',async({page},info)=>{
  test.setTimeout(100_000);
  page.on('dialog',d=>void d.accept());
  await page.goto('/');
  await page.getByRole('button',{name:'Сценарии',exact:true}).click();
  await page.getByRole('combobox',{name:'Сценарий',exact:true}).selectOption('warsaw_radzymin_1920');
  await expect(page.getByRole('heading',{name:'Варшавское предмостье'})).toBeVisible();
  await page.getByText('Масштаб и исторические источники').click();
  await expect(page.locator('.scenario-notes')).toContainText('4 км');
  await expect(page.locator('.scenario-notes a')).toHaveCount(2);
  await page.getByLabel('Командование').selectOption('blue');
  await page.getByRole('button',{name:'Начать операцию'}).click();
  const phase=page.locator('.phase-controls button');
  await expect(page.getByLabel('Гексагональная карта, 10 на 6 клеток')).toBeVisible();
  await finishAiPhase(page);
  await expect(page.locator('.turn strong')).toHaveText('Войско Польское');
  await expect(page.locator('.dispatches')).toContainText(/окопы|потери| → |заняли/);
  await page.getByRole('button',{name:/Пехота.*3, 3/}).click();
  await page.getByRole('button',{name:/Окопаться/}).click();
  await expect(page.locator('.dispatches')).toContainText('окопы 1');
  for(let round=1;round<=4;round++){
    if(await phase.textContent()==='Начать заново') break;
    await phase.click();
    await expect(page.locator('.turn')).not.toHaveText('Раунд '+round+'Войско Польское');
    await finishAiPhase(page);
  }
  const result=page.locator('.phase-controls h2');
  await expect(result).toHaveText(/Победа|Поражение|Ничья/);
  const final={result:await result.innerText(),turn:await page.locator('.turn').innerText(),score:await page.locator('.header-score').innerText()};
  await info.attach('Warsaw outcome',{body:JSON.stringify(final),contentType:'application/json'});
  console.log('Warsaw outcome',final);
  await expect(page.locator('.save-status')).toHaveText('Сохранено');
  await page.reload();
  await page.getByRole('button',{name:'Продолжить партию'}).click();
  await expect(page.locator('.op-heading h2')).toHaveText('Варшавское предмостье');
  await expect(result).toHaveText(final.result);
  expect(await page.locator('.turn').innerText()).toBe(final.turn);
  expect(await page.locator('.header-score').innerText()).toBe(final.score);
  await phase.click();
  await expect(page.locator('.op-heading h2')).toHaveText('Варшавское предмостье');
  await expect(page.locator('.turn span')).toHaveText('Раунд 1');
});
