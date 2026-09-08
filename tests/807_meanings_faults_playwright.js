async (page) => {
  const origin = page.url().split('/').slice(0, 3).join('/');
  const base = page.url().includes('github.io') ? '/marco-ielts-listening' : '';
  const url = `${origin}${base}/807/`;
  const context = await page.context().browser().newContext({serviceWorkers:'block'});
  try {
    const isolated = await context.newPage();
    await isolated.goto(url); await isolated.locator('#start').click();
    const before = await isolated.evaluate(() => localStorage.getItem('marcoIelts807.v1'));
    for (const body of [null, JSON.stringify({entries:{herbivorous:{pos:'adj.',meaning:''}}})]) {
      await isolated.route('**/data/meanings.json', route => body === null ? route.abort() : route.fulfill({contentType:'application/json',body}));
      await isolated.reload();
      await isolated.getByText('807 词库没加载出来', {exact:true}).waitFor();
      if (await isolated.locator('#answer').count()) throw Error('training allowed without glossary');
      if (await isolated.evaluate(() => localStorage.getItem('marcoIelts807.v1')) !== before) throw Error('glossary failure changed progress');
      await isolated.unroute('**/data/meanings.json');
    }
    await isolated.reload(); await isolated.locator('#resume').click();
    await isolated.locator('#play').click();
    await isolated.waitForFunction(() => !document.querySelector('#skip')?.disabled);
    await isolated.locator('#skip').click();
    if (!await isolated.locator('.answer-definition').isVisible()) throw Error('glossary did not recover');
    await isolated.locator('#replay').click();
    await isolated.waitForFunction(() => document.querySelector('#replay')?.textContent.includes('正在播放'));
    return {ok:true, missingAndInvalidGlossaryProtectedProgress:true, recovered:true, feedbackReplay:true};
  } finally { await context.close(); }
}
