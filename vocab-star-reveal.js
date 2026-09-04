(function () {
  "use strict";

  const screen = document.getElementById("screen");
  if (!screen || typeof MutationObserver === "undefined") return;

  let vocabStarButton = null;

  function syncVocabRevealStar() {
    const vocabCard = screen.querySelector(".question-card.vocab-card");
    const currentStar = screen.querySelector(".session-toolbar .session-star");
    if (vocabCard && currentStar) {
      vocabStarButton = currentStar;
      return;
    }

    const revealCard = screen.querySelector(".vocab-reveal-card");
    const toolbar = screen.querySelector(".result-toolbar");
    const modeLabel = toolbar?.querySelector(".mode-label");
    if (!revealCard || !toolbar || !modeLabel || !vocabStarButton) return;
    if (toolbar.querySelector(".session-star")) return;

    modeLabel.replaceWith(vocabStarButton);
  }

  const observer = new MutationObserver(syncVocabRevealStar);
  observer.observe(screen, { childList: true, subtree: true });
  syncVocabRevealStar();
})();
