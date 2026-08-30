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
  await page.locator(".choice").first().waitFor();
  const posLabels = await page.locator(".choice-pos").allTextContents();
  const correctChoice = page.locator(".choice").filter({ hasText: pool.recognition.meaning });
  await correctChoice.click();
  await page.locator(".quick-feedback").waitFor();
  const recognitionFeedback = await page.locator(".quick-feedback").evaluate((feedback) => ({
    meaning: feedback.querySelector("strong")?.textContent,
    fontSize: Number.parseFloat(getComputedStyle(feedback.querySelector("strong")).fontSize),
    background: getComputedStyle(feedback).backgroundColor,
  }));
  const correctChoiceStyle = await correctChoice.evaluate((choice) => ({
    color: getComputedStyle(choice).color,
    background: getComputedStyle(choice).backgroundColor,
    opacity: getComputedStyle(choice).opacity,
  }));
  await page.screenshot({ path: "output/playwright/v2140/recognition-meaning-feedback.png" });

  const expected = [...pool.expectedKeys].sort();
  const actual = [...pool.actualKeys].sort();
  const allowedPos = new Set(["n", "v", "adj", "adv", "prep", "phr", "abbr", "n/v", "aux", "—"]);
  if (pool.words !== 52
    || pool.buttonDisabled
    || !pool.buttonText.includes("我的错词训练")
    || !pool.buttonText.includes("52 词")
    || JSON.stringify(actual) !== JSON.stringify(expected)
    || spellingFeedback.meaning !== pool.spelling.meaning
    || spellingFeedback.fontSize < 20
    || spellingFeedback.background !== "rgb(52, 199, 89)"
    || spellingFeedback.height < 68
    || recognitionFeedback.meaning !== pool.recognition.meaning
    || recognitionFeedback.fontSize < 20
    || recognitionFeedback.background !== "rgb(52, 199, 89)"
    || correctChoiceStyle.color !== "rgb(255, 255, 255)"
    || correctChoiceStyle.background !== "rgb(52, 199, 89)"
    || correctChoiceStyle.opacity !== "1"
    || posLabels.length !== 4
    || posLabels.some((label) => !allowedPos.has(label.trim()))) {
    throw new Error(JSON.stringify({ pool, spellingFeedback, recognitionFeedback, correctChoiceStyle, posLabels }));
  }

  return { ok: true, pool: { words: pool.words, tasks: pool.actualKeys.length, buttonText: pool.buttonText }, spellingFeedback, recognitionFeedback, correctChoiceStyle, posLabels };
}
