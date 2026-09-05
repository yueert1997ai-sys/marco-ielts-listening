async (page) => {
  const assert=(v,m)=>{if(!v)throw new Error(m);};
  const key='marcoIeltsListening.v1';
  await page.goto('http://127.0.0.1:4173/');
  await page.evaluate(key=>localStorage.removeItem(key),key);
  await page.reload();
  await page.locator('#vocab-errors').waitFor();
  await page.setViewportSize({width:390,height:844});
  const read=()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key);
  const original=(await read()).vocabErrorDaily.baseKeys;
  await page.locator('#vocab-errors').click();
  await page.locator('#vocab-known').evaluate(button=>{button.click();button.click();});
  assert((await read()).vocabErrorDaily.queue.length===17,'double click answered two cards');
  await page.locator('#vocab-next').click();
  for(let i=1;i<18;i++) {
    await page.locator('#vocab-known').click();
    await page.locator('#vocab-next').click();
  }
  assert((await page.locator('.finished h2').innerText()).includes('今日错词复习完成'),'last card not completed');
  await page.locator('#back-home').click();
  await page.reload();
  await page.locator('#vocab-errors').waitFor();
  let daily=(await read()).vocabErrorDaily;
  assert(JSON.stringify(daily.baseKeys)===JSON.stringify(original),'refresh changed daily batch');
  assert(daily.completed && daily.queue.length===0 && Object.keys(daily.answeredBase).length===18,'refresh appended new tasks');
  await page.locator('#vocab-errors').click();
  await page.locator('#vocab-restart').click();
  await page.locator('#vocab-known').click();
  await page.locator('#result-home').click();
  daily=(await read()).vocabErrorDaily;
  assert(daily.queue.length===0 && daily.extra.queue.length===17,'extra practice damaged daily completion');
  assert(JSON.stringify(daily.baseKeys)===JSON.stringify(original),'extra practice replaced daily batch');
  await page.reload();
  await page.locator('#vocab-errors').click();
  assert((await page.locator('#vocab-restart').innerText()).includes('继续'),'extra practice not resumable');
  await page.locator('#back-home').click();
  await page.locator('#vocab-new').click();
  const newKey=(await read()).vocabNewDaily.queue[0].key;
  await page.locator('#vocab-unknown').evaluate(button=>{button.click();button.click();});
  let state=await read();
  assert(state.errorWords[newKey.replace(/:recognition$/,'')].wrongCount>=1,'unknown not archived');
  assert(Object.keys(state.vocabNewDaily.answeredBase).length===1,'new word double counted');
  assert(state.daily.answeredBase[newKey] && !state.daily.queue.some(e=>e.key===newKey),'new paths out of sync');
  await page.locator('#result-home').click();
  await page.reload();
  await page.locator('#vocab-new').click();
  assert((await read()).vocabNewDaily.queue[0].key!==newKey,'refresh repeats answered new word');
  for(let i=1;i<25;i++) {
    await page.locator('#vocab-known').click();
    await page.locator('#vocab-next').click();
  }
  assert((await page.locator('.finished h2').innerText()).includes('今天的新词背完了'),'new completion missing');
  await page.locator('#back-home').click();
  assert((await page.locator('#vocab-new .vocab-path-progress').innerText()).replace(/\s/g,'')==='25/25','new progress incorrect');
  await page.screenshot({path:'output/audit-daily-complete-390.png'});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth),'home overflow');
  return {ok:true,dailyErrors:'18/18',dailyNew:'25/25',extraRemaining:17,cases:['double-click','last-question','refresh','extra-practice','pause-resume','cross-path-new','new-complete']};
}
