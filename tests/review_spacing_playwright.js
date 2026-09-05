async (page) => {
  const assert=(v,m)=>{if(!v)throw new Error(m);};
  const key='marcoIeltsListening.v1';
  await page.goto('http://127.0.0.1:4173/');
  await page.evaluate(key=>localStorage.removeItem(key),key);
  await page.reload();await page.locator('#vocab-errors').waitFor();
  const target=await page.evaluate(async key=>{
    const state=JSON.parse(localStorage.getItem(key));
    const source=await fetch('./data/listening.json').then(r=>r.json());
    const item=source.find(i=>i.modes.includes('recognition') && state.errorWords[i.id]);
    for(const record of Object.values(state.errorWords)) Object.assign(record,{nextReviewAt:'2099-01-01',masteryLevel:5,lastReviewResult:'known',lastWrongAt:'2026-08-01'});
    state.errorWords[item.id]={...state.errorWords[item.id],nextReviewAt:state.daily.date,masteryLevel:2,wrongCount:4,lastWrongAt:'2026-08-01',lastReviewResult:'known',causedIeltsError:true};
    state.vocabErrorDaily=null;
    state.starred[item.id]=true;
    localStorage.setItem(key,JSON.stringify(state));
    return item.id;
  },key);
  await page.reload();await page.locator('#vocab-errors').waitFor();
  const read=()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key);
  assert((await read()).vocabErrorDaily.baseKeys.length===1,'future words filled daily quota');
  await page.locator('#vocab-errors').click();await page.locator('#vocab-known').click();
  const first=(await read()).errorWords[target];
  assert(first.masteryLevel===3 && first.priority==='A','due pass did not advance or cool down');
  await page.locator('#vocab-next').click();await page.locator('#vocab-restart').click();
  assert((await read()).vocabErrorDaily.extra.queue[0].key===target+':vocab','fixture should put near-due A before distant future');
  await page.locator('#vocab-known').click();
  let record=(await read()).errorWords[target];
  assert(record.masteryLevel===3 && record.nextReviewAt===first.nextReviewAt,'same-day practice advanced mastery');
  await page.locator('#result-home').click();
  await page.reload();await page.locator('#vocab-errors').waitFor();
  record=(await read()).errorWords[target];
  assert(record.isErrorWord && record.wrongCount===4 && (await read()).starred[target],'practice erased history/star');
  await page.evaluate(key=>{
    const state=JSON.parse(localStorage.getItem(key));state.vocabErrorDaily=null;
    localStorage.setItem(key,JSON.stringify(state));
  },key);
  await page.reload();await page.locator('#vocab-errors').click();
  assert((await page.locator('.finished h2').innerText()).includes('暂无到期'),'zero due empty state incorrect');
  return {ok:true,dueWords:1,mastery:record.masteryLevel,priority:record.priority,wrongCount:record.wrongCount,nextReview:record.nextReviewAt};
}
