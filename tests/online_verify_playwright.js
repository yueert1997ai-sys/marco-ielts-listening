async (page) => {
  const liveUrl = "https://yueert1997ai-sys.github.io/marco-ielts-listening/?verify=v2.13.0";
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
      fetch("./version.json?verify=v2.13.0").then((response) => response.json()),
      fetch("./sw.js?verify=v2.13.0").then((response) => response.text()),
      fetch("./manifest.webmanifest?verify=v2.13.0").then((response) => response.json()),
      fetch("./vendor/phosphor/phosphor-regular.css?verify=v2.13.0"),
      fetch("./vendor/phosphor/Phosphor.woff2?verify=v2.13.0"),
    ]);
    return {
      version,
      swVersion: serviceWorker.includes('const APP_VERSION = "v2.13.0"'),
      cacheVersion: serviceWorker.includes('CACHE = "ielts-listening-v28"'),
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
  const feedback = await page.locator(".quick-feedback").innerText();
  await page.waitForTimeout(650);
  const spellingFocused = await page.locator("#answer").evaluate((input) => document.activeElement === input);
  await page.locator("#pause-session").click();

  await page.locator("#direction").click();
  const directionTargets = await page.locator(".direction-target-preview").count();
  await page.locator("#direction-back").click();
  await page.locator("#home-more summary").click();
  await page.locator("#browse").click();
  await page.locator(".word-card").first().waitFor();
  const browseCards = await page.locator(".word-card").count();

  if (release.version.version !== "v2.13.0"
    || release.version.releasedAt !== "2026-08-29"
    || !release.swVersion
    || !release.cacheVersion
    || release.manifest.theme_color.toLowerCase() !== "#f2f2f7"
    || !release.iconCss
    || !release.iconFont
    || home.title !== "IELTS LISTENING"
    || !home.progress.includes("0 / 50")
    || home.background !== "rgb(242, 242, 247)"
    || home.width > 390
    || !feedback.includes("正确")
    || !spellingFocused
    || directionTargets !== 8
    || browseCards !== 20) {
    throw new Error(JSON.stringify({ release, home, feedback, spellingFocused, directionTargets, browseCards }));
  }

  return { ok: true, release, home, feedback, spellingFocused, directionTargets, browseCards };
}
