import {test,expect,type Page} from '@playwright/test';
import {copyFile,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';

async function openNewSeries(page:Page){
  const login=await page.request.post('/api/auth/login',{data:{email:'creator@demo.aidramio.test',password:'DemoPass123!'}});
  expect(login.ok()).toBe(true);
  await page.goto('/studio/new');
  await expect(page.locator('#series-title')).toBeVisible();
}
function collectCreates(page:Page){
  const bodies:Record<string,unknown>[]=[];
  page.on('request',request=>{
    if(request.method()==='POST'&&new URL(request.url()).pathname==='/api/studio/series')bodies.push(request.postDataJSON());
  });
  return bodies;
}
async function expectLinkedError(page:Page,selector:string,message:RegExp){
  const field=page.locator(selector);
  await expect(field).toHaveAttribute('aria-invalid','true');
  const description=await field.evaluate(element=>{
    const ids=[element.getAttribute('aria-describedby'),element.getAttribute('aria-errormessage')].filter(Boolean).join(' ').split(/\s+/);
    return ids.map(id=>document.getElementById(id)?.textContent||'').join(' ');
  });
  expect(description).toMatch(message);
}

test('short nonempty synopsis explains the required length, preserves the form, and recovery enables a real folder upload',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await openNewSeries(page);const creates=collectCreates(page);
  const title=`Recovered upload ${Date.now()}`;
  await page.locator('#series-title').fill('A');
  await page.locator('#series-description').fill('test');
  await page.getByLabel('Drama language',{exact:false}).selectOption('zh-TW');
  await expect(page.getByRole('button',{name:'Choose a folder',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Save details',exact:true}).first().click();
  await expectLinkedError(page,'#series-title',/2.*120/);
  await expectLinkedError(page,'#series-description',/10.*4,000/);
  await expect(page.locator('#series-title')).toBeFocused();
  expect(creates).toHaveLength(0);
  await page.locator('#series-title').fill(title);
  await page.getByRole('button',{name:'Save details',exact:true}).first().click();
  await expectLinkedError(page,'#series-description',/10.*4,000/);
  await expect(page.locator('#series-description')).toBeFocused();
  await expect(page.locator('#series-title')).toHaveValue(title);
  await expect(page.locator('#series-description')).toHaveValue('test');
  await expect(page.getByLabel('Drama language',{exact:false})).toHaveValue('zh-TW');
  expect(creates).toHaveLength(0);

  const synopsis='Ten numbered test episodes for verifying the complete folder upload.';
  await page.locator('#series-description').fill(synopsis);
  await page.getByRole('button',{name:'Save details',exact:true}).first().click();
  await expect(page).toHaveURL(/\/studio\/series\//);
  await expect(page.getByRole('button',{name:'Choose a folder',exact:true})).toBeEnabled();
  await expect(page.locator('#series-title')).toHaveValue(title);
  await expect(page.locator('#series-description')).toHaveValue(synopsis);
  expect(creates).toHaveLength(1);
  expect(creates[0].language).toBe('zh-TW');

  const folder=await mkdtemp('/tmp/aidramio-validation-upload-');
  try{
    await copyFile('/tmp/aidramio-browser-tests/objects/demo/preview.mp4',path.join(folder,'Episode_01.mp4'));
    const choosing=page.waitForEvent('filechooser');
    await page.getByRole('button',{name:'Choose a folder',exact:true}).click();
    await(await choosing).setFiles(folder);
    await expect(page.locator('.queue-row small')).toHaveText(['Uploaded'],{timeout:30000});
    await expect(page.locator('.episode-editor-row')).toHaveCount(1);
    await page.reload();
    await expect(page.locator('#series-title')).toHaveValue(title);
    await expect(page.locator('#series-description')).toHaveValue(synopsis);
    await expect(page.locator('.episode-editor-row')).toHaveCount(1);
  }finally{await rm(folder,{recursive:true,force:true});}
  expect(errors).toEqual([]);
});

test('an empty genre selection is identified before save and the upload prompt helps the publisher recover',async({page})=>{
  await openNewSeries(page);const creates=collectCreates(page);
  await page.locator('#series-title').fill(`Genre recovery ${Date.now()}`);
  await page.locator('#series-description').fill('A complete synopsis with every text field filled in.');
  const genreGroup=page.locator('#series-genres');
  for(const button of await genreGroup.locator('button.active').all())await button.click();
  await page.getByRole('button',{name:'Save details to enable uploads',exact:true}).click();
  await expectLinkedError(page,'#series-genres',/genre/i);
  expect(await genreGroup.evaluate(element=>element.contains(document.activeElement))).toBe(true);
  expect(creates).toHaveLength(0);
  await genreGroup.getByRole('button',{name:'Drama',exact:true}).click();
  await page.getByRole('button',{name:'Save details to enable uploads',exact:true}).click();
  await expect(page).toHaveURL(/\/studio\/series\//);
  await expect(page.getByRole('button',{name:'Choose a folder',exact:true})).toBeEnabled();
  expect(creates).toHaveLength(1);expect(creates[0].genres).toEqual(['drama']);
});

test('fractional-cent prices and fractional free-episode counts cannot be silently rounded during save',async({page})=>{
  await openNewSeries(page);const creates=collectCreates(page);
  await page.locator('#series-title').fill(`Exact pricing ${Date.now()}`);
  await page.locator('#series-description').fill('A completed draft used to verify precise publisher pricing.');
  await page.locator('#series-price').fill('0.099');
  await page.getByRole('button',{name:'Save details',exact:true}).first().click();
  await expectLinkedError(page,'#series-price',/0\.10|decimal|price/i);
  await expect(page.locator('#series-price')).toBeFocused();
  expect(creates).toHaveLength(0);
  await page.locator('#series-price').fill('0.10');
  await page.locator('#series-free-episodes').fill('1.5');
  await page.getByRole('button',{name:'Save details',exact:true}).first().click();
  await expectLinkedError(page,'#series-free-episodes',/whole|integer|0.*1,000/i);
  await expect(page.locator('#series-free-episodes')).toBeFocused();
  expect(creates).toHaveLength(0);
  await page.locator('#series-free-episodes').fill('1');
  await page.getByRole('button',{name:'Save details',exact:true}).first().click();
  await expect(page).toHaveURL(/\/studio\/series\//);
  expect(creates).toHaveLength(1);expect(creates[0].price_cents).toBe(10);expect(creates[0].free_episodes).toBe(1);
  await expect(page.locator('#series-price')).toHaveValue('0.10');
  await expect(page.locator('#series-free-episodes')).toHaveValue('1');
});
