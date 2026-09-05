async (page) => {
  const assert=(v,m)=>{if(!v)throw new Error(m);};
  const key='marcoIeltsListening.v1';
  const pageErrors=[];
  const onError=error=>pageErrors.push(error.message);
  page.on('pageerror',onError);
  await page.goto('http://127.0.0.1:4173/');
  await page.evaluate(key=>localStorage.removeItem(key),key);
  await page.reload();await page.locator('#vocab-new').waitFor();
  const longest=await page.evaluate(async key=>{
    const state=JSON.parse(localStorage.getItem(key));
    const source=await fetch('./data/listening.json').then(r=>r.json());
    const word=source.filter(i=>i.modes.includes('recognition')).sort((a,b)=>b.term.length-a.term.length)[0];
    state.customItems.push({term:'electroencephalographically',meaning:'脑电图描记方面的解释。'.repeat(40),mode:'recognition',reason:'仅用于隔离浏览器的长释义测试'});
    const keys=[word.id+':recognition','electroencephalographically:recognition'];
    state.daily={date:state.daily.date,baseKeys:keys,queue:keys.map(key=>({key,isRetry:false})),answeredBase:{},outcomes:{},retryCount:{},correctStreak:{},started:false,completed:false};
    state.vocabNewDaily=null;
    localStorage.setItem(key,JSON.stringify(state));
    return word.term;
  },key);
  await page.reload();await page.locator('#vocab-new').waitFor();
  const layouts=[];
  const check=async(screen, selector)=>{
    for(const size of [{width:390,height:844},{width:1440,height:900},{width:320,height:568}]) {
      await page.setViewportSize(size);
      const measure=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight}));
      assert(measure.scrollWidth===size.width,screen+' horizontal overflow');
      await page.locator(selector).scrollIntoViewIfNeeded();
      assert(await page.locator(selector).isVisible(),screen+' control unreachable');
      layouts.push({screen,...size,pageHeight:measure.height});
    }
  };
  await page.locator('#vocab-new').click();
  await check('long-term-judgment','#vocab-unknown');
  assert(await page.locator('.meaning').count()===0,'long term leaks meaning');
  await page.locator('#vocab-known').click();
  await check('long-term-reveal','#vocab-next');
  await page.locator('#vocab-next').click();
  await page.locator('#vocab-unknown').click();
  await check('long-meaning-reveal','#vocab-next');
  await page.setViewportSize({width:390,height:844});
  await page.locator('#result-home').scrollIntoViewIfNeeded();
  await page.screenshot({path:'output/audit-long-meaning-390.png'});
  await page.locator('#result-home').click();
  await page.locator('#home-more summary').click();await page.locator('#error-library').click();
  await check('archive','#error-search');
  const performance=await page.evaluate(key=>{
    const raw=localStorage.getItem(key),samples=[];
    for(let i=0;i<40;i++) {
      const start=performance.now();JSON.parse(raw);JSON.stringify(JSON.parse(raw));samples.push(performance.now()-start);
    }
    const searchSamples=[];
    for(const value of ['contract','考试','electro','not-found','']) {
      const start=performance.now();const input=document.querySelector('#error-search');input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));searchSamples.push(performance.now()-start);
    }
    return {storageBytes:new Blob([raw]).size,parseStringifyMaxMs:Math.max(...samples),searchRenderMaxMs:Math.max(...searchSamples),renderedCards:document.querySelectorAll('.error-library-card').length,domNodes:document.querySelectorAll('*').length};
  },key);
  assert(performance.renderedCards<=20,'archive renders whole library');
  await page.locator('#error-search').fill('electroencephalographically');
  await page.locator('[data-star=electroencephalographically]').click();
  await page.locator('[data-pardon=electroencephalographically]').click();
  await page.locator('#library-back').click();await page.locator('#home-more summary').click();await page.locator('#starred').click();
  assert((await page.locator('.word-stream').innerText()).includes('electroencephalographically'),'pardoned star missing from ordinary important browser');
  await check('important-long-meaning','[data-star=electroencephalographically]');
  await page.setViewportSize({width:1440,height:900});
  await page.locator('#browse-back').click();await page.screenshot({path:'output/audit-desktop-1440.png'});
  await page.locator('#home-more summary').click();await page.locator('#inbox').click();
  await page.locator('#wrong-word-input').fill('Large pans of sap called evaporators are heated by means of a fire');
  await page.locator('#parse-wrong-words').click();
  const sentenceGuard=await page.locator('#inbox-message').innerText();
  assert(sentenceGuard.includes('完整句子不能加入词库'),'sentence intake not blocked');
  page.off('pageerror',onError);
  assert(pageErrors.length===0,JSON.stringify(pageErrors));
  return {ok:true,longest,layouts,performance,sentenceGuard,pageErrors};
}
