async (page) => {
  const assert=(v,m)=>{if(!v)throw new Error(m);}, key='marcoIeltsListening.v1';
  await page.goto('http://127.0.0.1:4173/');await page.locator('#vocab-new').waitFor();
  const results=[];
  for(const mode of ['vocab-new','recognition','spelling']) {
    await page.evaluate(k=>localStorage.removeItem(k),key);await page.reload();await page.locator('#vocab-new').waitFor();
    const fixture=await page.evaluate(async({key,mode})=>{
      const s=JSON.parse(localStorage.getItem(key)), items=await fetch('./data/listening.json').then(r=>r.json());
      const word=items.find(w=>w.modes.includes(mode==='spelling'?'spelling':'recognition'));
      const q=word.id+':'+(mode==='spelling'?'spelling':'recognition');
      const yesterday=new Date(s.daily.date+'T12:00:00');yesterday.setDate(yesterday.getDate()-1);
      s.streak=3;s.lastCompletedDate=yesterday.toISOString().slice(0,10);
      s.daily={date:s.daily.date,baseKeys:[q],queue:[{key:q,isRetry:false}],answeredBase:{},outcomes:{},retryCount:{},correctStreak:{},completed:false};s.vocabNewDaily=null;
      localStorage.setItem(key,JSON.stringify(s));return {today:s.daily.date,answer:word.acceptedAnswers[0]};
    },{key,mode});
    await page.reload();await page.locator(mode==='vocab-new'?'#vocab-new':'#start').click();
    if(mode==='spelling') {await page.locator('#answer').fill(fixture.answer);await page.locator('#spelling-form').evaluate(f=>f.requestSubmit());await page.locator('.finished').waitFor();}
    else {await page.locator('.confidence-known').click();await page.locator(mode==='vocab-new'?'#vocab-next':'#continue').click();}
    await page.reload();await page.locator('#vocab-new').waitFor();
    let s=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),key);
    assert(s.streak===4 && s.lastCompletedDate===fixture.today && s.daily.completed,mode+' completion not credited');
    await page.reload();await page.locator('#vocab-new').waitFor();
    s=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),key);assert(s.streak===4,'refresh double credit');
    for(const size of [{width:320,height:568},{width:390,height:844}]) {await page.setViewportSize(size);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'home overflow');}
    results.push({mode,streak:s.streak});
  }
  return {ok:true,results};
}
