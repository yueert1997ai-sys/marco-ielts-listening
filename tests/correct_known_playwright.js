async (page) => {
  const assert=(v,m)=>{if(!v)throw new Error(m);};
  const base=page.url().includes('github.io/marco-ielts-listening') ? 'https://yueert1997ai-sys.github.io/marco-ielts-listening/' : 'http://127.0.0.1:4173/';
  const storage='marcoIeltsListening.v1', results=[];
  await page.goto(base);await page.locator('#vocab-new').waitFor();
  const backup=await page.evaluate(k=>localStorage.getItem(k),storage);
  const read=()=>page.evaluate(k=>JSON.parse(localStorage.getItem(k)),storage);
  try {
    for(const entrance of ['vocab-errors','vocab-new','start','error-training','starred-training']) {
      await page.evaluate(k=>localStorage.removeItem(k),storage);await page.reload();await page.locator('#vocab-new').waitFor();
      await page.evaluate(async ({storage,entrance})=>{
        const state=JSON.parse(localStorage.getItem(storage));
        const items=await fetch('./data/listening.json').then(r=>r.json());
        const target=items.find(w=>w.term==='12-month maternity cover contract');
        const other=items.filter(w=>w.id!==target.id && w.modes.includes('recognition')).slice(0,24);
        const keys=[target,...other].map(w=>w.id+':recognition');
        state.daily={date:state.daily.date,baseKeys:keys,queue:keys.map(key=>({key,isRetry:false})),answeredBase:{},outcomes:{},retryCount:{},correctStreak:{},completed:false};
        state.vocabNewDaily=null;
        if(entrance==='vocab-errors') {
          for(const record of Object.values(state.errorWords)) Object.assign(record,{nextReviewAt:'2099-01-01'});
          for(const word of [target,...other.slice(0,17)]) state.errorWords[word.id]={...state.errorWords[word.id],isErrorWord:true,wrongCount:2,masteryLevel:2,nextReviewAt:state.daily.date,priority:'S',lastWrongAt:state.daily.date};
          state.errorWords[target.id].wrongCount=100;
          state.vocabErrorDaily=null;
        }
        if(entrance==='error-training' || entrance==='starred-training') {
          state.starred[target.id]=true;
          state.errorDaily=null;state.starredDaily=null;
        }
        localStorage.setItem(storage,JSON.stringify(state));
      },{storage,entrance});
      await page.reload();await page.locator('#vocab-new').waitFor();
      if(entrance==='starred-training') await page.locator('#home-more summary').click();
      await page.locator('#'+entrance).click();
      // Personal supplemental training can start with spelling: reach recognition normally.
      while(await page.locator('#spelling-dont-know').count()) {await page.locator('#spelling-dont-know').click();await page.locator('#continue').click();}
      const field=({'vocab-errors':'vocabErrorDaily','vocab-new':'vocabNewDaily',start:'daily','error-training':'errorDaily','starred-training':'starredDaily'})[entrance];
      const before=await read(), key=before[field].queue[0].key,id=key.replace(/:(recognition|vocab)$/,'');
      assert(await page.locator('#correct-known,.meaning').count()===0,'answer/correction before judgment');
      await page.locator('.confidence-known').click();
      await page.locator('#correct-known').waitFor();
      for(const size of [{width:320,height:568},{width:390,height:844}]) {
        await page.setViewportSize(size);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'horizontal overflow');
        await page.locator('#correct-known').scrollIntoViewIfNeeded();
        assert(await page.locator('#correct-known').isVisible(),'correction unreachable');
        if(entrance==='vocab-errors') await page.screenshot({path:`output/correct-known-button-${size.width}.png`});
      }
      await page.locator('.session-star').click();const star=(await read()).starred[id];
      await page.locator('#correct-known').evaluate(b=>{b.click();b.click();});
      const after=await read(), record=after.progress[key];
      assert(record.passes===(before.progress[key]?.passes || 0) || (!record.passes && !before.progress[key]?.passes),'phantom pass remains');
      assert(record.attempts===(before.progress[key]?.attempts || 0)+1,'correction counted another attempt');
      assert(record.stage===0 && record.lapses===(before.progress[key]?.lapses || 0)+1,'wrong scheduling');
      assert(after.errorWords[id].wrongCount===(before.errorWords[id]?.wrongCount || 0)+1,'double counted correction');
      assert(after.starred[id]===star,'star undone');
      assert((await page.locator('.result-mark').innerText()).includes('已改为不认识'),'correction feedback absent');
      assert(await page.locator('#correct-known').count()===0,'can repeatedly correct');
      const session=entrance==='start'?after.vocabNewDaily:after[field];
      const retry=session.queue.findIndex(e=>e.key===key && e.isRetry);
      if(session.queue.length>12) assert(retry>=8 && retry<=12,'not rescheduled to unknown spacing');
      assert(session.queue.filter(e=>e.key===key && e.isRetry).length<=1,'duplicate retry');
      await page.screenshot({path:`output/correct-known-${entrance}-390.png`});
      await page.locator('#result-home').click();await page.reload();await page.locator('#vocab-new').waitFor();
      assert((await read()).progress[key].lapses===record.lapses,'correction lost on refresh');
      results.push({entrance,retry,attempts:record.attempts,wrongCount:after.errorWords[id].wrongCount});
    }
    await page.evaluate(k=>localStorage.removeItem(k),storage);await page.reload();await page.locator('#vocab-errors').waitFor();
    await page.evaluate(storage=>{
      const state=JSON.parse(localStorage.getItem(storage));const id=Object.keys(state.errorWords)[0];
      for(const record of Object.values(state.errorWords)) record.nextReviewAt='2099-01-01';
      state.errorWords[id].nextReviewAt=state.daily.date;state.vocabErrorDaily=null;
      localStorage.setItem(storage,JSON.stringify(state));
    },storage);
    await page.reload();await page.locator('#vocab-errors').click();
    await page.locator('#vocab-known').click();await page.locator('#correct-known').click();
    await page.locator('#vocab-next').click();await page.locator('#vocab-restart').click();
    const dailyBefore=JSON.stringify((await read()).vocabErrorDaily.answeredBase);
    await page.locator('#vocab-known').click();await page.locator('#correct-known').click();
    let extra=await read();assert(JSON.stringify(extra.vocabErrorDaily.answeredBase)===dailyBefore,'extra correction changes daily completion');
    assert(Object.keys(extra.vocabErrorDaily.extra.answeredBase).length===1,'extra correction counted twice');
    assert(extra.vocabErrorDaily.completed,'extra correction reopens daily');
    await page.locator('#result-home').click();await page.locator('#vocab-new').click();
    await page.locator('#vocab-known').click();await page.locator('#correct-known').evaluate(b=>window.staleKnownCorrection=b);
    await page.locator('#vocab-next').click();const unchanged=JSON.stringify(await read());
    await page.evaluate(()=>window.staleKnownCorrection.click());
    assert(JSON.stringify(await read())===unchanged,'detached correction changed a later question');
    results.push({lastQuestion:true,extraPractice:true,staleButtonIgnored:true});
    return {ok:true,base,results};
  } finally {await page.evaluate(({storage,backup})=>backup===null?localStorage.removeItem(storage):localStorage.setItem(storage,backup),{storage,backup});}
}
