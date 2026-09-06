async (page) => {
  const base='http://127.0.0.1:4173/', key='marcoIeltsListening.v1';
  const assert=(v,m)=>{if(!v)throw new Error(m);};
  const read=tab=>tab.evaluate(k=>localStorage.getItem(k),key);
  await page.goto(base);await page.locator('#vocab-new').waitFor();
  await page.evaluate(k=>localStorage.removeItem(k),key);await page.reload();await page.locator('#vocab-new').waitFor();
  const initial=await read(page), second=await page.context().newPage();
  await second.goto(base);await second.locator('#progress-conflict').waitFor();
  assert(await read(second)===initial,'second page changed records at startup');
  for(const size of [{width:320,height:568},{width:390,height:844}]) {
    await second.setViewportSize(size);await second.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    const box=await second.locator('#reload-progress').boundingBox();
    assert(box && box.x>=0 && box.y>=0 && box.y+box.height<=size.height,'reload outside mobile screen');
    assert(await second.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'dialog overflow');
    await second.screenshot({path:`output/multi-tab-protection-${size.width}.png`});
  }
  await second.keyboard.press('Escape');assert(await second.locator('#progress-conflict').isVisible(),'escape bypasses guard');
  await page.locator('#vocab-new').click();await page.locator('#vocab-known').click();await page.locator('.session-star').click();
  const saved=JSON.parse(await read(page)), star=Object.keys(saved.starred)[0];
  await page.goto('about:blank');
  await second.locator('#reload-progress').click();await second.locator('#vocab-new').waitFor();
  const restored=JSON.parse(await read(second));assert(restored.starred[star],'takeover lost star');
  assert(JSON.stringify(restored.progress)===JSON.stringify(saved.progress),'takeover lost training');
  await second.locator('#home-more summary').click();await second.locator('#browse').click();await second.locator('[data-star]').nth(1).click();
  const updated=await read(second);
  await page.goto(base);await page.locator('#progress-conflict').waitFor();assert(await read(page)===updated,'returning page overwrote latest');
  await second.close();await page.locator('#reload-progress').click();await page.locator('#vocab-new').waitFor();
  // A legacy/external writer bypassing Web Locks must still be detected.
  await page.locator('#vocab-new').click();const stale=await page.locator('#vocab-known').elementHandle();
  const external=await page.context().newPage();await external.goto(base+'version.json');
  const externalRaw=await external.evaluate(k=>{const s=JSON.parse(localStorage.getItem(k));s.starred['external-writer']=true;const raw=JSON.stringify(s);localStorage.setItem(k,raw);return raw;},key);
  await page.locator('#progress-conflict').waitFor();await stale.evaluate(b=>b.click());
  assert(await read(page)===externalRaw,'stale answer overwrote external update');
  assert(await page.locator('#export-conflict').isVisible(),'no recovery export');
  await external.close();await page.locator('#reload-progress').click();await page.locator('#vocab-new').waitFor();
  assert(JSON.parse(await read(page)).starred['external-writer'],'reload lost external update');
  // Check-before-write also protects when no storage event has arrived yet.
  await page.locator('#vocab-new').click();
  const newer=await page.evaluate(k=>{const s=JSON.parse(localStorage.getItem(k));s.starred['no-event-writer']=true;const raw=JSON.stringify(s);localStorage.setItem(k,raw);return raw;},key);
  await page.locator('#vocab-known').click();await page.locator('#progress-conflict').waitFor();
  assert(await read(page)===newer,'save overwrote a newer snapshot without storage event');
  await page.locator('#reload-progress').click();await page.locator('#vocab-new').waitFor();
  await page.evaluate(()=>{dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});
  await page.locator('#progress-conflict').waitFor();
  await page.locator('#reload-progress').click();await page.locator('#vocab-new').waitFor();
  // Two pages arriving simultaneously must not both acquire write access.
  await page.goto('about:blank');
  const a=await page.context().newPage(),b=await page.context().newPage();
  await Promise.all([a.goto(base),b.goto(base)]);
  await Promise.all([a.locator('#vocab-new,#progress-conflict').waitFor(),b.locator('#vocab-new,#progress-conflict').waitFor()]);
  assert(await a.locator('#vocab-new').count()+await b.locator('#vocab-new').count()===1,'two simultaneous writers');
  await a.close();await b.close();
  const unsupported=await page.context().browser().newContext();
  await unsupported.addInitScript(()=>Object.defineProperty(navigator,'locks',{value:undefined}));
  const old=await unsupported.newPage();await old.goto(base);await old.locator('#progress-conflict').waitFor();
  assert(await read(old)===null,'unsupported browser wrote unsafe state');await unsupported.close();
  await page.goto(base);await page.locator('#vocab-new').waitFor();
  return {ok:true,cases:['second-page-read-only','mobile-dialog','escape-blocked','close-and-resume','stars-and-training-preserved','legacy-writer-detected','stale-click-blocked','compare-before-write','page-cache-resume','simultaneous-start','unsupported-safe']};
}
