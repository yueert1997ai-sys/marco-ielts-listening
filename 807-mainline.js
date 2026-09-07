(function () {
  "use strict";

  const STORAGE_KEY = "marcoIelts807.v1";
  const TERMS_CACHE_KEY = "marcoIelts807.terms.v1";
  const screen = document.getElementById("screen");

  function icon(name) {
    return `<i class="ph ph-${name}" aria-hidden="true"></i>`;
  }

  function stats() {
    let seen = 0;
    let wrong = 0;
    let total = 0;
    try {
      const state = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      seen = Object.values(state?.records || {}).filter((record) => (record?.attempts || 0) > 0).length;
      wrong = Object.keys(state?.wrongTerms || {}).length;
      const cache = JSON.parse(localStorage.getItem(TERMS_CACHE_KEY) || "{}");
      total = Array.isArray(cache?.terms) ? cache.terms.length : 0;
    } catch (_error) {
      // Keep zeroed stats when local storage is unavailable.
    }
    return { seen, wrong, total };
  }

  function installStyle() {
    if (document.getElementById("vocab807-mainline-style")) return;
    const style = document.createElement("style");
    style.id = "vocab807-mainline-style";
    style.textContent = `
      .vocab-path.vocab807-path { grid-column: 1 / -1; color: var(--ink); text-decoration: none; }
      .vocab-path.vocab807-path .home-task-icon { color: #0a84ff; background: #eaf4ff; border-radius: 10px; }
      .vocab-path.vocab807-path .home-task-copy small { min-height: auto; }
      @media (max-width: 359px) { .vocab-path.vocab807-path { grid-column: auto; } }
    `;
    document.head.appendChild(style);
  }

  function renderCard() {
    installStyle();
    const grid = screen?.querySelector(".home-vocab-grid");
    if (!grid) return;
    let card = document.getElementById("vocab-807");
    const { seen, wrong, total } = stats();
    if (!card) {
      card = document.createElement("a");
      card.id = "vocab-807";
      card.className = "home-task vocab-path vocab807-path";
      card.href = "./807/";
      card.innerHTML = `
        <span class="home-task-icon">${icon("headphones")}</span>
        <span class="home-task-copy"><strong>807 听写</strong><small></small></span>
        <span class="vocab-path-progress"><b data-807-seen></b><span>/</span><b data-807-total></b></span>`;
      grid.appendChild(card);
    }
    const description = wrong
      ? `王陆807 · 听音拼写 · ${wrong} 个错词待复练`
      : "王陆807 · 听音拼写 · 独立训练进度";
    card.querySelector(".home-task-copy small").textContent = description;
    card.querySelector("[data-807-seen]").textContent = String(seen);
    card.querySelector("[data-807-total]").textContent = total ? String(total) : "807";
  }

  if (!screen) return;
  const observer = new MutationObserver(renderCard);
  observer.observe(screen, { childList: true, subtree: true });
  window.addEventListener("pageshow", renderCard);
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY || event.key === TERMS_CACHE_KEY) renderCard();
  });
  renderCard();
})();
