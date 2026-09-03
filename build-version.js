(async function () {
  "use strict";

  const badge = document.getElementById("home-build-version");
  if (!badge) return;

  try {
    const response = await fetch(`./version.json?badge=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const info = await response.json();
    const appVersion = info.version || "未知版本";
    const contentRevision = info.contentRevision ? ` · ${info.contentRevision}` : "";
    badge.textContent = `${appVersion}${contentRevision}`;
    badge.setAttribute("aria-label", `当前发布版本 ${appVersion}${contentRevision}`);
    if (info.contentUpdatedAt) badge.title = `词库更新：${info.contentUpdatedAt}`;
  } catch (_) {
    badge.title = "版本信息暂时无法刷新";
  }
})();
