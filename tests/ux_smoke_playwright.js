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
  await page.locator("#start").click();

  if (!await advanceUntil("#answer")) throw new Error("Could not reach a spelling question");
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
  const countBefore = await page.locator("#day-count").innerText();
  await page.locator(".choice").filter({ hasText: correctMeaning }).click();
  await page.waitForTimeout(100);
  const quickPass = {
    feedback: await page.locator(".quick-feedback").innerText(),
    resultVisible: await page.locator(".result").count() > 0,
  };
  await page.screenshot({ path: ".tools/ux-v2104-quick-pass.png" });
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
  await page.screenshot({ path: ".tools/ux-v2104-short-question.png" });
  await page.locator("#recognition-dont-know").click();
  await page.locator("#continue").waitFor();
  shortRecognition.resultContinueVisible = await page.locator("#continue").evaluate((button) => {
    const rect = button.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= innerHeight;
  });
  await page.screenshot({ path: ".tools/ux-v2104-short-result.png" });

  if (!spelling.focused
    || wrongResult.note.trim().startsWith("—")
    || !wrongResult.continueVisible
    || !quickPass.feedback.includes("正确")
    || quickPass.resultVisible
    || !quickPass.advanced
    || !quickPass.feedbackGone
    || !quickPass.countChanged
    || shortRecognition.count !== 5
    || shortRecognition.fullyVisible !== 5
    || !shortRecognition.resultContinueVisible) {
    throw new Error(JSON.stringify({ spelling, wrongResult, quickPass, shortRecognition }));
  }

  return { ok: true, spelling, wrongResult, quickPass, shortRecognition };
}
