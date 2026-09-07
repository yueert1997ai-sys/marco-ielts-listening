(function () {
  "use strict";

  const logic = window.ConfusionsFlashLogic;
  const screen = document.getElementById("screen");
  const screenLabel = document.getElementById("screen-label");
  const params = new URLSearchParams(window.location.search);
  const isFlashMode = params.get("mode") === "flash";
  let groups = [];
  let state = null;

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function icon(name) {
    return `<i class="ph ph-${escapeHtml(name)}" aria-hidden="true"></i>`;
  }

  function installStyles() {
    if (document.getElementById("confusions-flash-styles")) return;
    const style = document.createElement("style");
    style.id = "confusions-flash-styles";
    style.textContent = `
      .flash-card { min-height: 460px; display: flex; flex-direction: column; }
      .flash-word-zone { margin: 32px 0 20px; text-align: center; }
      .flash-word-zone .prompt-word { margin-inline: auto; }
      .flash-group { margin-top: 8px; color: var(--muted); font-size: 11px; }
      .flash-speak { margin: 10px auto 0; }
      .flash-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; margin-top: auto; }
      .flash-actions .choice { min-height: 76px; text-align: center; }
      .flash-actions .choice strong { font-size: 17px; }
      .flash-actions .choice small { line-height: 1.35; }
      .flash-reveal-word { margin: 8px 0 2px; font: 780 clamp(29px, 9vw, 40px)/1.05 ui-monospace, "SFMono-Regular", monospace; letter-spacing: -.04em; }
      .flash-pos { margin: 0; color: var(--accent); font-size: 11px; font-weight: 800; }
      .flash-meaning { margin: 10px 0 0; font-size: 22px; font-weight: 730; line-height: 1.35; }
      .flash-detail { margin-top: 14px; padding: 13px 14px; border-radius: 16px; background: var(--surface-soft); }
      .flash-detail small { display: block; margin-bottom: 5px; color: var(--muted); font-size: 10px; font-weight: 760; letter-spacing: .06em; }
      .flash-detail strong, .flash-detail p { margin: 0; font-size: 14px; line-height: 1.5; }
      .flash-detail + .flash-detail { margin-top: 9px; }
      .flash-peers { display: grid; gap: 7px; margin-top: 8px; }
      .flash-peer { display: grid; grid-template-columns: minmax(0, .75fr) minmax(0, 1.25fr); gap: 10px; align-items: baseline; }
      .flash-peer b { font: 700 13px/1.3 ui-monospace, "SFMono-Regular", monospace; }
      .flash-peer span { color: var(--muted); font-size: 12px; line-height: 1.35; }
      .flash-next { margin-top: 14px; }
      .flash-summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 0 0 12px; }
      .flash-summary div { padding: 12px 8px; border-radius: 15px; background: var(--surface); text-align: center; }
      .flash-summary strong { display: block; color: var(--accent); font: 760 20px/1 ui-monospace, "SFMono-Regular", monospace; }
      .flash-summary small { display: block; margin-top: 5px; color: var(--muted); font-size: 10px; }
      .flash-home-card { order: -1; }
      @media (max-width: 350px) {
        .flash-actions { grid-template-columns: 1fr; }
        .flash-card { min-height: 420px; }
      }
    `;
    document.head.appendChild(style);
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(logic.STORAGE_KEY);
      return raw ? logic.safeState(JSON.parse(raw)) : logic.defaultState();
    } catch (_error) {
      return logic.defaultState();
    }
  }

  function saveState() {
    try {
      localStorage.setItem(logic.STORAGE_KEY, JSON.stringify(state));
    } catch (_error) {
      // 刷词记录失败也不能破坏 Confusions 主应用；当前内存流程仍可继续。
    }
  }

  function allTerms() {
    return logic.flattenTerms(groups);
  }

  function termByName(name) {
    return allTerms().find((term) => term.term === name);
  }

  function groupForTerm(term) {
    return groups.find((group) => group.id === term.groupId);
  }

  function fillSentence(sentence, term) {
    return String(sentence || "").replace("___", term);
  }

  function speak(term) {
    if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(term);
    utterance.lang = "en-GB";
    utterance.rate = 0.88;
    window.speechSynthesis.speak(utterance);
  }

  function progressHeader(term) {
    const progress = logic.baseProgress(state);
    return `
      <header class="section-head">
        <div>
          <p class="eyebrow">CONFUSIONS · 刷词</p>
          <h2>易混词</h2>
          <p>${term ? `当前组 ${escapeHtml(term.groupLabel)}` : "先刷熟，再去匹配和冷测。"}</p>
        </div>
        <span class="progress-count">${progress.done}/${progress.total || logic.SESSION_SIZE}</span>
      </header>
      <div class="flash-summary" aria-label="易混词刷词进度">
        <div><strong>${logic.seenCount(state)}</strong><small>已刷 / 84</small></div>
        <div><strong>${logic.masteredCount(state)}</strong><small>较熟练</small></div>
        <div><strong>${state.session?.results?.filter((item) => !item.known).length || 0}</strong><small>本轮不认识</small></div>
      </div>`;
  }

  function ensureSession() {
    state = loadState();
    if (!state.session || state.session.completed || !logic.currentEntry(state)) {
      state = logic.buildSession(groups, state, `${Date.now()}:${Math.random()}`);
      saveState();
    }
  }

  function renderFlash() {
    installStyles();
    window.scrollTo(0, 0);
    screenLabel.textContent = "刷易混词";
    if (!state?.session || state.session.completed || state.session.phase === "complete") {
      renderComplete();
      return;
    }
    if (state.session.phase === "meaning") renderMeaningCheck();
    else if (state.session.phase === "reveal") renderReveal();
    else renderQuestion();
  }

  function renderQuestion() {
    const entry = logic.currentEntry(state);
    const term = termByName(entry.term);
    screen.innerHTML = `${progressHeader(term)}
      <section class="question-card flash-card">
        <div class="question-meta"><span>${entry.isRetry ? "间隔回炉" : "第一反应"}</span><span>${escapeHtml(term.partOfSpeech)}</span></div>
        <div class="flash-word-zone">
          <h2 class="prompt-word">${escapeHtml(term.term)}</h2>
          <p class="flash-group">${escapeHtml(term.groupLabel)}</p>
          <button id="flash-speak" class="timer-control flash-speak" type="button">${icon("speaker-high")}<span>再读</span></button>
        </div>
        <p class="prompt-hint">先别看释义。${entry.isRetry ? "这是刚才不会的词，再凭第一反应判断。" : "像平时背词一样，先判断你认不认识。"}</p>
        <div class="flash-actions">
          <button id="flash-known" class="choice" type="button"><strong>认识</strong><small>一眼知道意思</small></button>
          <button id="flash-unknown" class="choice" type="button"><strong>不认识</strong><small>先确认中文义</small></button>
        </div>
      </section>
      <a class="secondary" style="display:grid;place-items:center;text-decoration:none" href="./">去匹配 / 冷测</a>`;
    document.getElementById("flash-speak").addEventListener("click", () => speak(term.term));
    document.getElementById("flash-known").addEventListener("click", () => {
      state = logic.answerKnown(state);
      saveState();
      renderFlash();
    });
    document.getElementById("flash-unknown").addEventListener("click", () => {
      state = logic.answerUnknown(state);
      saveState();
      renderFlash();
    });
  }

  function renderMeaningCheck() {
    const entry = logic.currentEntry(state);
    const term = termByName(entry.term);
    const choices = logic.makeMeaningChoices(groups, term.term, `${state.session.id}:${state.session.cursor}:meaning`);
    screen.innerHTML = `${progressHeader(term)}
      <section class="question-card flash-card">
        <div class="question-meta"><span>不认识 · 释义确认</span><span>${escapeHtml(term.partOfSpeech)}</span></div>
        <div class="flash-word-zone">
          <h2 class="prompt-word">${escapeHtml(term.term)}</h2>
          <button id="flash-speak" class="timer-control flash-speak" type="button">${icon("speaker-high")}<span>再读</span></button>
        </div>
        <p class="prompt-hint">从四个中文义里找出它。选对也仍按“不认识”记录，避免看完答案又误算成掌握。</p>
        <div class="choices">
          ${choices.map((choice) => `<button class="choice" data-meaning="${escapeHtml(choice.meaning)}" type="button"><strong>${escapeHtml(choice.meaning)}</strong><small>${escapeHtml(choice.partOfSpeech)}</small></button>`).join("")}
        </div>
      </section>`;
    document.getElementById("flash-speak").addEventListener("click", () => speak(term.term));
    document.querySelectorAll("[data-meaning]").forEach((button) => button.addEventListener("click", () => {
      state = logic.confirmMeaning(state, button.dataset.meaning, term.meaning);
      saveState();
      renderFlash();
    }));
  }

  function renderReveal() {
    const entry = logic.currentEntry(state);
    const term = termByName(entry.term);
    const group = groupForTerm(term);
    const pending = state.session.pending || { known: true };
    const peers = (group?.terms || []).filter((peer) => peer.term !== term.term);
    const status = pending.known
      ? "认识"
      : (pending.meaningCorrect ? "不认识 · 释义确认正确" : "不认识 · 刚才释义也选错了");
    screen.innerHTML = `${progressHeader(term)}
      <section class="question-card flash-card">
        <div class="question-meta"><span>${escapeHtml(status)}</span><span>${entry.isRetry ? "回炉" : "本轮"}</span></div>
        <h2 class="flash-reveal-word">${escapeHtml(term.term)}</h2>
        <p class="flash-pos">${escapeHtml(term.partOfSpeech)}</p>
        <p class="flash-meaning">${escapeHtml(term.meaning)}</p>
        <div class="flash-detail"><small>高价值 CHUNK</small><strong>${escapeHtml(term.chunk)}</strong></div>
        <div class="flash-detail"><small>语境</small><p>${escapeHtml(fillSentence(term.sentence, term.term))}</p></div>
        ${peers.length ? `<div class="flash-detail"><small>同组易混</small><div class="flash-peers">${peers.map((peer) => `<div class="flash-peer"><b>${escapeHtml(peer.term)}</b><span>${escapeHtml(peer.meaning)}</span></div>`).join("")}</div></div>` : ""}
        <button id="flash-next" class="primary flash-next" type="button">下一词</button>
      </section>`;
    document.getElementById("flash-next").addEventListener("click", () => {
      state = logic.advance(state);
      saveState();
      renderFlash();
    });
  }

  function renderComplete() {
    installStyles();
    screenLabel.textContent = "刷易混词";
    const progress = logic.baseProgress(state || logic.defaultState());
    screen.innerHTML = `<section class="completion">
        <div class="completion-icon">${icon("check-circle")}</div>
        <h2>这一轮刷完了</h2>
        <p>本轮 ${progress.total || logic.SESSION_SIZE} 个基础词已过完。不会的词会优先出现在后续轮次，匹配与 cold test 的统计仍然独立。</p>
      </section>
      <div class="flash-summary">
        <div><strong>${logic.seenCount(state || {})}</strong><small>已刷 / 84</small></div>
        <div><strong>${logic.masteredCount(state || {})}</strong><small>较熟练</small></div>
        <div><strong>${state?.session?.results?.filter((item) => !item.known).length || 0}</strong><small>本轮不认识</small></div>
      </div>
      <button id="flash-again" class="primary" type="button">再刷 ${logic.SESSION_SIZE} 词</button>
      <a class="secondary" style="display:grid;place-items:center;text-decoration:none" href="./">去匹配 / 冷测</a>
      <a class="secondary" style="display:grid;place-items:center;text-decoration:none" href="../">返回 Listening 首页</a>`;
    document.getElementById("flash-again").addEventListener("click", () => {
      state = logic.buildSession(groups, state || logic.defaultState(), `${Date.now()}:${Math.random()}`);
      saveState();
      renderFlash();
    });
  }

  function injectFlashEntry() {
    if (isFlashMode) return;
    const stack = screen.querySelector(".action-stack");
    if (!stack || document.getElementById("start-flash")) return;
    const button = document.createElement("button");
    button.id = "start-flash";
    button.className = "action-card flash-home-card";
    button.type = "button";
    const current = loadState();
    button.innerHTML = `<span class="action-icon">${icon("cards-three")}</span>
      <span class="action-copy"><strong>刷易混词</strong><small>像背新词一样刷 · 已刷 ${logic.seenCount(current)} / 84</small></span>
      <span class="action-caret">${icon("caret-right")}</span>`;
    button.addEventListener("click", () => { window.location.href = "./?mode=flash"; });
    stack.prepend(button);
  }

  async function startFlashMode() {
    if (!logic) throw new Error("logic");
    installStyles();
    const response = await fetch("./data/confusions.json");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    groups = payload.groups || [];
    ensureSession();
    renderFlash();
  }

  if (isFlashMode) {
    const launch = () => startFlashMode().catch(() => {
      screenLabel.textContent = "刷易混词";
      screen.innerHTML = `<section class="fatal"><div class="fatal-icon">${icon("warning-circle")}</div><h2>刷词模式加载失败</h2><p>原有匹配和冷测没有被改坏，可以返回继续用。</p><a class="primary" style="display:grid;place-items:center;text-decoration:none" href="./">返回易混词</a></section>`;
    });
    const waitForBaseApp = new MutationObserver(() => {
      if (!screen.querySelector("#start-learning")) return;
      waitForBaseApp.disconnect();
      launch();
    });
    waitForBaseApp.observe(screen, { childList: true, subtree: true });
    if (screen.querySelector("#start-learning")) {
      waitForBaseApp.disconnect();
      launch();
    }
  } else {
    installStyles();
    const observer = new MutationObserver(injectFlashEntry);
    observer.observe(screen, { childList: true, subtree: true });
    injectFlashEntry();
  }
})();
