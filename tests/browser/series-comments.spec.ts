import {expect,test} from '@playwright/test';

const seriesPath='/series/after-midnight';
const commentsPath=seriesPath+'#series-comments';
const comment='The ending made me want to watch the next episode. <3';

test('viewers can read series comments, sign in to post or like, and delete their own',async({page,browser,baseURL})=>{
  await page.setViewportSize({width:390,height:844});
  await page.addInitScript(()=>localStorage.setItem('drama-language','en'));
  await page.goto(seriesPath);
  const section=page.locator('#series-comments');
  const signIn=section.getByRole('link',{name:'Sign in to comment or like'});
  await expect(page.getByRole('region',{name:'About this series'})).toHaveCount(1);
  await expect(section.getByRole('heading',{name:'Comments',exact:true})).toBeVisible();
  expect(await page.locator('#episodes').evaluate((episodes)=>Boolean(
    episodes.compareDocumentPosition(document.getElementById('series-comments')!)&Node.DOCUMENT_POSITION_FOLLOWING
  ))).toBe(true);
  await expect(section.getByRole('textbox')).toHaveCount(0);
  await signIn.click();
  await expect(page).toHaveURL(url=>url.pathname==='/auth'&&url.searchParams.get('next')===commentsPath);
  const signInResponse=await page.request.post('/api/auth/login',{data:{
    email:'viewer@demo.aidramio.test',password:'DemoPass123!'
  }});
  expect(signInResponse.ok()).toBe(true);
  await page.reload();
  await expect(page).toHaveURL(commentsPath);
  await section.getByRole('textbox',{name:'Write a comment'}).fill(comment);
  await section.getByRole('button',{name:'Post comment'}).click();
  await expect(section.getByText(comment,{exact:true})).toBeVisible();
  await expect(section.getByRole('button',{name:'Like comment',exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  const otherContext=await browser.newContext({baseURL});
  try{
    const other=await otherContext.newPage();
    await other.addInitScript(()=>localStorage.setItem('drama-language','en'));
    await other.goto(seriesPath);
    const discussion=other.locator('#series-comments');
    await expect(discussion.getByText(comment,{exact:true})).toBeVisible();
    await expect(discussion.getByRole('link',{name:'Sign in to like comment'})).toBeVisible();
    const login=await other.request.post('/api/auth/login',{data:{
      email:'creator@demo.aidramio.test',password:'DemoPass123!'
    }});
    expect(login.ok()).toBe(true);
    await other.reload();
    await expect(discussion.getByRole('button',{name:'Delete comment',exact:true})).toHaveCount(0);
    const like=discussion.getByRole('button',{name:'Like comment',exact:true});
    await like.click();
    await expect(like).toHaveAttribute('aria-pressed','true');
    await expect(like).toContainText('1');
    await other.reload();
    await expect(like).toHaveAttribute('aria-pressed','true');
    await like.click();
    await expect(like).toHaveAttribute('aria-pressed','false');

    await section.getByRole('button',{name:'Delete comment',exact:true}).click();
    const confirmation=page.getByRole('dialog',{name:'Delete comment'});
    await confirmation.getByRole('button',{name:'Delete comment',exact:true}).click();
    await expect(section.getByText('No comments yet.')).toBeVisible();
    await other.reload();
    await expect(discussion.getByText('No comments yet.')).toBeVisible();
  }finally{
    await otherContext.close();
  }
});
