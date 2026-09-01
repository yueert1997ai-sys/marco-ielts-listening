async (page) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://127.0.0.1:4173/?test=personal-errors-feedback", { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    localStorage.removeItem("marcoIeltsListening.v1");
    sessionStorage.clear();
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map((name) => caches.delete(name)));
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("#error-training").waitFor();
  await page.screenshot({ path: "output/playwright/v2140/personal-errors-home.png" });

  const pool = await page.evaluate(async () => {
    const items = await fetch("./data/listening.json").then((response) => response.json());
    const personal = items.filter((item) => item.sourceType === "user");
    const expectedKeys = personal.flatMap((item) => item.modes.map((mode) => `${item.id}:${mode}`));
    const state = JSON.parse(localStorage.getItem("marcoIeltsListening.v1"));
    return {
      words: personal.length,
      expectedKeys,
      actualKeys: state.errorDaily.baseKeys,
      buttonText: document.querySelector("#error-training")?.textContent.replace(/\s+/g, " ").trim(),
      buttonDisabled: document.querySelector("#error-training")?.disabled,
      spelling: personal.find((item) => item.modes.includes("spelling")),
      recognition: personal.find((item) => item.modes.includes("recognition")),
    };
  });

  const setOnlyQuestion = async (key) => page.evaluate((activityKey) => {
    const state = JSON.parse(localStorage.getItem("marcoIeltsListening.v1"));
    state.errorDaily.queue = [{ key: activityKey, isRetry: false }];
    state.errorDaily.answeredBase = {};
    state.errorDaily.outcomes = {};
    state.errorDaily.retryCount = {};
    state.errorDaily.correctStreak = {};
    state.errorDaily.completed = false;
    localStorage.setItem("marcoIeltsListening.v1", JSON.stringify(state));
  }, key);

  await setOnlyQuestion(`${pool.spelling.id}:spelling`);
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("#error-training").click();
  await page.locator("#answer").fill(pool.spelling.term);
  await page.locator("#spelling-form").evaluate((form) => form.requestSubmit());
  await page.locator(".quick-feedback").waitFor();
  const spellingFeedback = await page.locator(".quick-feedback").evaluate((feedback) => ({
    meaning: feedback.querySelector("strong")?.textContent,
    status: feedback.querySelector("small")?.textContent,
    fontSize: Number.parseFloat(getComputedStyle(feedback.querySelector("strong")).fontSize),
    background: getComputedStyle(feedback).backgroundColor,
    height: Math.round(feedback.getBoundingClientRect().height),
  }));
  await page.screenshot({ path: "output/playwright/v2140/spelling-meaning-feedback.png" });

  await setOnlyQuestion(`${pool.recognition.id}:recognition`);
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("#error-training").click();
  await page.locator(".confidence-actions").waitFor();
  const confidenceLabels = await page.locator(".confidence-button").allTextContents();
  await page.locator(".confidence-known").click();
  await page.locator(".result-card").waitFor();
  const recognitionFeedback = await page.locator(".result-card").evaluate((result) => ({
    rating: result.querySelector(".result-mark")?.textContent,
    meaning: result.querySelector(".meaning")?.textContent,
    partOfSpeech: result.querySelector(".result-pos")?.textContent,
    fontSize: Number.parseFloat(getComputedStyle(result.querySelector(".meaning")).fontSize),
    background: getComputedStyle(result).backgroundColor,
  }));
  await page.screenshot({ path: "output/playwright/v2140/recognition-meaning-feedback.png" });

  const expected = [...pool.expectedKeys].sort();
  const actual = [...pool.actualKeys].sort();
  if (pool.buttonDisabled
    || !pool.buttonText.includes("我的错词训练")
    || !pool.buttonText.includes(`${pool.words} 词`)
    || JSON.stringify(actual) !== JSON.stringify(expected)
    || spellingFeedback.meaning !== pool.spelling.meaning
    || spellingFeedback.fontSize < 20
    || spellingFeedback.background !== "rgb(52, 199, 89)"
    || spellingFeedback.height < 68
    || recognitionFeedback.meaning !== pool.recognition.meaning
    || !recognitionFeedback.partOfSpeech
    || recognitionFeedback.fontSize < 20
    || recognitionFeedback.background !== "rgb(255, 255, 255)"
    || recognitionFeedback.rating?.trim() !== "认识"
    || confidenceLabels.length !== 2
    || !confidenceLabels.some((label) => label.includes("认识"))
    || !confidenceLabels.some((label) => label.includes("不认识"))) {
    throw new Error(JSON.stringify({ pool, spellingFeedback, recognitionFeedback, confidenceLabels }));
  }

  return { ok: true, pool: { words: pool.words, tasks: pool.actualKeys.length, buttonText: pool.buttonText }, spellingFeedback, recognitionFeedback, confidenceLabels };
}
