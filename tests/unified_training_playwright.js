async (page) => {
  const assert=(v,m)=>{if(!v)throw new Error(m);};
  // Run against the selected local or public site in an isolated QA browser only.
  const base=page.url().includes('github.io/marco-ielts-listening')
    ? 'https://yueert1997ai-sys.github.io/marco-ielts-listening/' : 'http://127.0.0.1:4173/';
  const key='marcoIeltsListening.v1', results=[], errors=[];
  const onError=e=>errors.push(e.message);page.on('pageerror',onError);
  await page.goto(base);await page.locator('#vocab-new').waitFor();
  const original=await page.evaluate(key=>localStorage.getItem(key),key);
  const read=()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key);
  try {
    for(const [entrance,field] of [['vocab-new','vocabNewDaily'],['vocab-errors','vocabErrorDaily']]) {
      await page.evaluate(key=>localStorage.removeItem(key),key);
      await page.reload();await page.locator('#'+entrance).waitFor();
      await page.setViewportSize({width:390,height:844});
      const state=await read(), targetKey=state[field].queue[0].key;
      const id=targetKey.replace(/:(vocab|recognition)$/,'');
      const previousWrong=state.errorWords[id]?.wrongCount || 0;
      const meaning=await page.evaluate(async id=>(await fetch('./data/listening.json').then(r=>r.json())).find(w=>w.id===id).meaning,id);
      await page.locator('#'+entrance).click();
      assert(await page.locator('.confidence-button').count()===2,'judgment must have two choices');
      assert(await page.locator('.choice,.meaning,.vocab-archive-strip').count()===0,'answer/history leak before judgment');
      await page.locator('#vocab-unknown').click();
      assert(await page.locator('.choice').count()===4,'four-choice meaning check missing');
      assert((await read())[field].queue[0].meaningCheck,'original judgment not persisted');
      await page.reload();await page.locator('#'+entrance).click();
      assert(await page.locator('.choice').count()===4 && await page.locator('#vocab-known').count()===0,'refresh allows a contaminated known judgment');
      for(const size of [{width:320,height:568},{width:390,height:844},{width:1440,height:900}]) {
        await page.setViewportSize(size);
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'choices overflow');
        await page.locator('.choice').last().scrollIntoViewIfNeeded();
        assert(await page.locator('.choice').last().isVisible(),'last choice unreachable');
      }
      await page.setViewportSize({width:390,height:844});
      await page.locator('.choice').filter({hasText:meaning}).evaluate(button=>{button.click();button.click();});
      let after=await read();
      assert(after.errorWords[id].wrongCount===previousWrong+1,'confirmation must record exactly one original error');
      assert(after.progress[targetKey].stage===0,'recognizing the displayed answer was counted as mastery');
      assert((await page.locator('.result-mark').innerText()).includes('已确认释义'),'confirmation feedback missing');
      await page.locator('.session-star').click();
      const retryIndex=after[field].queue.findIndex(e=>e.key===targetKey);
      assert(retryIndex>=8 && retryIndex<=12,'unknown retry not spaced 8–12 questions');
      await page.locator('#vocab-next').click();
      let between=0;
      while((await read())[field].queue[0].key!==targetKey) {
        assert(between++<30,'retry disappeared');
        await page.locator('#vocab-known').click();await page.locator('#vocab-next').click();
      }
      assert(between===retryIndex,'retry position changed unexpectedly');
      assert(await page.locator('#vocab-known').count()===1 && await page.locator('.choice,.meaning').count()===0,'retry must judge before answers again');
      await page.screenshot({path:`output/unified-${entrance}-retry-390.png`});
      await page.locator('#vocab-known').click();
      after=await read();
      assert(after.progress[targetKey].stage===0,'one later known answer granted mastery');
      assert(after.errorWords[id].isErrorWord && after.starred[id],'error identity/star lost');
      assert(Object.keys(after[field].answeredBase).length===between+1,'reinforcement inflated daily progress');
      if(field==='vocabNewDaily') {
        assert(JSON.stringify(after.daily.queue.filter(e=>e.key.endsWith(':recognition')))===JSON.stringify(after[field].queue),'new entrance lost shared queue');
        await page.locator('#result-home').click();await page.locator('#start').click();
        // Finish any intervening spelling item via its real skip control.
        for(let i=0;await page.locator('#spelling-dont-know').count();i++) {
          assert(i<30,'no recognition in mixed queue');
          await page.locator('#spelling-dont-know').click();await page.locator('#continue').click();
        }
        const mixedKey=(await read()).daily.queue[0].key;
        await page.locator('.confidence-known').click();
        after=await read();
        assert(after.vocabNewDaily.answeredBase[mixedKey],'mixed entrance did not sync');
      }
      results.push({entrance,retryIndex,between,wrongCount:after.errorWords[id].wrongCount,stageAfterFirstRecall:after.progress[targetKey].stage,starRetained:after.starred[id]});
    }
    await page.goto(base);await page.locator('#home-more summary').click();await page.locator('#inbox').click();
    await page.locator('#wrong-word-input').fill('Large pans of sap called evaporators are heated by means of a fire');
    await page.locator('#parse-wrong-words').click();
    assert((await page.locator('#inbox-message').innerText()).includes('完整句子不能加入词库'),'sentence guard missing');
    const release=await page.evaluate(async()=>{
      const stamp=Date.now();const [version,sw,data]=await Promise.all([fetch('./version.json?qa='+stamp).then(r=>r.json()),fetch('./sw.js?qa='+stamp).then(r=>r.text()),fetch('./data/listening.json?qa='+stamp).then(r=>r.json())]);
      return {version:version.version,swVersion:sw.match(/const APP_VERSION = "([^"]+)"/)?.[1],words:data.length,sentenceAbsent:!data.some(w=>w.term.split(/\s+/).length>6)};
    });
    assert(release.version===release.swVersion && release.sentenceAbsent,'release mismatch or full sentence present');
    assert(errors.length===0,JSON.stringify(errors));
    return {ok:true,base,release,results,viewports:['320x568','390x844','1440x900'],pageErrors:errors};
  } finally {
    page.off('pageerror',onError);
    await page.evaluate(({key,original})=>original===null?localStorage.removeItem(key):localStorage.setItem(key,original),{key,original});
  }
}
