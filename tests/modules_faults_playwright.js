async (page) => {
  const origin = page.url().split('/').slice(0, 3).join('/');
  const base = page.url().includes('github.io') ? '/marco-ielts-listening' : '';
  const url = `${origin}${base}/807/`;
  const assert = (value, message) => { if (!value) throw new Error(message); };
  await page.goto(url);
  await page.evaluate(() => localStorage.removeItem('marcoIelts807.v1'));
  await page.reload();
  await page.evaluate(() => { window.realPlay = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = () => Promise.reject(new DOMException('blocked', 'NotAllowedError')); });
  await page.locator('#start').click();
  await page.waitForFunction(() => document.querySelector('#play')?.textContent === '点此播放');
  assert(await page.locator('#skip').isDisabled(), 'autoplay failure permits scoring');
  await page.evaluate(() => { HTMLMediaElement.prototype.play = () => Promise.reject(new DOMException('missing', 'NotSupportedError')); });
  await page.locator('#play').click();
  await page.waitForFunction(() => document.querySelector('#play')?.textContent.includes('播放失败'));
  assert(await page.locator('#skip').isDisabled(), 'missing audio permits scoring');
  await page.evaluate(() => { HTMLMediaElement.prototype.play = window.realPlay; });
  await page.locator('#play').click(); await page.waitForFunction(() => !document.querySelector('#skip').disabled);
  for (const viewport of [{width:320,height:568},{width:390,height:844},{width:1440,height:900}]) {
    await page.setViewportSize(viewport); await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `807 overflow ${viewport.width}`);
    await page.screenshot({path:`output/modules-807-${viewport.width}.png`,fullPage:true});
  }
  const before = await page.evaluate(() => localStorage.getItem('marcoIelts807.v1'));
  await page.evaluate(() => { window.realSet = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key === 'marcoIelts807.v1') throw new DOMException('full', 'QuotaExceededError'); return window.realSet.call(this, key, value); }; });
  await page.locator('#skip').click();
  assert(await page.locator('#module-storage-warning').isVisible(), 'quota failure hidden');
  assert(await page.evaluate(() => localStorage.getItem('marcoIelts807.v1')) === before, 'quota corrupted stored snapshot');
  await page.evaluate(() => { Storage.prototype.setItem = window.realSet; });
  await page.getByRole('button',{name:'重试保存',exact:true}).click();
  await page.locator('#resume').waitFor();
  assert(await page.evaluate(() => JSON.parse(localStorage.getItem('marcoIelts807.v1')).totalAttempts) === 1, 'retry lost/doubled result');
  const good = await page.evaluate(() => localStorage.getItem('marcoIelts807.v1'));
  await page.evaluate(() => localStorage.setItem('marcoIelts807.v1', '{broken'));
  await page.reload();
  assert(await page.locator('#module-storage-warning').isVisible(), 'corrupt JSON not protected');
  assert(await page.evaluate(() => localStorage.getItem('marcoIelts807.v1')) === '{broken', 'bad JSON overwritten');
  await page.evaluate(value => localStorage.setItem('marcoIelts807.v1', value), good); await page.reload();
  const other = await page.context().newPage(); await other.goto(url);
  await other.locator('#module-storage-warning').waitFor();
  assert(await page.evaluate(() => localStorage.getItem('marcoIelts807.v1')) === good, 'second tab overwrote record');
  await other.close();
  await page.locator('#resume').click(); await page.locator('#continue').click();
  await page.locator('#download-audio').click();
  await page.waitForFunction(() => document.querySelector('#download-audio')?.textContent === '本轮音频已下载');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.locator('#pause').click();
  await page.context().setOffline(true);
  try {
    await page.reload(); await page.locator('#resume').click(); await page.locator('#play').click();
    await page.waitForFunction(() => !document.querySelector('#skip').disabled);
    assert(await page.locator('#answer').isVisible(), 'offline question unavailable');
  } finally { await page.context().setOffline(false); }
  return {ok:true, autoplay:true, audioFailure:true, quota:true, badJSON:true, multipleTabs:true, offlinePlayback:true, widths:[320,390,1440]};
}
