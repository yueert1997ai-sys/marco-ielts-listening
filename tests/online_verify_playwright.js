async (page) => {
  const liveUrl = "https://yueert1997ai-sys.github.io/marco-ielts-listening/?verify=v2.14.0";
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(liveUrl, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    localStorage.removeItem("marcoIeltsListening.v1");
    sessionStorage.clear();
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("#start").waitFor();

  const release = await page.evaluate(async () => {
    const [version, serviceWorker, manifest, iconCss, iconFont] = await Promise.all([
      fetch("./version.json?verify=v2.14.0").then((response) => response.json()),
      fetch("./sw.js?verify=v2.14.0").then((response) => response.text()),
      fetch("./manifest.webmanifest?verify=v2.14.0").then((response) => response.json()),
      fetch("./vendor/phosphor/phosphor-regular.css?verify=v2.14.0"),
      fetch("./vendor/phosphor/Phosphor.woff2?verify=v2.14.0"),
    ]);
    return {
      version,
      swVersion: serviceWorker.includes('const APP_VERSION = "v2.14.0"'),
      cacheVersion: serviceWorker.includes('CACHE = "ielts-listening-v30"'),
      manifest,
      iconCss: iconCss.ok,
      iconFont: iconFont.ok,
    };
  });
  const home = await page.evaluate(() => ({
    title: document.querySelector(".app-title")?.textContent,
    progress: document.querySelector(".home-progress-inner")?.textContent.replace(/\s+/g, " ").trim(),
    background: getComputedStyle(document.body).backgroundColor,
    width: document.documentElement.scrollWidth,
    personalErrors: document.querySelector("#error-training")?.textContent.replace(/\s+/g, " ").trim(),
  }));

  await page.evaluate(() => {
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const session = (keys) => ({
      date,
      baseKeys: keys,
      queue: keys.map((key) => ({ key, isRetry: false })),
      answeredBase: {}, outcomes: {}, retryCount: {}, started: false, completed: false,
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
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("#start").click();
  await page.locator(".choice").filter({ hasText: "地毯" }).click();
  const feedback = await page.locator(".quick-feedback").evaluate((element) => ({
    text: element.innerText,
    meaning: element.querySelector("strong")?.textContent,
    fontSize: Number.parseFloat(getComputedStyle(element.querySelector("strong")).fontSize),
    background: getComputedStyle(element).backgroundColor,
  }));
  await page.waitForTimeout(850);
  const spellingFocused = await page.locator("#answer").evaluate((input) => document.activeElement === input);
  await page.locator("#pause-session").click();

  await page.locator("#direction").click();
  const directionTargets = await page.locator(".direction-target-preview").count();
  await page.locator("#direction-back").click();
  await page.locator("#home-more summary").click();
  await page.locator("#browse").click();
  await page.locator(".word-card").first().waitFor();
  const browseCards = await page.locator(".word-card").count();
  await page.locator(".word-card").nth(8).scrollIntoViewIfNeeded();
  const liveStarButton = page.locator(".word-card").nth(8).locator(".star-button");
  const starScroll = { before: await page.evaluate(() => window.scrollY) };
  await liveStarButton.click();
  starScroll.afterStar = await page.evaluate(() => window.scrollY);
  starScroll.active = await liveStarButton.getAttribute("aria-pressed");
  await liveStarButton.click();
  starScroll.afterUnstar = await page.evaluate(() => window.scrollY);
  starScroll.inactive = await liveStarButton.getAttribute("aria-pressed");
  starScroll.maxShift = Math.max(
    Math.abs(starScroll.afterStar - starScroll.before),
    Math.abs(starScroll.afterUnstar - starScroll.afterStar),
  );

  if (release.version.version !== "v2.14.0"
    || release.version.releasedAt !== "2026-08-30"
    || !release.swVersion
    || !release.cacheVersion
    || release.manifest.theme_color.toLowerCase() !== "#f2f2f7"
    || !release.iconCss
    || !release.iconFont
    || home.title !== "IELTS LISTENING"
    || !home.progress.includes("0 / 50")
    || home.background !== "rgb(242, 242, 247)"
    || home.width > 390
    || !home.personalErrors.includes("我的错词训练")
    || !home.personalErrors.includes("52 词")
    || feedback.meaning !== "地毯"
    || feedback.fontSize < 20
    || feedback.background !== "rgb(52, 199, 89)"
    || !spellingFocused
    || directionTargets !== 8
    || browseCards !== 20
    || starScroll.before < 300
    || starScroll.maxShift > 2
    || starScroll.active !== "true"
    || starScroll.inactive !== "false") {
    throw new Error(JSON.stringify({ release, home, feedback, spellingFocused, directionTargets, browseCards, starScroll }));
  }

  return { ok: true, release, home, feedback, spellingFocused, directionTargets, browseCards, starScroll };
}
