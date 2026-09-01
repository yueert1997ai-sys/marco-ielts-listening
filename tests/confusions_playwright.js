async (page) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const baseUrl = page.url().startsWith("https://yueert1997ai-sys.github.io/")
    ? "https://yueert1997ai-sys.github.io/marco-ielts-listening/"
    : "http://127.0.0.1:4173/";
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
    const names = await caches.keys();
    await Promise.all(names.map((name) => caches.delete(name)));
  });
  const fixture = await page.evaluate(() => fetch("./tests/fixtures/listening_history_state.json").then((response) => response.json()));
  await page.evaluate((value) => localStorage.setItem("marcoIeltsListening.v1", JSON.stringify(value)), fixture);
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("#start").waitFor();

  const beforeRaw = await page.evaluate(() => localStorage.getItem("marcoIeltsListening.v1"));
  const before = JSON.parse(beforeRaw);
  await page.locator("#confusions").click();
  await page.locator("#start-learning").waitFor();
  const entry = {
    url: page.url(),
    title: await page.locator(".topbar h1").innerText(),
    version: await page.locator(".version-badge").innerText(),
    mainStorageUnchanged: beforeRaw === await page.evaluate(() => localStorage.getItem("marcoIeltsListening.v1")),
    standardPaceSelected: await page.locator('[data-test-pace="standard"]').getAttribute("aria-checked") === "true",
  };
  await page.screenshot({ path: "output/playwright/confusions/home.png", fullPage: true });

  await page.locator('[data-test-pace="relaxed"]').click();
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("#start-test").waitFor();
  const pace = {
    persisted: await page.locator('[data-test-pace="relaxed"]').getAttribute("aria-checked") === "true",
    stored: await page.evaluate(() => JSON.parse(localStorage.getItem("marcoIeltsConfusions.v1")).settings.coldTestPace),
    detail: await page.locator(".test-pace > p").innerText(),
  };
  await page.screenshot({ path: "output/playwright/confusions/home-relaxed.png", fullPage: true });
  await page.setViewportSize({ width: 320, height: 568 });
  const compactLayout = await page.evaluate(() => ({
    noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth,
    paceTouchTarget: document.querySelector('[data-test-pace="relaxed"]').getBoundingClientRect().height >= 44,
  }));
  await page.screenshot({ path: "output/playwright/confusions/home-relaxed-320.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });

  const expectedForVisibleQuestion = async () => page.evaluate(async () => {
    const payload = await fetch("./data/confusions.json").then((response) => response.json());
    const terms = payload.groups.flatMap((group) => group.terms);
    const visibleAnswers = new Set([...document.querySelectorAll("[data-answer]")].map((element) => element.dataset.answer));
    const word = document.querySelector(".prompt-word")?.textContent.trim();
    if (word) return word;
    const meaning = document.querySelector(".prompt-meaning")?.textContent.trim();
    if (meaning) return terms.find((term) => term.meaning === meaning && visibleAnswers.has(term.term))?.term;
    const sentence = document.querySelector(".prompt-sentence")?.textContent.trim();
    return terms.find((term) => term.sentence === sentence && visibleAnswers.has(term.term))?.term;
  });

  await page.locator("#start-learning").click();
  const learningBoards = { matchingStarts: {}, recallMinimum: Infinity };
  for (let guard = 0; guard < 90; guard += 1) {
    if (await page.locator("#learning-home").count()) break;
    if (await page.locator("[data-left]").count()) {
      const boardKey = `${await page.locator(".progress-count").innerText()}:${await page.locator(".section-head h2").innerText()}`;
      if (!(boardKey in learningBoards.matchingStarts)) {
        learningBoards.matchingStarts[boardKey] = await page.locator("[data-left]").count();
      }
      const term = await page.locator("[data-left]").first().getAttribute("data-left");
      await page.locator(`[data-left="${term}"]`).click();
      await page.locator(`[data-right="${term}"]`).click();
      await page.waitForTimeout(730);
      continue;
    }
    learningBoards.recallMinimum = Math.min(learningBoards.recallMinimum, await page.locator("[data-answer]").count());
    const expected = await expectedForVisibleQuestion();
    await page.locator(`[data-answer="${expected}"]`).click();
    await page.waitForTimeout(540);
  }
  await page.locator("#learning-home").waitFor();
  const afterLearning = await page.evaluate(() => ({
    listening: localStorage.getItem("marcoIeltsListening.v1"),
    confusions: JSON.parse(localStorage.getItem("marcoIeltsConfusions.v1")),
  }));
  await page.locator("#learning-home").click();

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator("#start-test").click();
  const firstLimit = Number.parseFloat(await page.locator("#test-timer-count").innerText());
  const firstIsSentence = await page.locator(".prompt-sentence").count() > 0;
  const reducedMotionTimer = await page.locator("#test-timer-bar").evaluate((element) => Number.parseFloat(getComputedStyle(element).animationDuration));
  await page.waitForTimeout(220);
  await page.locator("#pause-test").click();
  const pausedAt = await page.locator("#test-timer-count").innerText();
  await page.waitForTimeout(500);
  const pause = {
    correctLimit: firstLimit === (firstIsSentence ? 10 : 5),
    reducedMotionTimerCorrect: reducedMotionTimer === firstLimit,
    frozen: pausedAt === await page.locator("#test-timer-count").innerText(),
    panelVisible: await page.locator("#pause-panel").isVisible(),
    questionHidden: await page.locator("#question-content").isHidden(),
  };
  await page.screenshot({ path: "output/playwright/confusions/paused.png", fullPage: true });
  await page.locator("#resume-test").click();
  pause.resumed = await page.locator("#question-content").isVisible();
  for (let index = 0; index < 12; index += 1) {
    await page.locator("[data-answer]").first().waitFor();
    const expected = await expectedForVisibleQuestion();
    if (index === 0) {
      const choices = await page.locator("[data-answer]").evaluateAll((elements, value) => elements.map((element) => element.dataset.answer).filter((answer) => answer !== value), expected);
      await page.locator(`[data-answer="${choices[0]}"]`).click();
    } else {
      await page.locator(`[data-answer="${expected}"]`).click();
    }
    await page.waitForTimeout(250);
  }
  await page.locator("#reinforce").waitFor();
  const coldBeforeReinforcement = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("marcoIeltsConfusions.v1"));
    return JSON.stringify({ testHistory: state.testHistory, termStats: state.termStats, groupStats: state.groupStats, confusionPairs: state.confusionPairs });
  });
  const result = {
    score: await page.locator(".result-score").innerText(),
    pairRows: await page.locator(".result-list").first().locator(".result-row").count(),
  };

  await page.locator("#reinforce").click();
  for (let guard = 0; guard < 30; guard += 1) {
    if (await page.locator("#reinforcement-home").count()) break;
    const expected = await expectedForVisibleQuestion();
    await page.locator(`[data-answer="${expected}"]`).click();
    await page.waitForTimeout(650);
  }
  await page.locator("#reinforcement-home").waitFor();
  const afterReinforcement = await page.evaluate((cold) => {
    const current = JSON.parse(localStorage.getItem("marcoIeltsConfusions.v1"));
    const currentCold = JSON.stringify({ testHistory: current.testHistory, termStats: current.termStats, groupStats: current.groupStats, confusionPairs: current.confusionPairs });
    return { coldUnchanged: cold === currentCold, reinforcementCount: current.reinforcement.length };
  }, coldBeforeReinforcement);
  await page.locator("#reinforcement-home").click();
  await page.locator(".back-link").click();
  await page.locator("#start").waitFor();

  const afterRaw = await page.evaluate(() => localStorage.getItem("marcoIeltsListening.v1"));
  const after = JSON.parse(afterRaw);
  const listening = {
    byteEqual: beforeRaw === afterRaw,
    deepEqual: JSON.stringify(before) === JSON.stringify(after),
    progress: JSON.stringify(before.progress) === JSON.stringify(after.progress),
    daily: JSON.stringify(before.daily) === JSON.stringify(after.daily),
    reviewDaily: JSON.stringify(before.reviewDaily) === JSON.stringify(after.reviewDaily),
    errorDaily: JSON.stringify(before.errorDaily) === JSON.stringify(after.errorDaily),
    starred: JSON.stringify(before.starred) === JSON.stringify(after.starred),
    streak: before.streak === after.streak,
    lastCompletedDate: before.lastCompletedDate === after.lastCompletedDate,
  };
  const entries = await page.evaluate(() => ({
    newWords: Boolean(document.querySelector("#start")),
    review: Boolean(document.querySelector("#review")),
    errors: Boolean(document.querySelector("#error-training")),
    starred: Boolean(document.querySelector("#starred-training")),
    directions: Boolean(document.querySelector("#direction")),
    confusions: Boolean(document.querySelector("#confusions")),
  }));
  await page.locator("#home-more summary").click();
  entries.browse = await page.locator("#browse").isVisible();

  await page.locator("#confusions").click();
  await page.locator("#start-test").waitFor();
  await page.waitForTimeout(700);
  const cacheNames = await page.evaluate(() => caches.keys());
  const cacheIsolation = {
    listening: cacheNames.includes("ielts-listening-v33"),
    confusions: cacheNames.includes("ielts-confusions-v3"),
  };
  await page.context().setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  cacheIsolation.confusionsOffline = await page.locator("#start-test").isVisible();
  await page.context().setOffline(false);

  await page.evaluate(async () => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.filter((registration) => registration.scope.includes("/confusions/")).map((registration) => registration.unregister()));
    await caches.delete("ielts-confusions-v3");
  });
  await page.route("**/confusions/data/confusions.json*", (route) => route.abort());
  await page.goto(`${baseUrl}confusions/?failure=1`, { waitUntil: "domcontentloaded" });
  await page.locator(".fatal").waitFor();
  const failure = { message: await page.locator(".fatal h2").innerText() };
  await page.unroute("**/confusions/data/confusions.json*");
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  failure.listeningStillWorks = await page.locator("#start").isVisible();

  if (entry.title !== "易混词"
    || entry.version !== "v1.1.0"
    || !entry.url.includes("/confusions/")
    || !entry.mainStorageUnchanged
    || !entry.standardPaceSelected
    || !pace.persisted
    || pace.stored !== "relaxed"
    || pace.detail !== "词义 5 秒 · 语境 10 秒"
    || Object.values(compactLayout).some((value) => value !== true)
    || Object.keys(afterLearning.confusions.learning).length !== 5
    || Object.keys(learningBoards.matchingStarts).length !== 10
    || Object.values(learningBoards.matchingStarts).some((count) => count < 4)
    || learningBoards.recallMinimum < 4
    || afterLearning.confusions.testHistory.length !== 0
    || afterLearning.listening !== beforeRaw
    || Object.values(pause).some((value) => value !== true)
    || !result.score.includes("11 / 12")
    || !result.score.includes("舒缓节奏")
    || result.pairRows < 1
    || !afterReinforcement.coldUnchanged
    || afterReinforcement.reinforcementCount !== 1
    || Object.values(listening).some((value) => value !== true)
    || Object.values(entries).some((value) => value !== true)
    || !cacheIsolation.listening
    || !cacheIsolation.confusions
    || !cacheIsolation.confusionsOffline
    || failure.message !== "易混词模块加载失败"
    || !failure.listeningStillWorks) {
    throw new Error(JSON.stringify({ entry, pace, compactLayout, pause, learningBoards, afterLearning, result, afterReinforcement, listening, entries, cacheNames, cacheIsolation, failure }));
  }

  return { ok: true, entry, pace, compactLayout, pause, learningBoards, result, afterReinforcement, listening, entries, cacheNames, cacheIsolation, failure };
}
