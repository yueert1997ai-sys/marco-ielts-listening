async (page) => {
  const origin = page.url().split('/').slice(0, 3).join('/');
  const base = page.url().includes('github.io') ? '/marco-ielts-listening' : '';
  const url = path => `${origin}${base}${path}`;
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(url('/807/'));
  await page.evaluate(() => { localStorage.removeItem('marcoIelts807.v1'); localStorage.removeItem('marcoIeltsConfusionsFlash.v1'); });
  await page.reload();
  const mainBefore = await page.evaluate(() => localStorage.getItem('marcoIeltsListening.v1'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#start').click();
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('marcoIelts807.v1')));
  await page.locator('#play').click();
  await page.waitForFunction(() => !document.querySelector('#skip')?.disabled);
  await page.locator('#audio-rate').selectOption('0.8');
  await page.locator('#spelling-form').evaluate(form => form.requestSubmit());
  assert((await read()).totalAttempts === 0, 'empty answer counted');
  await page.locator('#skip').evaluate(button => { button.click(); button.click(); });
  assert((await read()).totalAttempts === 1, 'double skip counted');
  const first = (await read()).session.feedback.entry.term;
  const queued = (await read()).session.queue;
  const retryAt = queued.findIndex(entry => entry.term === first);
  assert(retryAt >= 8 && retryAt <= 12, 'retry spacing');
  assert(new Set(queued.slice(0, retryAt).map(entry => entry.term)).size >= 6, 'distinct retry spacing');
  await page.reload(); await page.locator('#resume').click();
  assert(await page.locator('#replay').isVisible(), 'feedback lost after refresh');
  await page.locator('#continue').click();
  let count = 1;
  while (!(await page.locator('#another').isVisible()) && count < 40) {
    await page.waitForSelector('#answer');
    await page.locator('#play').click();
    await page.waitForFunction(() => !document.querySelector('#skip')?.disabled);
    const current = (await read()).session.queue[0].term;
    await page.locator('#answer').fill(current);
    await page.locator('#spelling-form').evaluate(form => { form.requestSubmit(); form.requestSubmit(); });
    await page.locator('#correct-continue').click();
    count++;
  }
  assert(await page.locator('#another').isVisible(), 'round did not complete');
  assert((await read()).totalAttempts === 31, '30 base plus one retry expected');
  await page.reload();
  assert(!(await page.locator('#answer').isVisible()), 'refresh created task');
  await page.locator('#finish-wrong').click();
  await page.locator('#play').click(); await page.waitForFunction(() => !document.querySelector('#skip')?.disabled);
  await page.locator('#skip').click();
  assert((await read()).session.queue.length === 0, 'short tail immediately repeated');
  await page.locator('#continue').click();
  await page.evaluate(() => localStorage.setItem('marcoIeltsConfusions.v1', '{broken-cold-record'));
  await page.goto(url('/confusions/?mode=flash'));
  await page.locator('#flash-known').click();
  const flashRead = () => page.evaluate(() => JSON.parse(localStorage.getItem('marcoIeltsConfusionsFlash.v1')));
  const term = (await flashRead()).session.pending.term;
  await page.reload(); await page.locator('#flash-correct').click();
  let flash = await flashRead();
  assert(flash.stats[term].attempts === 1 && flash.stats[term].unknown === 1 && flash.stats[term].known === 0, 'correction not replaced');
  assert(await page.locator('[data-meaning]').count() === 4, 'four choices missing');
  await page.locator('[data-meaning]').first().click();
  assert((await flashRead()).stats[term].mastery === 0, 'meaning promoted mastery');
  await page.locator('#flash-speak').click();
  await page.waitForFunction(() => document.querySelector('#flash-speak')?.textContent.includes('正在播放'));
  await page.locator('[data-audio]').first().click();
  await page.waitForFunction(() => document.querySelector('[data-audio]')?.textContent.includes('正在播放'));
  for (const viewport of [{width:320,height:568},{width:390,height:844},{width:1440,height:900}]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow ${viewport.width}`);
    await page.screenshot({ path: `output/modules-flash-${viewport.width}.png`, fullPage: true });
  }
  assert(await page.evaluate(() => localStorage.getItem('marcoIeltsListening.v1')) === mainBefore, 'main storage polluted');
  for (let guard = 0; guard < 60 && !(await page.locator('#flash-again').isVisible()); guard++) {
    if (await page.locator('#flash-next').isVisible()) await page.locator('#flash-next').click();
    else if (await page.locator('#flash-known').isVisible()) await page.locator('#flash-known').click();
    else throw new Error('unexpected flash phase');
  }
  assert(await page.locator('#flash-again').isVisible(), 'flash round did not finish');
  const finishedFlash = await flashRead();
  assert(finishedFlash.session.results.length === 21, 'flash retry round count');
  await page.reload();
  assert(await page.locator('#flash-again').isVisible(), 'completed flash replaced on refresh');
  assert(await page.evaluate(() => localStorage.getItem('marcoIeltsConfusions.v1')) === '{broken-cold-record', 'flash touched cold record');
  assert(errors.length === 0, JSON.stringify(errors));
  return { ok:true, dictationAttempts:31, widths:[320,390,1440], corrections:true, actualAudioProgress:true };
}
