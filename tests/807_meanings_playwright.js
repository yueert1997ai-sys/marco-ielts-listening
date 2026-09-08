async (page) => {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('marcoIelts807.v1')));
  await page.goto(page.url().split('?')[0]);
  await page.locator('#start').waitFor();
  const otherBefore = await page.evaluate(() => ['marcoIeltsListening.v1','marcoIeltsConfusions.v1','marcoIeltsConfusionsFlash.v1'].map(k => localStorage.getItem(k)));
  await page.locator('#start').click();
  await page.evaluate(() => {
    const key = 'marcoIelts807.v1'; const state = JSON.parse(localStorage.getItem(key));
    state.session.queue = ['herbivorous', 'major', 'out on load'].map(term => ({term, isRetry: false, retryCount: 0}));
    state.session.totalBase = 3;
    localStorage.setItem(key, JSON.stringify(state));
  });
  await page.reload(); await page.locator('#resume').click();
  for (const mode of ['correct', 'wrong', 'skip']) {
    assert(await page.locator('.answer-definition').count() === 0, 'definition leaks before answer');
    assert(await page.locator('.answer-word').count() === 0, 'word leaks before answer');
    await page.locator('#play').click();
    await page.waitForFunction(() => !document.querySelector('#skip')?.disabled);
    const before = await read();
    if (mode === 'skip') await page.locator('#skip').click();
    else {
      await page.locator('#answer').fill(mode === 'correct' ? before.session.queue[0].term : 'incorrectspelling');
      await page.locator('#spelling-form').evaluate(form => { form.requestSubmit(); form.requestSubmit(); });
    }
    assert((await read()).totalAttempts === before.totalAttempts + 1, 'duplicate submission');
    assert(await page.locator('.answer-pos').isVisible(), `missing POS: ${mode}`);
    assert(/[\u3400-\u9fff]/.test(await page.locator('.answer-meaning').innerText()), `missing meaning: ${mode}`);
    if (mode === 'correct') {
      assert((await page.locator('.answer-meaning').innerText()).includes('食草'), 'herbivorous translation');
      await page.waitForTimeout(1500);
      assert(await page.locator('#correct-continue').isVisible(), 'correct auto advanced');
    }
    const feedbackBefore = await read();
    await page.reload(); await page.locator('#resume').click();
    assert(JSON.stringify(await read()) === JSON.stringify(feedbackBefore), 'refresh changed stats/feedback');
    assert(await page.locator('.answer-definition').isVisible(), 'refresh lost meaning');
    await page.locator('#pause').click(); await page.locator('#resume').click();
    assert(await page.locator('.answer-definition').isVisible(), 'pause lost meaning');
    for (const viewport of [{width:320,height:568},{width:390,height:844},{width:1440,height:900}]) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow ${mode}/${viewport.width}`);
      await page.screenshot({path:`output/807-meaning-${mode}-${viewport.width}.png`, fullPage:true});
    }
    await page.evaluate(async () => { const reg = await navigator.serviceWorker.ready; if (!reg.active) throw Error('no worker'); });
    await page.context().setOffline(true);
    await page.reload(); await page.locator('#resume').click();
    assert(await page.locator('.answer-definition').isVisible(), 'offline lost definition');
    await page.context().setOffline(false);
    await page.locator(mode === 'correct' ? '#correct-continue' : '#continue').click();
  }
  assert(await page.locator('#another').isVisible(), 'last answer did not complete');
  assert((await read()).totalAttempts === 3, 'incorrect round count');
  assert(JSON.stringify(await page.evaluate(() => ['marcoIeltsListening.v1','marcoIeltsConfusions.v1','marcoIeltsConfusionsFlash.v1'].map(k => localStorage.getItem(k)))) === JSON.stringify(otherBefore), 'other module data changed');
  assert(errors.length === 0, errors.join('\n'));
  return '807 meaning PASS: correct/wrong/skip, reveal-only, manual continue, replay gating, refresh/pause/offline, three viewports, storage isolation';
}
