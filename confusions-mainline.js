(function () {
  "use strict";

  const STORAGE_KEY = "marcoIeltsConfusionsFlash.v1";
  const TOTAL_TERMS = 84;
  const screen = document.getElementById("screen");

  function icon(name) {
    return `<i class="ph ph-${name}" aria-hidden="true"></i>`;
  }

  function flashStats() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      const stats = parsed && typeof parsed.stats === "object" && parsed.stats ? parsed.stats : {};
      const seen = Object.values(stats).filter((stat) => (stat?.attempts || 0) > 0).length;
      const mastered = Object.values(stats).filter((stat) => (stat?.mastery || 0) >= 2).length;
      return { seen, mastered };
    } catch (_error) {
      return { seen: 0, mastered: 0 };
    }
  }

  function installStyle() {
    if (document.getElementById("confusions-mainline-style")) return;
    const style = document.createElement("style");
    style.id = "confusions-mainline-style";
    style.textContent = `
      .vocab-path.confusion-path { grid-column: 1 / -1; color: var(--ink); text-decoration: none; }
      .vocab-path.confusion-path .home-task-icon { color: #5856d6; background: #eeedff; border-radius: 10px; }
      .vocab-path.confusion-path .home-task-copy small { min-height: auto; }
      @media (max-width: 359px) { .vocab-path.confusion-path { grid-column: auto; } }
    `;
    document.head.appendChild(style);
  }

  function enhanceAdvancedEntry() {
    const advanced = document.getElementById("confusions");
    if (!advanced) return;
    const title = advanced.querySelector("strong");
    const copy = advanced.querySelector("small");
    if (title) title.textContent = "易混辨析";
    if (copy) copy.textContent = "匹配 · 冷测 · 错词强化";
  }

  function renderCard() {
    installStyle();
    const grid = screen?.querySelector(".home-vocab-grid");
    if (!grid) return;
    let card = document.getElementById("vocab-confusions");
    const { seen, mastered } = flashStats();
    if (!card) {
      card = document.createElement("a");
      card.id = "vocab-confusions";
      card.className = "home-task vocab-path confusion-path";
      card.href = "./confusions/?mode=flash";
      grid.appendChild(card);
    }
    card.innerHTML = `
      <span class="home-task-icon">${icon("intersect-three")}</span>
      <span class="home-task-copy"><strong>易混词</strong><small>专练长得像、意思容易串的词 · ${mastered} 个较熟练</small></span>
      <span class="vocab-path-progress"><b>${seen}</b><span>/</span><b>${TOTAL_TERMS}</b></span>`;
    enhanceAdvancedEntry();
  }

  if (!screen) return;
  const observer = new MutationObserver(renderCard);
  observer.observe(screen, { childList: true, subtree: true });
  window.addEventListener("pageshow", renderCard);
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY) renderCard();
  });
  renderCard();
})();
