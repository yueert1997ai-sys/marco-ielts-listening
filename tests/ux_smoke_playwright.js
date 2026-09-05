async (page) => {
  await page.goto('http://127.0.0.1:4173/');
  const expectedVersion = await page.evaluate(() => fetch('./version.json').then(r => r.json()).then(data => data.version));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(async () => {
    localStorage.removeItem("marcoIeltsListening.v1");
    sessionStorage.clear();
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
    const names = await caches.keys();
    await Promise.all(names.map((name) => caches.delete(name)));
  });
  await page.reload();
  await page.locator("#start").waitFor();

  const home = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    progress: document.querySelector(".home-progress-inner")?.textContent.replace(/\s+/g, " ").trim(),
    personalErrors: document.querySelector("#error-training")?.textContent.replace(/\s+/g, " ").trim(),
    version: document.querySelector("#app-version")?.textContent,
  }));

  await page.evaluate(async () => {
    const items = await fetch("./data/listening.json").then((response) => response.json());
    const keys = items.filter((item) => item.modes.includes("recognition")).slice(0, 24)
      .map((item) => `${item.id}:recognition`);
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const session = {
      date,
      baseKeys: keys,
      queue: keys.map((key) => ({ key, isRetry: false })),
      answeredBase: {}, outcomes: {}, retryCount: {}, correctStreak: {},
      started: false, completed: false,
    };
    localStorage.setItem("marcoIeltsListening.v1", JSON.stringify({
      version: 3,
      progress: {}, starred: {}, customItems: [], streak: 0, lastCompletedDate: null,
      trainingResetId: "fresh-start-v2.5.0",
      learningReviewSplitId: "learning-review-v2.9.0",
      selfAssessmentFlowId: JSON.parse(localStorage.getItem("marcoIeltsListening.v1")).selfAssessmentFlowId,
      deckNonce: "whole-bank-v2",
      daily: session,
      reviewDaily: { ...session, baseKeys: [], queue: [], completed: true },
      errorDaily: null,
      starredDaily: null,
    }));
  });
  await page.reload();
  await page.locator("#start").click();
  await page.locator(".confidence-actions").waitFor();

  const question = await page.evaluate(() => ({
    choices: document.querySelectorAll(".choice").length,
    confidenceButtons: [...document.querySelectorAll(".confidence-button")]
      .map((button) => button.textContent.replace(/\s+/g, " ").trim()),
    meaningLeaked: Boolean(document.querySelector(".meaning, .choice-meaning")),
    hasAudio: Boolean(document.querySelector("#recognition-play")),
  }));

  await page.setViewportSize({ width: 320, height: 568 });
  // Chromium acknowledges viewport changes before the next responsive layout frame.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const shortScreen = await page.locator(".confidence-button").evaluateAll((buttons) => ({
    scrollWidth: document.documentElement.scrollWidth,
    visible: buttons.filter((button) => {
      const rect = button.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= innerHeight;
    }).length,
  }));
  await page.locator(".confidence-unknown").click();
  await page.locator(".choice").first().waitFor();
  const meaningCheck = await page.evaluate(async () => {
    const term = document.querySelector(".term")?.textContent;
    const items = await fetch("./data/listening.json").then((response) => response.json());
    const expected = items.find((item) => item.term === term)?.meaning;
    return {
      term,
      choices: document.querySelectorAll(".choice").length,
      expected,
      containsAnswer: [...document.querySelectorAll(".choice")]
        .some((choice) => choice.dataset.choice === expected),
    };
  });
  await page.locator(`.choice[data-choice="${meaningCheck.expected}"]`).click();
  await page.locator("#continue").waitFor();
  const result = await page.evaluate(() => ({
    rating: document.querySelector(".result-mark")?.textContent,
    meaning: document.querySelector(".meaning")?.textContent,
    partOfSpeech: document.querySelector(".result-pos")?.textContent,
    note: document.querySelector(".note")?.textContent,
    continueVisible: (() => {
      const rect = document.querySelector("#continue")?.getBoundingClientRect();
      return Boolean(rect && rect.top >= 0 && rect.bottom <= innerHeight);
    })(),
  }));
  const retry = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("marcoIeltsListening.v1"));
    const key = state.daily.baseKeys[0];
    return {
      index: state.daily.queue.findIndex((entry) => entry.key === key && entry.isRetry),
      count: state.daily.retryCount[key],
    };
  });
  await page.locator("#continue").click();
  let retryQuestion = null;
  for (let index = 0; index < 13; index += 1) {
    await page.locator(".confidence-actions").waitFor();
    const current = await page.evaluate(() => ({
      term: document.querySelector(".term")?.textContent,
      meta: document.querySelector(".session-meta")?.textContent,
      buttons: [...document.querySelectorAll(".confidence-button")]
        .map((button) => button.textContent.replace(/\s+/g, " ").trim()),
    }));
    if (current.term === meaningCheck.term && current.meta.includes("回炉题")) {
      retryQuestion = current;
      break;
    }
    await page.locator(".confidence-known").click();
    await page.locator("#continue").waitFor();
    await page.locator("#continue").click();
  }

  const audio = await page.evaluate(async () => {
    const ids = ["dispose", "erect", "resurface", "standardise", "tether"];
    const results = [];
    for (const id of ids) {
      const element = new Audio(`./audio/${id}.mp3`);
      const loaded = await new Promise((resolve) => {
        element.addEventListener("canplaythrough", () => resolve(true), { once: true });
        element.addEventListener("error", () => resolve(false), { once: true });
        setTimeout(() => resolve(false), 5000);
        element.load();
      });
      results.push({ id, loaded, duration: element.duration });
    }
    return results;
  });

  if (home.width > 390
    || !home.progress.includes("0 / 50")
    || !home.personalErrors.includes("词")
    || home.version !== expectedVersion
    || question.choices !== 0
    || question.confidenceButtons.length !== 2
    || !question.confidenceButtons.some((label) => label.startsWith("认识"))
    || !question.confidenceButtons.some((label) => label.startsWith("不认识"))
    || question.meaningLeaked
    || !question.hasAudio
    || shortScreen.scrollWidth > 320
    || shortScreen.visible !== 2
    || meaningCheck.choices !== 4
    || !meaningCheck.containsAnswer
    || result.rating !== "不认识 · 已确认释义"
    || !result.meaning
    || !result.partOfSpeech
    || !result.note.includes("8–12 题后")
    || !result.continueVisible
    || retry.index < 8
    || retry.index > 12
    || retry.count !== 1
    || !retryQuestion
    || retryQuestion.buttons.length !== 2
    || !retryQuestion.buttons.some((label) => label.startsWith("认识"))
    || !retryQuestion.buttons.some((label) => label.startsWith("不认识"))
    || audio.some((item) => !item.loaded || !Number.isFinite(item.duration) || item.duration <= 0)) {
    throw new Error(JSON.stringify({ home, question, shortScreen, meaningCheck, result, retry, retryQuestion, audio }));
  }

  return { ok: true, home, question, shortScreen, meaningCheck, result, retry, retryQuestion, audio };
}
