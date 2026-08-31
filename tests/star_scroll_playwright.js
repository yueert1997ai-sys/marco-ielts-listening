async (page) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://127.0.0.1:4173/?test=star-scroll", { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    localStorage.removeItem("marcoIeltsListening.v1");
    sessionStorage.clear();
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map((name) => caches.delete(name)));
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("#home-more summary").click();
  await page.locator("#browse").click();
  await page.locator(".word-card").nth(8).scrollIntoViewIfNeeded();

  const button = page.locator(".word-card").nth(8).locator(".star-button");
  const before = await page.evaluate(() => window.scrollY);
  await button.click();
  await page.waitForTimeout(80);
  const afterStar = await page.evaluate(() => window.scrollY);
  const starred = await button.evaluate((element) => ({
    active: element.classList.contains("active"),
    pressed: element.getAttribute("aria-pressed"),
    label: element.getAttribute("aria-label"),
    cardStarred: element.closest(".word-card")?.classList.contains("starred"),
    tag: element.closest(".word-card")?.querySelector("[data-star-tag]")?.textContent,
  }));

  await button.click();
  await page.waitForTimeout(80);
  const afterUnstar = await page.evaluate(() => window.scrollY);
  const unstarred = await button.evaluate((element) => ({
    active: element.classList.contains("active"),
    pressed: element.getAttribute("aria-pressed"),
    label: element.getAttribute("aria-label"),
    cardStarred: element.closest(".word-card")?.classList.contains("starred"),
    tagPresent: Boolean(element.closest(".word-card")?.querySelector("[data-star-tag]")),
  }));

  await page.locator('[data-filter="errors"]').click();
  const errorCard = page.locator(".word-card").nth(8);
  await errorCard.scrollIntoViewIfNeeded();
  const errorButton = errorCard.locator(".star-button");
  const errorBefore = await page.evaluate(() => window.scrollY);
  await errorButton.click();
  await page.waitForTimeout(80);
  const errorAfter = await page.evaluate(() => window.scrollY);
  await errorButton.click();

  await page.evaluate(async () => {
    const state = JSON.parse(localStorage.getItem("marcoIeltsListening.v1"));
    const items = await fetch("./data/listening.json").then((response) => response.json());
    state.starred = Object.fromEntries(items.slice(0, 20).map((item) => [item.id, true]));
    localStorage.setItem("marcoIeltsListening.v1", JSON.stringify(state));
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("#home-more summary").click();
  await page.locator("#starred").click();
  await page.locator(".word-card").nth(8).scrollIntoViewIfNeeded();
  const filteredBefore = await page.evaluate(() => window.scrollY);
  await page.locator(".word-card").nth(8).locator(".star-button").click();
  await page.waitForTimeout(80);
  const filteredAfter = await page.evaluate(() => window.scrollY);
  const filteredCount = await page.locator(".word-card").count();

  const maxShift = Math.max(
    Math.abs(afterStar - before),
    Math.abs(afterUnstar - afterStar),
    Math.abs(errorAfter - errorBefore),
    Math.abs(filteredAfter - filteredBefore),
  );
  if (before < 300
    || maxShift > 2
    || !starred.active
    || starred.pressed !== "true"
    || starred.label !== "取消重点"
    || !starred.cardStarred
    || starred.tag !== "重点"
    || unstarred.active
    || unstarred.pressed !== "false"
    || unstarred.label !== "标为重点"
    || unstarred.cardStarred
    || unstarred.tagPresent
    || errorBefore < 300
    || filteredBefore < 300
    || filteredCount !== 19) {
    throw new Error(JSON.stringify({ before, afterStar, afterUnstar, errorBefore, errorAfter, filteredBefore, filteredAfter, filteredCount, maxShift, starred, unstarred }));
  }

  return { ok: true, before, afterStar, afterUnstar, errorBefore, errorAfter, filteredBefore, filteredAfter, filteredCount, maxShift, starred, unstarred };
}
