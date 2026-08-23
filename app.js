(function () {
  "use strict";

  const STORAGE_KEY = "marcoIeltsListening.v1";
  const DAILY_PER_MODE = 25;
  const RESPONSE_LIMIT_MS = 5000;
  const INTERVALS = [1, 3, 7, 14, 30, 60];

  function dateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function addDays(key, days) {
    const date = new Date(`${key}T12:00:00`);
    date.setDate(date.getDate() + days);
    return dateKey(date);
  }

  function hashString(value) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function normaliseAnswer(value) {
    return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function makeActivities(items) {
    return items.flatMap((item) => item.modes.map((mode) => ({ ...item, mode, key: `${item.id}:${mode}` })));
  }

  function safeState(raw) {
    const base = { version: 1, progress: {}, daily: null, streak: 0, lastCompletedDate: null };
    if (!raw || typeof raw !== "object") return base;
    return {
      ...base,
      ...raw,
      version: 1,
      progress: raw.progress && typeof raw.progress === "object" ? raw.progress : {},
      daily: raw.daily && typeof raw.daily === "object" ? raw.daily : null,
    };
  }

  function activityRank(activity, progress, today) {
    const record = progress[activity.key];
    if (record && record.due <= today) return [0, activity.isRealError ? 0 : 1, record.due, record.stage || 0, activity.key];
    if (!record && activity.isRealError) return [1, 0, "", 0, activity.key];
    if (!record) return [2, 0, "", 0, activity.key];
    return [3, activity.isRealError ? 0 : 1, record.lastSeen || "", record.stage || 0, activity.key];
  }

  function compareRank(a, b) {
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
      if (a[i] < b[i]) return -1;
      if (a[i] > b[i]) return 1;
    }
    return 0;
  }

  function createDailyDeck(activities, progress, today = dateKey()) {
    function pick(mode) {
      return activities
        .filter((activity) => activity.mode === mode)
        .sort((a, b) => compareRank(activityRank(a, progress, today), activityRank(b, progress, today)))
        .slice(0, DAILY_PER_MODE)
        .map((activity) => activity.key);
    }
    const spelling = pick("spelling");
    const recognition = pick("recognition");
    const deck = [];
    for (let i = 0; i < DAILY_PER_MODE; i += 1) {
      if (spelling[i]) deck.push(spelling[i]);
      if (recognition[i]) deck.push(recognition[i]);
    }
    return deck;
  }

  function prepareDaily(state, activities, today = dateKey()) {
    if (state.daily && state.daily.date === today && Array.isArray(state.daily.queue)) return state;
    const baseKeys = createDailyDeck(activities, state.progress, today);
    state.daily = {
      date: today,
      baseKeys,
      queue: baseKeys.map((key) => ({ key, isRetry: false })),
      answeredBase: {},
      outcomes: {},
      retryCount: {},
      started: false,
      completed: false,
    };
    return state;
  }

  function scheduleReview(record, outcome, today = dateKey()) {
    const current = record && typeof record === "object" ? record : { stage: 0, lapses: 0, passes: 0 };
    if (outcome === "pass") {
      const stage = Math.min((current.stage || 0) + 1, INTERVALS.length);
      return {
        ...current,
        stage,
        passes: (current.passes || 0) + 1,
        lastSeen: today,
        due: addDays(today, INTERVALS[Math.max(0, stage - 1)]),
      };
    }
    return {
      ...current,
      stage: 0,
      lapses: (current.lapses || 0) + 1,
      lastSeen: today,
      due: addDays(today, 1),
    };
  }

  function insertRetry(daily, key) {
    daily.queue = daily.queue.filter((entry) => !(entry.isRetry && entry.key === key));
    const count = (daily.retryCount[key] || 0) + 1;
    daily.retryCount[key] = count;
    const distance = 5 + (hashString(`${key}:${count}:${daily.date}`) % 6);
    const index = Math.min(distance, daily.queue.length);
    daily.queue.splice(index, 0, { key, isRetry: true });
    return index;
  }

  function buildChoices(activity, activities) {
    const target = activity.meaning;
    const candidates = activities.filter((item) =>
      item.mode === "recognition" && item.key !== activity.key && item.meaning !== target
    );
    candidates.sort((a, b) => {
      const categoryDelta = Number(a.category !== activity.category) - Number(b.category !== activity.category);
      if (categoryDelta) return categoryDelta;
      return hashString(activity.key + a.key) - hashString(activity.key + b.key);
    });
    const meanings = [];
    for (const item of candidates) {
      if (!meanings.includes(item.meaning)) meanings.push(item.meaning);
      if (meanings.length === 3) break;
    }
    return [target, ...meanings].sort((a, b) => hashString(activity.key + a) - hashString(activity.key + b));
  }

  function createBrowseDeck(sourceItems, filter = "all", seed = "default") {
    return sourceItems
      .filter((item) => {
        if (filter === "spelling") return item.modes.includes("spelling");
        if (filter === "recognition") return item.modes.includes("recognition");
        if (filter === "errors") return item.isRealError;
        return true;
      })
      .slice()
      .sort((a, b) => hashString(`${seed}:${a.id}`) - hashString(`${seed}:${b.id}`));
  }

  function diffAnswer(typed, expected) {
    const value = String(typed || "");
    return [...value].map((char, index) => {
      const correct = char.toLowerCase() === (expected[index] || "").toLowerCase();
      return `<span class="${correct ? "" : "wrong-char"}">${escapeHtml(char || " ")}</span>`;
    }).join("") || "（空白）";
  }

  function shouldRevealAnswer(mode, outcome, retryCount) {
    return mode === "recognition" || outcome === "pass" || retryCount >= 3;
  }

  const api = {
    dateKey, addDays, hashString, normaliseAnswer, makeActivities, safeState,
    createDailyDeck, prepareDaily, scheduleReview, insertRetry, buildChoices,
    createBrowseDeck, shouldRevealAnswer, RESPONSE_LIMIT_MS, INTERVALS,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof document === "undefined") return;

  let items = [];
  let activities = [];
  let activityMap = new Map();
  let state = safeState(null);
  let recognitionStartedAt = 0;
  let recognitionTimerId = null;
  let currentResult = null;
  let browseFilter = "all";
  let browseSeed = `${dateKey()}:browse`;
  const screen = document.getElementById("screen");
  const rail = document.getElementById("signal-rail");
  const dayCount = document.getElementById("day-count");
  const screenTitle = document.getElementById("screen-title");
  const appShell = document.getElementById("app");

  function loadState() {
    try { state = safeState(JSON.parse(localStorage.getItem(STORAGE_KEY))); }
    catch (_) { state = safeState(null); }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    updateChrome();
  }

  function baseDone() {
    return state.daily ? Object.keys(state.daily.answeredBase || {}).length : 0;
  }

  function updateChrome() {
    const done = baseDone();
    dayCount.textContent = `${done}/50`;
    const daily = state.daily || { baseKeys: [], outcomes: {} };
    rail.innerHTML = Array.from({ length: 50 }, (_, index) => {
      const key = daily.baseKeys[index];
      const outcome = key ? daily.outcomes[key] : null;
      const css = outcome ? (outcome === "pass" ? " done" : " weak") : "";
      return `<span class="signal-tick${css}"></span>`;
    }).join("");
  }

  function finishDay() {
    if (state.daily.completed) return;
    const yesterday = addDays(state.daily.date, -1);
    state.streak = state.lastCompletedDate === yesterday ? (state.streak || 0) + 1 : 1;
    state.lastCompletedDate = state.daily.date;
    state.daily.completed = true;
    saveState();
  }

  function setShellMode(mode) {
    const browsing = mode === "browse";
    appShell.classList.toggle("browse-mode", browsing);
    screenTitle.textContent = browsing ? "随便刷" : "今日 50";
    if (browsing) dayCount.textContent = "∞";
    else updateChrome();
  }

  function homeScreen() {
    window.scrollTo(0, 0);
    setShellMode("daily");
    const done = baseDone();
    const remainingRetries = state.daily.queue.filter((entry) => entry.isRetry).length;
    const buttonText = state.daily.completed ? "今天已完成" : (state.daily.started ? "继续训练" : "开始今日 50");
    screen.innerHTML = `
      <section class="home">
        <div class="home-card">
          <p class="eyebrow">${escapeHtml(state.daily.date)}</p>
          <div class="hero-number">${done}</div>
          <p class="hero-copy">先把到期词清掉。听写必须拼对，看义必须 5 秒内反应。</p>
          <div class="split-summary">
            <div class="split-item"><strong>25</strong><span>听音拼写</span></div>
            <div class="split-item"><strong>25</strong><span>快速看义</span></div>
          </div>
        </div>
        <button id="start" class="primary" ${state.daily.completed ? "disabled" : ""}>${buttonText}</button>
        <button id="browse" class="browse-entry">
          <span><strong>随便刷</strong><small>不答题，不计进度，想停就停</small></span>
          <b aria-hidden="true">∞</b>
        </button>
        <p class="status-line">连续 ${state.streak || 0} 天${remainingRetries ? ` · 还有 ${remainingRetries} 个回炉题` : ""}</p>
        <details>
          <summary>进度与备份</summary>
          <div class="tools">
            <button id="export" class="secondary">导出学习进度</button>
            <label class="secondary file-label">导入学习进度<input id="import" type="file" accept="application/json"></label>
            <p>词库 ${items.length} 条 · 飞书 revision ${items[0]?.sourceRevision || "-"}</p>
          </div>
        </details>
      </section>`;
    document.getElementById("start")?.addEventListener("click", () => {
      state.daily.started = true;
      saveState();
      renderCurrent();
    });
    document.getElementById("browse")?.addEventListener("click", browseScreen);
    document.getElementById("export")?.addEventListener("click", exportProgress);
    document.getElementById("import")?.addEventListener("change", importProgress);
  }

  function sessionMeta(entry, activity) {
    const label = activity.mode === "spelling" ? "听音拼写" : "快速看义";
    return `<div class="session-meta"><span class="mode-label">${label}</span><span>${entry.isRetry ? '<b class="retry-label">回炉题</b>' : `${baseDone() + 1}/50`}</span></div>`;
  }

  function renderSpelling(entry, activity) {
    window.scrollTo(0, 0);
    screen.innerHTML = `
      <section class="session">
        ${sessionMeta(entry, activity)}
        <div class="question-card">
          <p class="prompt">点击播放，写出完整英文</p>
          <div class="play-zone">
            <button id="play" class="play-button" aria-label="播放英音">▶ 播放</button>
            <p class="play-hint">单复数、空格、连字符都要准确</p>
          </div>
        </div>
        <form id="spelling-form" class="spelling-form">
          <input id="answer" class="spelling-input" type="text" inputmode="text"
            autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false"
            enterkeyhint="done" aria-label="输入英文答案" placeholder="输入你听到的词">
          <button class="submit-button" type="submit">检查拼写</button>
        </form>
      </section>`;
    document.getElementById("play").addEventListener("click", () => playAudio(activity));
    document.getElementById("spelling-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const typed = document.getElementById("answer").value;
      if (!normaliseAnswer(typed)) return;
      const correct = activity.acceptedAnswers.some((answer) => normaliseAnswer(answer) === normaliseAnswer(typed));
      recordAttempt(entry, activity, correct ? "pass" : "fail", { typed });
    });
  }

  function renderRecognition(entry, activity) {
    window.scrollTo(0, 0);
    clearInterval(recognitionTimerId);
    recognitionStartedAt = performance.now();
    const choices = buildChoices(activity, activities);
    screen.innerHTML = `
      <section class="session">
        ${sessionMeta(entry, activity)}
        <div class="question-card">
          <div class="timer-label"><span>反应时间</span><strong id="timer-count">5</strong></div>
          <div class="timer"><div class="timer-bar"></div></div>
          <p class="prompt">选出最直接的意思</p>
          <h2 class="term">${escapeHtml(activity.term)}</h2>
          <div class="choices">
            ${choices.map((choice) => `<button class="choice" data-choice="${escapeHtml(choice)}">${escapeHtml(choice)}</button>`).join("")}
          </div>
        </div>
      </section>`;
    const timerCount = document.getElementById("timer-count");
    recognitionTimerId = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((RESPONSE_LIMIT_MS - (performance.now() - recognitionStartedAt)) / 1000));
      timerCount.textContent = remaining > 0 ? String(remaining) : "超时";
      timerCount.classList.toggle("expired", remaining === 0);
      if (remaining === 0) clearInterval(recognitionTimerId);
    }, 100);
    document.querySelectorAll(".choice").forEach((button) => button.addEventListener("click", () => {
      clearInterval(recognitionTimerId);
      const elapsed = performance.now() - recognitionStartedAt;
      const selected = button.dataset.choice;
      const correct = selected === activity.meaning;
      const outcome = correct && elapsed <= RESPONSE_LIMIT_MS ? "pass" : (correct ? "slow" : "fail");
      recordAttempt(entry, activity, outcome, { selected, elapsed });
    }));
  }

  function renderCurrent() {
    setShellMode("daily");
    updateChrome();
    const entry = state.daily.queue[0];
    if (!entry) {
      finishDay();
      screen.innerHTML = `
        <section class="finished">
          <div class="hero-number">✓</div>
          <h2>今天清完了</h2>
          <p>50 个基础题和所有回炉题都已完成。明天按遗忘顺序再来。</p>
          <button id="back-home" class="secondary">返回首页</button>
        </section>`;
      document.getElementById("back-home").addEventListener("click", homeScreen);
      return;
    }
    const activity = activityMap.get(entry.key);
    if (!activity) {
      state.daily.queue.shift();
      saveState();
      return renderCurrent();
    }
    if (activity.mode === "spelling") renderSpelling(entry, activity);
    else renderRecognition(entry, activity);
  }

  function browseScreen() {
    window.scrollTo(0, 0);
    setShellMode("browse");
    const deck = createBrowseDeck(items, browseFilter, browseSeed);
    const filters = [
      ["all", "全部"],
      ["spelling", "听写"],
      ["recognition", "看懂"],
      ["errors", "我的错词"],
    ];
    screen.innerHTML = `
      <section class="browse">
        <div class="browse-toolbar">
          <button id="browse-back" class="text-button">← 今日任务</button>
          <button id="browse-shuffle" class="text-button">换个顺序</button>
        </div>
        <div class="browse-intro">
          <p>不用回忆，不用作答。往下滑，看到就算复习。</p>
          <span>${deck.length} 条</span>
        </div>
        <div class="filter-strip" role="group" aria-label="筛选词表">
          ${filters.map(([value, label]) => `<button class="filter-chip${browseFilter === value ? " active" : ""}" data-filter="${value}">${label}</button>`).join("")}
        </div>
        <div class="word-stream">
          ${deck.map((item) => browseCard(item)).join("")}
        </div>
        <p class="stream-end">刷到底了。换个顺序，还能再来一遍。</p>
      </section>`;
    document.getElementById("browse-back").addEventListener("click", homeScreen);
    document.getElementById("browse-shuffle").addEventListener("click", () => {
      browseSeed = `${Date.now()}:${Math.random()}`;
      browseScreen();
    });
    document.querySelectorAll(".filter-chip").forEach((button) => button.addEventListener("click", () => {
      browseFilter = button.dataset.filter;
      browseScreen();
    }));
    document.querySelectorAll(".mini-play").forEach((button) => button.addEventListener("click", () => {
      const item = items.find((candidate) => candidate.id === button.dataset.id);
      if (item) playAudio(item, button);
    }));
  }

  function browseCard(item) {
    const tags = [];
    if (item.modes.includes("spelling")) tags.push("听写");
    if (item.modes.includes("recognition")) tags.push("看懂");
    if (item.isRealError) tags.push("错词");
    const rawNote = String(item.errorNote || item.note || "").trim();
    const note = /^[-—–]+$/.test(rawNote) ? "" : rawNote;
    return `
      <article class="word-card${item.isRealError ? " real-error" : ""}">
        <div class="word-main">
          <div>
            <h2>${escapeHtml(item.term)}</h2>
            <p>${escapeHtml(item.meaning)}</p>
          </div>
          ${item.audioPath ? `<button class="mini-play" data-id="${escapeHtml(item.id)}" aria-label="播放 ${escapeHtml(item.term)}">▶</button>` : ""}
        </div>
        ${note ? `<p class="word-note">${escapeHtml(note)}</p>` : ""}
        <div class="word-tags">${tags.map((tag) => `<span>${tag}</span>`).join("")}</div>
      </article>`;
  }

  function recordAttempt(entry, activity, outcome, detail) {
    state.daily.queue.shift();
    if (!entry.isRetry && !state.daily.answeredBase[activity.key]) {
      state.daily.answeredBase[activity.key] = true;
      state.daily.outcomes[activity.key] = outcome;
      state.progress[activity.key] = scheduleReview(state.progress[activity.key], outcome, state.daily.date);
    }
    if (outcome !== "pass") insertRetry(state.daily, activity.key);
    currentResult = { entry, activity, outcome, detail };
    saveState();
    renderResult();
  }

  function renderResult() {
    window.scrollTo(0, 0);
    const { activity, outcome, detail } = currentResult;
    const pass = outcome === "pass";
    const retryCount = state.daily.retryCount[activity.key] || 0;
    const reveal = shouldRevealAnswer(activity.mode, outcome, retryCount);
    const label = pass ? "本次通过" : (outcome === "slow" ? "答对了，但超过 5 秒" : "这次没拼对 / 选对");
    const typed = detail.typed !== undefined
      ? `<p class="typed">你写的是：${diffAnswer(detail.typed, activity.term)}</p>`
      : (detail.selected ? `<p class="typed">你选的是：${escapeHtml(detail.selected)}</p>` : "");
    screen.innerHTML = `
      <section class="result">
        <div class="result-card">
          <p class="result-mark ${pass ? "pass" : "weak"}">${label}</p>
          <h2 class="answer">${reveal ? escapeHtml(activity.term) : "先不公布答案"}</h2>
          <p class="meaning">${reveal ? escapeHtml(activity.meaning) : `第 ${retryCount} 次错误：看清错误位置，隔几题再拼。`}</p>
          ${typed}
          <p class="note">${reveal ? escapeHtml(activity.errorNote || activity.note || "") : "答案会在连续三次错误后显示。"}${pass ? "" : " · 已放回今天的队列"}</p>
        </div>
        <button id="continue" class="primary">继续</button>
      </section>`;
    document.getElementById("continue").addEventListener("click", renderCurrent);
  }

  function playAudio(activity, targetButton) {
    const button = targetButton || document.getElementById("play");
    button?.classList.add("playing");
    const finish = () => button?.classList.remove("playing");
    const audio = new Audio(`./${activity.audioPath}`);
    audio.addEventListener("ended", finish, { once: true });
    audio.addEventListener("error", () => { finish(); speakFallback(activity.audioText); }, { once: true });
    audio.play().catch(() => { finish(); speakFallback(activity.audioText); });
  }

  function speakFallback(text) {
    if (!("speechSynthesis" in window)) return;
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-GB";
    utterance.rate = 0.82;
    const voice = speechSynthesis.getVoices().find((candidate) => candidate.lang.toLowerCase().startsWith("en-gb"));
    if (voice) utterance.voice = voice;
    speechSynthesis.speak(utterance);
  }

  function exportProgress() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `ielts-listening-progress-${dateKey()}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function importProgress(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (parsed.version !== 1 || !parsed.progress) throw new Error("invalid");
        state = safeState(parsed);
        prepareDaily(state, activities);
        saveState();
        homeScreen();
      } catch (_) {
        alert("这个文件不是有效的听力进度备份。");
      }
    };
    reader.readAsText(file);
  }

  async function init() {
    try {
      const response = await fetch("./data/listening.json");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      items = await response.json();
      activities = makeActivities(items);
      activityMap = new Map(activities.map((activity) => [activity.key, activity]));
      loadState();
      prepareDaily(state, activities);
      saveState();
      homeScreen();
      if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js");
    } catch (error) {
      screen.innerHTML = `<section class="finished"><h2>词库没有加载成功</h2><p>${escapeHtml(error.message)}。联网后刷新页面再试。</p></section>`;
    }
  }

  init();
}());
