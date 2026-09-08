(function () {
  "use strict";

  const STORAGE_KEY = "marcoIelts807.v1";
  const SOURCE_URL = "./data/terms.json";
  const SESSION_SIZE = 30;
  const RETRY_MIN_DISTANCE = 8;
  const RETRY_MAX_DISTANCE = 12;
  const MAX_RETRIES_PER_TERM = 3;

  const screen = document.getElementById("screen");
  const screenTitle = document.getElementById("screen-title");
  const dayCount = document.getElementById("day-count");
  const versionBadge = document.getElementById("app-version");

  let terms = [];
  let meanings = {};
  const store = ModuleStore.create(STORAGE_KEY, value => value?.version === 1 && ModuleStore.recordsValid(value.records, ["attempts", "correct", "wrong", "streak"]) && ModuleStore.recordsValid(value.wrongTerms, ["wrong"]) && ModuleStore.sessionValid(value.session));
  let state = loadState();
  let activeSession = null;
  let transitionTimer = 0;
  let questionToken = 0;
  let heard = false;
  let rate = 1.2;

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

  function normalise(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[’‘]/g, "'")
      .replace(/\s+/g, " ");
  }

  function defaultState() {
    return {
      version: 1,
      records: {},
      wrongTerms: {},
      session: null,
      totalAttempts: 0,
      totalCorrect: 0,
    };
  }

  function sanitiseState(raw) {
    const base = defaultState();
    if (!raw || typeof raw !== "object") return base;
    const records = raw.records && typeof raw.records === "object" && !Array.isArray(raw.records) ? raw.records : {};
    const wrongTerms = raw.wrongTerms && typeof raw.wrongTerms === "object" && !Array.isArray(raw.wrongTerms) ? raw.wrongTerms : {};
    const session = raw.session && typeof raw.session === "object" ? raw.session : null;
    return {
      ...base,
      ...raw,
      version: 1,
      records,
      wrongTerms,
      session,
      totalAttempts: Number.isInteger(raw.totalAttempts) && raw.totalAttempts >= 0 ? raw.totalAttempts : 0,
      totalCorrect: Number.isInteger(raw.totalCorrect) && raw.totalCorrect >= 0 ? raw.totalCorrect : 0,
    };
  }

  function loadState() {
    return sanitiseState(store.read(defaultState));
  }

  function saveState() {
    if (activeSession) state.session = activeSession;
    store.write(state);
  }

  function seededRank(term, salt) {
    let hash = 2166136261;
    const value = `${salt}|${term}`;
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function shuffled(values, salt = String(Date.now())) {
    return values.slice().sort((left, right) => seededRank(left, salt) - seededRank(right, salt));
  }

  async function loadTerms() {
    const response = await fetch(SOURCE_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const parsed = (await response.json()).terms;
    if (!Array.isArray(parsed) || parsed.length !== 1854 || parsed.some(term => typeof term !== "string" || !term.trim()) || new Set(parsed).size !== 1854) throw new Error("词库快照不完整");
    const glossaryResponse = await fetch("./data/meanings.json");
    if (!glossaryResponse.ok) throw new Error("词义数据加载失败");
    const glossary = (await glossaryResponse.json()).entries;
    if (!glossary || parsed.some(term => typeof glossary[term]?.pos !== "string" || !glossary[term].pos.trim() || typeof glossary[term]?.meaning !== "string" || !/[\u3400-\u9fff]/.test(glossary[term].meaning))) throw new Error("词义或词性数据不完整");
    meanings = glossary;
    terms = parsed;
    return terms;
  }

  function getRecord(term) {
    const key = normalise(term);
    return state.records[key] || { attempts: 0, correct: 0, wrong: 0, streak: 0, lastSeen: "" };
  }

  function updateRecord(term, correct) {
    const key = normalise(term);
    const previous = getRecord(term);
    state.records[key] = {
      attempts: previous.attempts + 1,
      correct: previous.correct + (correct ? 1 : 0),
      wrong: previous.wrong + (correct ? 0 : 1),
      streak: correct ? previous.streak + 1 : 0,
      lastSeen: new Date().toISOString(),
    };
    state.totalAttempts += 1;
    if (correct) state.totalCorrect += 1;
    if (!correct) {
      state.wrongTerms[key] = {
        term,
        wrong: (state.wrongTerms[key]?.wrong || 0) + 1,
        lastWrongAt: new Date().toISOString(),
      };
    }
  }

  function seenCount() {
    return Object.values(state.records).filter((record) => (record?.attempts || 0) > 0).length;
  }

  function wrongCount() {
    return Object.keys(state.wrongTerms).length;
  }

  function accuracy() {
    if (!state.totalAttempts) return 0;
    return Math.round((state.totalCorrect / state.totalAttempts) * 100);
  }

  function chooseSessionTerms(mode) {
    if (mode === "wrong") {
      const pool = Object.values(state.wrongTerms)
        .map((entry) => entry.term)
        .filter((term) => terms.some((candidate) => normalise(candidate) === normalise(term)));
      return shuffled(pool, `wrong-${Date.now()}`).slice(0, SESSION_SIZE);
    }
    const unseen = terms.filter((term) => !state.records[normalise(term)]?.attempts);
    const seen = terms.filter((term) => state.records[normalise(term)]?.attempts);
    const ordered = [
      ...shuffled(unseen, `unseen-${Date.now()}`),
      ...shuffled(seen, `seen-${Date.now()}`),
    ];
    return ordered.slice(0, SESSION_SIZE);
  }

  function createSession(mode) {
    const baseTerms = chooseSessionTerms(mode);
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      mode,
      queue: baseTerms.map((term) => ({ term, isRetry: false, retryCount: 0 })),
      totalBase: baseTerms.length,
      answeredBase: 0,
      correctBase: 0,
      wrongBase: 0,
      startedAt: new Date().toISOString(),
    };
  }

  function sanitiseSession(session) {
    if (!session || typeof session !== "object" || !Array.isArray(session.queue)) return null;
    const queue = session.queue.filter((entry) => entry && typeof entry.term === "string").map(entry => ({ ...entry, retryCount: Number.isInteger(entry.retryCount) ? Math.max(0, entry.retryCount) : 0 }));
    if (!queue.length && !session.feedback) return null;
    return {
      ...session,
      mode: session.mode === "wrong" ? "wrong" : "all",
      queue,
      totalBase: Number.isInteger(session.totalBase) ? session.totalBase : queue.filter((entry) => !entry.isRetry).length,
      answeredBase: Number.isInteger(session.answeredBase) ? session.answeredBase : 0,
      correctBase: Number.isInteger(session.correctBase) ? session.correctBase : 0,
      wrongBase: Number.isInteger(session.wrongBase) ? session.wrongBase : 0,
    };
  }

  function speak(term, button) {
    const token = questionToken;
    return ModuleAudio.play(term, button, rate, () => {
      if (token === questionToken) {
        heard = true;
        screen.querySelectorAll('#skip, [type="submit"]').forEach(b => { b.disabled = false; });
      }
    });
  }

  function scheduleRetry(entry) {
    if (entry.retryCount >= MAX_RETRIES_PER_TERM) return;
    if (activeSession.queue.length < RETRY_MIN_DISTANCE) return;
    const nextRetry = entry.retryCount + 1;
    const min = Math.min(RETRY_MIN_DISTANCE, activeSession.queue.length);
    const max = Math.min(RETRY_MAX_DISTANCE, activeSession.queue.length);
    const distance = max > min ? min + Math.floor(Math.random() * (max - min + 1)) : min;
    const between = activeSession.queue.slice(0, distance).map(item => item.term);
    if (between.includes(entry.term) || new Set(between).size < 6) return;
    activeSession.queue.splice(distance, 0, { term: entry.term, isRetry: true, retryCount: nextRetry });
  }

  function sessionProgressText() {
    if (!activeSession) return "";
    return `${Math.min(activeSession.answeredBase + (activeSession.phase === "feedback" ? 0 : 1), activeSession.totalBase)}/${activeSession.totalBase}`;
  }

  function setHeader(title, count) {
    screenTitle.textContent = title;
    dayCount.textContent = count;
  }

  function homeScreen() {
    clearTimeout(transitionTimer);
    questionToken++;
    ModuleAudio.stop();
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    activeSession = sanitiseSession(state.session);
    setHeader("807 听写", `${seenCount()}/${terms.length || "?"}`);
    const canResume = Boolean(activeSession);
    const wrong = wrongCount();
    screen.innerHTML = `
      <section class="home-screen vocab807-home">
        <div class="vocab807-hero">
          <p class="eyebrow">王陆 807 · 听音拼写</p>
          <h2>只听声音，把英文写出来。</h2>
          <p>独立题库，不占主 App 的 25+25。优先抽未练词，答错后会在 8–12 题后重新出现。</p>
        </div>
        <div class="vocab807-stats">
          <div><strong>${seenCount()}</strong><span>已覆盖</span></div>
          <div><strong>${wrong}</strong><span>错词</span></div>
          <div><strong>${accuracy()}%</strong><span>总正确率</span></div>
        </div>
        <div class="vocab807-actions">
          ${canResume ? `<button id="resume" class="primary">${icon("play")}继续上次训练</button>` : ""}
          <button id="start" class="${canResume ? "secondary" : "primary"}">${icon("headphones")}开始 30 词</button>
          <button id="wrong" class="secondary" ${wrong ? "" : "disabled"}>${icon("arrow-counter-clockwise")}错词重听 ${wrong ? `(${wrong})` : ""}</button>
        </div>
        <div class="vocab807-note">
          <span>${icon("speaker-high")} 站内合成英音 · ${rate.toFixed(1)}x（非教材原音）</span>
          <span>词库 ${terms.length} 条去重词项</span>
        </div>
        <a class="back-link" href="../">${icon("arrow-left")}返回 IELTS Listening</a>
      </section>`;
    document.getElementById("resume")?.addEventListener("click", () => {
      activeSession = sanitiseSession(state.session);
      if (activeSession?.feedback) {
        const feedback = activeSession.feedback;
        if (feedback.correct) renderCorrect(feedback.entry.term);
        else renderWrong(feedback.entry, feedback.typed, feedback.skipped);
      } else renderQuestion();
    });
    document.getElementById("start").addEventListener("click", () => {
      if (activeSession && !confirm("替换未完成的队列？已有历史统计会保留。")) return;
      activeSession = createSession("all");
      state.session = activeSession;
      saveState();
      renderQuestion();
    });
    document.getElementById("wrong").addEventListener("click", () => {
      if (activeSession && !confirm("替换未完成的队列？已有历史统计会保留。")) return;
      activeSession = createSession("wrong");
      state.session = activeSession;
      saveState();
      renderQuestion();
    });
  }

  function finishSession() {
    ModuleAudio.stop();
    clearTimeout(transitionTimer);
    const completed = activeSession;
    if (!completed) return homeScreen();
    state.lastCompleted = completed;
    state.session = null;
    activeSession = null;
    saveState();
    setHeader("本轮完成", `${completed.answeredBase}/${completed.totalBase}`);
    const rate = completed.answeredBase ? Math.round((completed.correctBase / completed.answeredBase) * 100) : 0;
    screen.innerHTML = `
      <section class="result-card vocab807-finish">
        <div class="result-mark correct">${icon("check-circle")}</div>
        <p class="eyebrow">本轮完成</p>
        <h2>${completed.correctBase}/${completed.answeredBase} · ${rate}%</h2>
        <p>已覆盖 ${seenCount()}/${terms.length}，当前错词池 ${wrongCount()} 个。</p>
        <div class="result-actions">
          <button id="another" class="primary">再来 30 词</button>
          <button id="finish-wrong" class="secondary" ${wrongCount() ? "" : "disabled"}>练错词</button>
          <button id="finish-home" class="secondary">返回首页</button>
        </div>
      </section>`;
    document.getElementById("another").addEventListener("click", () => {
      activeSession = createSession("all");
      state.session = activeSession;
      saveState();
      renderQuestion();
    });
    document.getElementById("finish-wrong").addEventListener("click", () => {
      activeSession = createSession("wrong");
      state.session = activeSession;
      saveState();
      renderQuestion();
    });
    document.getElementById("finish-home").addEventListener("click", homeScreen);
  }

  function handleAnswer(entry, typed, skipped = false) {
    if (!activeSession || activeSession.phase !== "question" || activeSession.queue[0] !== entry || !heard) return;
    if (!skipped && !normalise(typed)) return;
    activeSession.phase = "feedback";
    ModuleAudio.stop();
    const verdict = DictationVariants.check(entry.term, typed);
    const correct = !skipped && verdict.correct;
    activeSession.queue.shift();
    updateRecord(entry.term, correct);
    if (!entry.isRetry) {
      activeSession.answeredBase += 1;
      if (correct) activeSession.correctBase += 1;
      else activeSession.wrongBase += 1;
    }
    if (!correct) scheduleRetry(entry);
    activeSession.feedback = { entry, typed, skipped, correct, reason: verdict.reason };
    saveState();
    if (correct) {
      renderCorrect(entry.term);
      return;
    }
    renderWrong(entry, typed, skipped);
  }

  function renderDefinition(term) {
    const entry = meanings[term];
    return `<div class="answer-definition"><span class="answer-pos" aria-label="词性">${escapeHtml(entry.pos)}</span><p class="answer-meaning">${escapeHtml(entry.meaning)}</p></div>`;
  }

  function renderCorrect(term) {
    setHeader("807 听写", sessionProgressText());
    screen.innerHTML = `
      <section class="training-card spelling-card quick-correct">
        <div class="result-mark correct">${icon("check-circle")}</div>
        <p class="feedback-label">正确</p>
        <h2 class="answer-word">${escapeHtml(term)}</h2>
        ${renderDefinition(term)}
        ${activeSession?.feedback?.reason ? `<p>接受 ${escapeHtml(activeSession.feedback.typed)}：${escapeHtml(activeSession.feedback.reason)}。上方为题库原词。</p>` : ""}
        <div class="result-actions">
          <button id="replay" class="secondary">${icon("speaker-high")}再听一次</button>
          <button id="correct-continue" class="primary">继续</button>
        </div>
        <button id="pause" class="text-button">暂停并返回</button>
      </section>`;
    const replay = document.getElementById("replay");
    replay.onclick = () => speak(term, replay);
    document.getElementById("pause").onclick = () => { saveState(); homeScreen(); };
    const feedback = activeSession?.feedback;
    document.getElementById("correct-continue").onclick = () => {
      if (!activeSession || activeSession.feedback !== feedback) return;
      clearTimeout(transitionTimer);
      activeSession.feedback = null;
      if (!activeSession.queue.length) finishSession(); else renderQuestion();
    };
  }

  function renderWrong(entry, typed, skipped) {
    setHeader("807 听写", sessionProgressText());
    screen.innerHTML = `
      <section class="training-card spelling-card spelling-result">
        <div class="result-mark wrong">${icon("x-circle")}</div>
        <p class="feedback-label">${skipped ? "先跳过" : "拼写不对"}</p>
        <h2 class="answer-word">${escapeHtml(entry.term)}</h2>
        ${renderDefinition(entry.term)}
        ${skipped ? "" : `<p class="typed-answer">你写的是：<strong>${escapeHtml(typed || "（空）")}</strong></p>`}
        <p class="feedback-sub">已保留到错词池；间隔足够才在本轮回炉，不会马上重复。</p>
        <div class="result-actions">
          <button id="replay" class="secondary">${icon("speaker-high")}再听一次</button>
          <button id="continue" class="primary">继续</button>
        </div>
        <button id="pause" class="text-button">暂停并返回</button>
      </section>`;
    const replay = document.getElementById("replay");
    replay.addEventListener("click", () => speak(entry.term, replay));
    document.getElementById("continue").addEventListener("click", () => {
      if (!activeSession?.feedback || activeSession.feedback.entry !== entry) return;
      activeSession.feedback = null;
      if (!activeSession?.queue.length) finishSession();
      else renderQuestion();
    });
    document.getElementById("pause").addEventListener("click", () => {
      saveState();
      homeScreen();
    });
  }

  function renderQuestion() {
    clearTimeout(transitionTimer);
    ModuleAudio.stop();
    const token = ++questionToken;
    heard = false;
    if (!activeSession) { homeScreen(); return; }
    if (!activeSession || !activeSession.queue.length) {
      finishSession();
      return;
    }
    const entry = activeSession.queue[0];
    activeSession.phase = "question";
    activeSession.feedback = null;
    saveState();
    setHeader(activeSession.mode === "wrong" ? "807 错词重听" : "807 听写", sessionProgressText());
    screen.innerHTML = `
      <section class="training-card spelling-card vocab807-question">
        <div class="training-toolbar">
          <button id="pause" class="text-button">${icon("arrow-left")}暂停</button>
          <span class="mode-label">${entry.isRetry ? "回炉题" : "听写"}</span>
        </div>
        <div class="audio-stage">
          <button id="play" class="audio-button" type="button" aria-label="播放单词">${icon("speaker-high")}</button>
          <p>听声音，输入你听到的英文</p>
          <label>合成英音 · <select id="audio-rate" aria-label="朗读速度"><option value="0.8">0.8 倍</option><option value="1">1.0 倍</option><option value="1.2">1.2 倍</option></select></label>
          <button id="download-audio" type="button" class="text-button">下载本轮音频</button>
        </div>
        <form id="spelling-form" class="spelling-form" autocomplete="off">
          <label class="answer-label" for="answer">拼写</label>
          <input id="answer" class="spelling-input" type="text" inputmode="text" autocapitalize="none" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="done" aria-label="输入听到的英文">
          <div class="spelling-actions">
            <button class="primary" type="submit" disabled>提交</button>
            <button id="skip" class="secondary" type="button" disabled>不会</button>
          </div>
        </form>
        <p class="coverage-line">已覆盖 ${seenCount()}/${terms.length} · 错词 ${wrongCount()}</p>
      </section>`;
    const play = document.getElementById("play");
    const answer = document.getElementById("answer");
    const speed = document.getElementById("audio-rate");
    speed.value = String(rate);
    speed.addEventListener("change", () => { rate = Number(speed.value); state.audioRate = rate; saveState(); speak(entry.term, play); });
    document.getElementById("download-audio").onclick = event => ModuleAudio.download(activeSession.queue.map(item => item.term), event.currentTarget);
    play.addEventListener("click", () => speak(entry.term, play));
    document.getElementById("spelling-form").addEventListener("submit", (event) => {
      event.preventDefault();
      handleAnswer(entry, answer.value, false);
    });
    document.getElementById("skip").addEventListener("click", () => handleAnswer(entry, "", true));
    document.getElementById("pause").addEventListener("click", () => {
      saveState();
      homeScreen();
    });
    answer.focus({ preventScroll: true });
    transitionTimer = window.setTimeout(() => { if (token === questionToken && !document.hidden) speak(entry.term, play); }, 60);
  }

  function loadingScreen() {
    setHeader("807 听写", "加载中");
    screen.innerHTML = `
      <section class="empty-card vocab807-loading">
        <div class="result-mark">${icon("cloud-arrow-down")}</div>
        <strong>正在载入 807 词库</strong>
        <p>首次打开需要联网，成功后会把词表缓存到当前浏览器。</p>
      </section>`;
  }

  function loadErrorScreen(error) {
    setHeader("807 听写", "加载失败");
    screen.innerHTML = `
      <section class="empty-card vocab807-loading">
        <div class="result-mark wrong">${icon("warning-circle")}</div>
        <strong>807 词库没加载出来</strong>
        <p>${escapeHtml(error?.message || "网络错误")}</p>
        <button id="retry-load" class="primary">重新加载</button>
        <a class="back-link" href="../">返回 IELTS Listening</a>
      </section>`;
    document.getElementById("retry-load").addEventListener("click", boot);
  }

  async function boot() {
    loadingScreen();
    versionBadge.textContent = "807 v1.2.0";
    try {
      await loadTerms();
      state = loadState();
      rate = [0.8, 1, 1.2].includes(state.audioRate) ? state.audioRate : 1.2;
      activeSession = sanitiseSession(state.session);
      if (activeSession) state.session = activeSession;
      if (!activeSession && state.lastCompleted) { activeSession = state.lastCompleted; finishSession(); }
      else homeScreen();
    } catch (error) {
      loadErrorScreen(error);
    }
  }

  document.addEventListener("visibilitychange", () => { if (document.hidden) { clearTimeout(transitionTimer); questionToken++; } });
  store.controls();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js", { scope: "./", updateViaCache: "none" }).catch(() => {});
  boot();
})();
