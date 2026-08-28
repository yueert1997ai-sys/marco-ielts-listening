async (page) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Network.clearBrowserCache");
  const advanceUntil = async (selector, limit = 30) => {
    for (let index = 0; index < limit; index += 1) {
      if (await page.locator(selector).count()) return true;
      if (await page.locator("#continue").count()) await page.locator("#continue").click();
      else if (await page.locator("#spelling-dont-know").count()) await page.locator("#spelling-dont-know").click();
      else if (await page.locator("#recognition-dont-know").count()) await page.locator("#recognition-dont-know").click();
      await page.waitForTimeout(40);
    }
    return false;
  };

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
    scrollHeight: document.documentElement.scrollHeight,
    moreOpen: document.querySelector("#home-more")?.open,
    coreActions: document.querySelectorAll(".home-task").length,
  }));
  home.browseVisible = await page.locator("#browse").isVisible();
  await page.screenshot({ path: "output/playwright/v2113/home.png" });
  await page.locator("#home-more summary").click();
  home.moreEntriesVisible = await page.locator("#error-training, #browse, #starred, #inbox, #export, #reset-training")
    .evaluateAll((entries) => entries.every((entry) => entry.getClientRects().length > 0));
  await page.screenshot({ path: "output/playwright/v2113/home-more.png", fullPage: true });
  await page.locator("#home-more summary").click();
  await page.locator("#start").click();

  if (!await advanceUntil("#answer")) throw new Error("Could not reach a spelling question");
  const trainingChrome = await page.evaluate(() => ({
    active: document.querySelector("#app")?.classList.contains("active-session"),
    versionVisible: Boolean(document.querySelector("#app-version")?.getClientRects().length),
    meta: document.querySelector(".session-meta")?.textContent.trim(),
  }));
  const spelling = await page.locator("#answer").evaluate((input) => ({
    focused: document.activeElement === input,
    top: Math.round(input.getBoundingClientRect().top),
    bottom: Math.round(input.getBoundingClientRect().bottom),
  }));
  await page.locator("#answer").fill("wrong");
  await page.locator("#spelling-form").evaluate((form) => form.requestSubmit());
  await page.locator("#continue").waitFor();
  const wrongResult = {
    note: await page.locator(".note").innerText(),
    continueVisible: await page.locator("#continue").isVisible(),
  };
  await page.locator("#continue").click();

  if (!await advanceUntil(".choice")) throw new Error("Could not reach a recognition question");
  const correctMeaning = await page.evaluate(async () => {
    const term = document.querySelector(".term")?.textContent;
    const items = await fetch("./data/listening.json").then((response) => response.json());
    return items.find((item) => item.term === term)?.meaning;
  });
  const choicePartsOfSpeech = await page.locator(".choice-pos").allTextContents();
  const countBefore = await page.locator("#day-count").innerText();
  await page.locator(".choice").filter({ hasText: correctMeaning }).click();
  await page.waitForTimeout(100);
  const quickPass = {
    feedback: await page.locator(".quick-feedback").innerText(),
    resultVisible: await page.locator(".result").count() > 0,
  };
  await page.screenshot({ path: "output/playwright/v2113/quick-pass.png" });
  await page.waitForTimeout(600);
  quickPass.advanced = await page.locator(".question-card").count() > 0;
  quickPass.feedbackGone = await page.locator(".quick-feedback").count() === 0;
  quickPass.countChanged = countBefore !== await page.locator("#day-count").innerText();

  if (!await advanceUntil(".choice")) throw new Error("Could not reach a short-screen recognition question");
  await page.setViewportSize({ width: 320, height: 568 });
  await page.waitForTimeout(80);
  const shortRecognition = await page.locator(".choice, #recognition-dont-know").evaluateAll((controls) => ({
    count: controls.length,
    fullyVisible: controls.filter((control) => {
      const rect = control.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= innerHeight;
    }).length,
    scrollHeight: document.documentElement.scrollHeight,
  }));
  await page.screenshot({ path: "output/playwright/v2113/short-question.png" });
  await page.locator("#recognition-dont-know").click();
  await page.locator("#continue").waitFor();
  shortRecognition.resultContinueVisible = await page.locator("#continue").evaluate((button) => {
    const rect = button.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= innerHeight;
  });
  await page.screenshot({ path: "output/playwright/v2113/short-result.png" });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const session = (keys) => ({
      date,
      baseKeys: keys,
      queue: keys.map((key) => ({ key, isRetry: false })),
      answeredBase: {}, outcomes: {}, retryCount: {}, started: true, completed: false,
    });
    localStorage.setItem("marcoIeltsListening.v1", JSON.stringify({
      version: 3,
      progress: {}, starred: {}, customItems: [], streak: 0, lastCompletedDate: null,
      trainingResetId: "fresh-start-v2.5.0",
      learningReviewSplitId: "learning-review-v2.9.0",
      deckNonce: "whole-bank-v2",
      daily: session(["carpet:recognition", "carpet:spelling"]),
      reviewDaily: session([]),
      errorDaily: session(["carpet:recognition", "carpet:spelling"]),
    }));
  });
  await page.reload();
  await page.locator("#start").click();
  await page.locator(".choice").filter({ hasText: "地毯" }).click();
  const keyboardPrimed = await page.locator(".keyboard-primer").count() === 1;
  await page.locator("#answer").waitFor();
  const switchedSpellingFocused = await page.locator("#answer").evaluate((input) => document.activeElement === input);
  await page.locator("#answer").fill("carpet");
  await page.locator("#spelling-form").evaluate((form) => form.requestSubmit());
  const correctSpellingFeedback = await page.locator(".quick-feedback").innerText();

  if (home.scrollHeight > 844
    || home.moreOpen
    || home.browseVisible
    || !home.moreEntriesVisible
    || home.coreActions !== 2
    || !trainingChrome.active
    || trainingChrome.versionVisible
    || !["听写", "识义"].includes(trainingChrome.meta)
    || !spelling.focused
    || wrongResult.note.trim().startsWith("—")
    || !wrongResult.continueVisible
    || !quickPass.feedback.includes("正确")
    || quickPass.resultVisible
    || !quickPass.advanced
    || !quickPass.feedbackGone
    || !quickPass.countChanged
    || choicePartsOfSpeech.length !== 4
    || choicePartsOfSpeech.some((label) => !label.trim() || label.includes("待补"))
    || shortRecognition.count !== 5
    || shortRecognition.fullyVisible !== 5
    || !shortRecognition.resultContinueVisible
    || !keyboardPrimed
    || !switchedSpellingFocused
    || !correctSpellingFeedback.includes("地毯")) {
    throw new Error(JSON.stringify({ home, trainingChrome, spelling, wrongResult, quickPass, choicePartsOfSpeech, shortRecognition, keyboardPrimed, switchedSpellingFocused, correctSpellingFeedback }));
  }

  return { ok: true, home, trainingChrome, spelling, wrongResult, quickPass, choicePartsOfSpeech, shortRecognition, keyboardPrimed, switchedSpellingFocused, correctSpellingFeedback };
}
