async (page) => {
  const root = "output/playwright/v2130";
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(async () => {
    localStorage.removeItem("marcoIeltsListening.v1");
    sessionStorage.clear();
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map((name) => caches.delete(name)));
  });
  await page.reload();
  await page.locator("#start").waitFor();
  await page.screenshot({ path: "docs/design-qa/v2.13.0/implementation.png" });

  await page.locator("#home-more summary").click();
  await page.screenshot({ path: `${root}/settings.png`, fullPage: true });
  await page.locator("#home-more summary").click();

  await page.evaluate(() => {
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const session = (keys) => ({
      date,
      baseKeys: keys,
      queue: keys.map((key) => ({ key, isRetry: false })),
      answeredBase: {},
      outcomes: {},
      retryCount: {},
      started: false,
      completed: false,
    });
    localStorage.setItem("marcoIeltsListening.v1", JSON.stringify({
      version: 3,
      progress: {},
      starred: {},
      customItems: [],
      streak: 0,
      lastCompletedDate: null,
      trainingResetId: "fresh-start-v2.5.0",
      learningReviewSplitId: "learning-review-v2.9.0",
      deckNonce: "whole-bank-v2",
      daily: session(["carpet:spelling", "carpet:recognition"]),
      reviewDaily: session([]),
      errorDaily: session(["carpet:spelling", "carpet:recognition"]),
    }));
  });
  await page.reload();
  await page.locator("#start").click();
  await page.locator("#answer").waitFor();
  await page.screenshot({ path: `${root}/spelling.png` });

  await page.locator("#answer").fill("carpett");
  await page.locator("#spelling-form").evaluate((form) => form.requestSubmit());
  await page.locator("#continue").waitFor();
  await page.screenshot({ path: `${root}/wrong-result.png` });

  await page.locator("#continue").click();
  await page.locator(".choice").first().waitFor();
  await page.screenshot({ path: `${root}/recognition.png` });
  await page.locator(".choice").filter({ hasText: "地毯" }).click();
  await page.locator(".quick-feedback").waitFor();
  await page.screenshot({ path: `${root}/correct-feedback.png` });
  await page.waitForTimeout(620);
  await page.locator("#pause-session").click();

  await page.locator("#direction").click();
  await page.locator("#direction-start").waitFor();
  await page.screenshot({ path: `${root}/direction.png` });
  await page.locator("#direction-back").click();

  await page.locator("#home-more summary").click();
  await page.locator("#browse").click();
  await page.locator(".word-card").first().waitFor();
  await page.screenshot({ path: `${root}/browse.png` });
  await page.locator("#browse-back").click();

  await page.locator("#home-more summary").click();
  await page.locator("#inbox").click();
  await page.locator("#wrong-word-input").waitFor();
  await page.screenshot({ path: `${root}/inbox.png` });

  const errors = await page.evaluate(() => ({
    viewport: { width: innerWidth, height: innerHeight },
    scrollWidth: document.documentElement.scrollWidth,
    theme: document.querySelector('meta[name="theme-color"]')?.content,
  }));
  return { ok: true, errors };
}
