(function () {
  "use strict";

  const STORAGE_KEY = "marcoIeltsListening.v1";
  const APP_VERSION = "v2.7.0";
  const TRAINING_RESET_ID = "fresh-start-v2.5.0";
  const DECK_REVISION = "whole-bank-v2";
  const DAILY_PER_MODE = 25;
  const BROWSE_PAGE_SIZE = 20;
  const RESPONSE_LIMIT_MS = 5000;
  const DIRECTION_RESPONSE_LIMIT_MS = 2000;
  const DIRECTION_QUESTION_COUNT = 10;
  const INTERVALS = [1, 3, 7, 14, 30, 60];
  const REPOSITORY_URL = "https://github.com/yueert1997ai-sys/marco-ielts-listening";

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
    const base = {
      version: 3,
      progress: {},
      starred: {},
      customItems: [],
      daily: null,
      streak: 0,
      lastCompletedDate: null,
      trainingResetId: null,
      deckNonce: DECK_REVISION,
    };
    if (!raw || typeof raw !== "object") return base;
    return {
      ...base,
      ...raw,
      version: 3,
      progress: raw.progress && typeof raw.progress === "object" ? raw.progress : {},
      starred: raw.starred && typeof raw.starred === "object" ? raw.starred : {},
      customItems: Array.isArray(raw.customItems) ? raw.customItems : [],
      daily: raw.daily && typeof raw.daily === "object" ? raw.daily : null,
    };
  }

  function resetTrainingState(current, resetId = TRAINING_RESET_ID, deckNonce = resetId) {
    const preserved = safeState(current);
    return {
      ...preserved,
      progress: {},
      daily: null,
      streak: 0,
      lastCompletedDate: null,
      trainingResetId: resetId,
      deckNonce,
    };
  }

  function applyTrainingReset(current) {
    const safe = safeState(current);
    return safe.trainingResetId === TRAINING_RESET_ID
      ? safe
      : resetTrainingState(safe, TRAINING_RESET_ID, DECK_REVISION);
  }

  function activityRank(activity, progress, today, starred = {}, tieBreaker = activity.key, prioritiseRealErrors = true) {
    const record = progress[activity.key];
    const important = starred[activity.id] ? 0 : 1;
    const realErrorRank = prioritiseRealErrors && activity.isRealError ? 0 : 1;
    if (record && record.due <= today) return [0, important, realErrorRank, record.due, record.stage || 0, tieBreaker];
    if (!record && prioritiseRealErrors && activity.isRealError) return [1, important, 0, "", tieBreaker];
    if (!record) return [2, important, realErrorRank, "", tieBreaker];
    return [3, important, realErrorRank, record.lastSeen || "", record.stage || 0, tieBreaker];
  }

  function compareRank(a, b) {
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
      if (a[i] < b[i]) return -1;
      if (a[i] > b[i]) return 1;
    }
    return 0;
  }

  function seededShuffle(values, seed) {
    return values
      .map((value, index) => ({ value, rank: hashString(`${seed}:${index}:${typeof value === "string" ? value : JSON.stringify(value)}`) }))
      .sort((a, b) => a.rank - b.rank)
      .map((entry) => entry.value);
  }

  function createDirectionDeck(directions, seed = "direction") {
    const unique = [...new Map((directions || []).map((item) => [item.id, item])).values()];
    if (unique.length !== 8) throw new Error("方位检测需要正好 8 个不同方向");
    const base = seededShuffle(unique, `${seed}:base`);
    const extras = seededShuffle(unique, `${seed}:extras`).slice(0, DIRECTION_QUESTION_COUNT - unique.length);
    const pool = [...base, ...extras];
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const deck = seededShuffle(pool, `${seed}:deck:${attempt}`);
      if (deck.every((item, index) => index === 0 || item.id !== deck[index - 1].id)) return deck;
    }
    throw new Error("方位题目没有成功打乱");
  }

  function judgeDirectionAttempt(expectedId, selectedId, elapsedMs, limit = DIRECTION_RESPONSE_LIMIT_MS) {
    const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : limit;
    const correct = selectedId === expectedId;
    const inTime = elapsed <= limit;
    const outcome = !selectedId ? "timeout" : (correct ? (inTime ? "pass" : "slow") : "fail");
    return { expectedId, selectedId: selectedId || null, elapsedMs: elapsed, correct, inTime, outcome, passed: outcome === "pass" };
  }

  function isDirectionRunPassed(results, questionCount = DIRECTION_QUESTION_COUNT) {
    return Array.isArray(results) && results.length === questionCount && results.every((result) => result.passed);
  }

  function createDailyDeck(activities, progress, today = dateKey(), starred = {}, options = {}) {
    const deckNonce = options.deckNonce || DECK_REVISION;
    const prioritiseRealErrors = options.prioritiseRealErrors !== false;
    function pick(mode) {
      return activities
        .filter((activity) => activity.mode === mode)
        .sort((a, b) => compareRank(
          activityRank(a, progress, today, starred, hashString(`${deckNonce}:${today}:${mode}:${a.key}`), prioritiseRealErrors),
          activityRank(b, progress, today, starred, hashString(`${deckNonce}:${today}:${mode}:${b.key}`), prioritiseRealErrors)
        ))
        .slice(0, DAILY_PER_MODE)
        .map((activity) => activity.key);
    }
    const spelling = pick("spelling");
    const recognition = pick("recognition");
    return seededShuffle([...spelling, ...recognition], `${today}:daily:${deckNonce}`);
  }

  function prepareDaily(state, activities, today = dateKey()) {
    if (state.daily && state.daily.date === today && Array.isArray(state.daily.queue)) return state;
    const isFreshBaseline = Object.keys(state.progress || {}).length === 0;
    const baseKeys = createDailyDeck(activities, state.progress, today, state.starred, {
      deckNonce: state.deckNonce || DECK_REVISION,
      prioritiseRealErrors: !isFreshBaseline,
    });
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
    const current = record && typeof record === "object" ? record : { stage: 0, lapses: 0, passes: 0, attempts: 0 };
    if (outcome === "pass") {
      const stage = Math.min((current.stage || 0) + 1, INTERVALS.length);
      return {
        ...current,
        stage,
        attempts: (current.attempts || 0) + 1,
        passes: (current.passes || 0) + 1,
        lastSeen: today,
        due: addDays(today, INTERVALS[Math.max(0, stage - 1)]),
      };
    }
    return {
      ...current,
      stage: 0,
      attempts: (current.attempts || 0) + 1,
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

  function buildChoices(activity, activities, seed = activity.key) {
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
    return seededShuffle([target, ...meanings], `${activity.key}:${seed}:choices`);
  }

  function createBrowseDeck(sourceItems, filter = "all", seed = "default", starred = {}) {
    return sourceItems
      .filter((item) => {
        if (filter === "spelling") return item.modes.includes("spelling");
        if (filter === "recognition") return item.modes.includes("recognition");
        if (filter === "errors") return item.isRealError;
        if (filter === "starred") return Boolean(starred[item.id]);
        return true;
      })
      .slice()
      .sort((a, b) => hashString(`${seed}:${a.id}`) - hashString(`${seed}:${b.id}`));
  }

  function keyFor(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  function numberVariantMap(sourceItems) {
    const aliases = new Map();
    sourceItems.forEach((item) => {
      (item.numberVariants || []).forEach((variant) => aliases.set(keyFor(variant), item.id));
    });
    return aliases;
  }

  function mergeProgressRecords(first, second) {
    if (!first) return { ...second };
    if (!second) return { ...first };
    const dueDates = [first.due, second.due].filter(Boolean).sort();
    const seenDates = [first.lastSeen, second.lastSeen].filter(Boolean).sort();
    return {
      ...first,
      ...second,
      stage: Math.max(first.stage || 0, second.stage || 0),
      attempts: (first.attempts || 0) + (second.attempts || 0),
      passes: (first.passes || 0) + (second.passes || 0),
      lapses: (first.lapses || 0) + (second.lapses || 0),
      due: dueDates[0] || "",
      lastSeen: seenDates.at(-1) || "",
    };
  }

  function remapActivityKey(activityKey, aliases) {
    const match = String(activityKey || "").match(/^(.*):(spelling|recognition)$/);
    if (!match) return activityKey;
    return `${aliases.get(match[1]) || match[1]}:${match[2]}`;
  }

  function migrateNumberVariantState(state, sourceItems) {
    const aliases = numberVariantMap(sourceItems);
    if (!aliases.size) return state;

    const progress = {};
    Object.entries(state.progress || {}).forEach(([key, record]) => {
      const canonical = remapActivityKey(key, aliases);
      progress[canonical] = mergeProgressRecords(progress[canonical], record);
    });
    state.progress = progress;

    const starred = {};
    Object.entries(state.starred || {}).forEach(([id, active]) => {
      if (active) starred[aliases.get(id) || id] = true;
    });
    state.starred = starred;

    const canonicalItems = new Map(sourceItems.map((item) => [item.id, item]));
    const customItems = new Map();
    (state.customItems || []).map(cleanCustomEntry).forEach((entry) => {
      const id = aliases.get(entry.id) || entry.id;
      const canonical = canonicalItems.get(id);
      const migrated = canonical ? { ...entry, id, term: canonical.term } : entry;
      const existing = customItems.get(id);
      customItems.set(id, existing
        ? { ...existing, ...migrated, modes: [...new Set([...existing.modes, ...migrated.modes])] }
        : migrated);
    });
    state.customItems = [...customItems.values()];

    if (!state.daily) return state;
    const uniqueKeys = (values) => {
      const seen = new Set();
      return (values || []).map((key) => remapActivityKey(key, aliases)).filter((key) => {
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };
    state.daily.baseKeys = uniqueKeys(state.daily.baseKeys);
    const queueSeen = new Set();
    state.daily.queue = (state.daily.queue || []).map((entry) => ({
      ...entry,
      key: remapActivityKey(entry.key, aliases),
    })).filter((entry) => {
      const signature = `${entry.isRetry ? "retry" : "base"}:${entry.key}`;
      if (queueSeen.has(signature)) return false;
      queueSeen.add(signature);
      return true;
    });

    const remapObject = (value, combine) => Object.entries(value || {}).reduce((result, [key, entry]) => {
      const canonical = remapActivityKey(key, aliases);
      result[canonical] = canonical in result ? combine(result[canonical], entry) : entry;
      return result;
    }, {});
    const outcomeRank = { pass: 0, slow: 1, fail: 2 };
    state.daily.answeredBase = remapObject(state.daily.answeredBase, (a, b) => Boolean(a || b));
    state.daily.outcomes = remapObject(state.daily.outcomes,
      (a, b) => (outcomeRank[b] || 0) > (outcomeRank[a] || 0) ? b : a);
    state.daily.retryCount = remapObject(state.daily.retryCount, (a, b) => Math.max(a || 0, b || 0));
    return state;
  }

  function normaliseModes(value) {
    const values = Array.isArray(value) ? value : String(value || "").split(/[,+/，、\s]+/);
    const modes = new Set();
    values.forEach((entry) => {
      const mode = String(entry).trim().toLowerCase();
      if (["spelling", "听写", "拼写", "听力"].includes(mode)) modes.add("spelling");
      if (["recognition", "识词", "看义", "阅读", "识义"].includes(mode)) modes.add("recognition");
      if (["both", "两类", "全部"].includes(mode)) { modes.add("spelling"); modes.add("recognition"); }
    });
    return [...modes];
  }

  function cleanCustomEntry(raw) {
    const term = String(raw.term || raw.word || "").trim();
    const meaning = String(raw.meaning || raw.translation || "").trim();
    const modes = normaliseModes(raw.modes || raw.mode || raw.type);
    if (!term || !meaning || !modes.length) throw new Error("每条错词都要有英文、中文意思和训练类型");
    if (!/^[A-Za-z][A-Za-z '\-]*$/.test(term)) throw new Error(`英文格式不正确：${term}`);
    const id = keyFor(term);
    return {
      id,
      term,
      meaning,
      modes,
      reason: String(raw.reason || raw.note || raw.errorNote || "个人错词").trim() || "个人错词",
      category: String(raw.category || "我的同步错词").trim(),
      addedAt: String(raw.addedAt || dateKey()),
    };
  }

  function parseWrongWordInput(text) {
    const value = String(text || "").trim();
    if (!value) return [];
    let rows;
    if (value.startsWith("[") || value.startsWith("{")) {
      const parsed = JSON.parse(value);
      rows = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.entries) ? parsed.entries : [parsed]);
    } else {
      rows = value.split(/\r?\n/).filter((line) => line.trim()).map((line) => {
        const cells = line.split(/\s*[|｜\t]\s*/);
        if (cells.length < 3) throw new Error(`无法识别这一行：${line}`);
        return { term: cells[0], meaning: cells[1], mode: cells[2], reason: cells.slice(3).join(" | ") };
      });
    }
    const merged = new Map();
    rows.map(cleanCustomEntry).forEach((entry) => {
      const existing = merged.get(entry.id);
      if (!existing) merged.set(entry.id, entry);
      else merged.set(entry.id, { ...existing, ...entry, modes: [...new Set([...existing.modes, ...entry.modes])] });
    });
    return [...merged.values()];
  }

  function mergeCustomItems(sourceItems, customItems) {
    const merged = new Map(sourceItems.map((item) => [item.id, { ...item, modes: [...item.modes] }]));
    const aliases = numberVariantMap(sourceItems);
    customItems.map(cleanCustomEntry).forEach((entry) => {
      const canonicalId = aliases.get(entry.id) || entry.id;
      const existing = merged.get(canonicalId);
      if (existing) {
        merged.set(canonicalId, {
          ...existing,
          meaning: entry.meaning || existing.meaning,
          modes: [...new Set([...existing.modes, ...entry.modes])].sort(),
          isRealError: true,
          errorNote: entry.reason,
          userAddedAt: entry.addedAt,
          acceptedAnswers: [existing.term],
          audioText: existing.term,
          audioPath: existing.audioPath || `audio/${existing.id}.mp3`,
        });
      } else {
        merged.set(canonicalId, {
          ...entry,
          sections: ["我的同步错词"],
          isRealError: true,
          acceptedAnswers: [entry.term],
          note: entry.reason,
          errorNote: entry.reason,
          audioText: entry.term,
          audioPath: `audio/${entry.id}.mp3`,
          sourceRevision: "local",
        });
      }
    });
    return [...merged.values()];
  }

  function diffAnswer(typed, expected) {
    const value = String(typed || "");
    return [...value].map((char, index) => {
      const correct = char.toLowerCase() === (expected[index] || "").toLowerCase();
      return `<span class="${correct ? "" : "wrong-char"}">${escapeHtml(char || " ")}</span>`;
    }).join("") || "（空白）";
  }

  function shouldRevealAnswer() {
    return true;
  }

  const api = {
    dateKey, addDays, hashString, normaliseAnswer, makeActivities, safeState,
    createDailyDeck, prepareDaily, scheduleReview, insertRetry, buildChoices,
    createBrowseDeck, parseWrongWordInput, mergeCustomItems, migrateNumberVariantState, seededShuffle,
    createDirectionDeck, judgeDirectionAttempt, isDirectionRunPassed,
    resetTrainingState, applyTrainingReset, shouldRevealAnswer,
    RESPONSE_LIMIT_MS, DIRECTION_RESPONSE_LIMIT_MS, DIRECTION_QUESTION_COUNT,
    INTERVALS, BROWSE_PAGE_SIZE, APP_VERSION, TRAINING_RESET_ID, DECK_REVISION,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof document === "undefined") return;

  let sourceItems = [];
  let directions = [];
  let items = [];
  let activities = [];
  let activityMap = new Map();
  let state = safeState(null);
  let recognitionStartedAt = 0;
  let recognitionTimerId = null;
  let activeAudio = null;
  let currentResult = null;
  let browseFilter = "all";
  let browseSeed = `${dateKey()}:browse`;
  let browsePage = 1;
  let directionRun = null;
  let directionStartedAt = 0;
  let directionTimerId = null;
  let directionDeadlineId = null;
  let directionFeedbackId = null;
  let directionAnswered = false;
  let directionAudio = null;
  const screen = document.getElementById("screen");
  const rail = document.getElementById("signal-rail");
  const dayCount = document.getElementById("day-count");
  const screenTitle = document.getElementById("screen-title");
  const appShell = document.getElementById("app");
  const versionButton = document.getElementById("app-version");

  function loadState() {
    try { state = safeState(JSON.parse(localStorage.getItem(STORAGE_KEY))); }
    catch (_) { state = safeState(null); }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    updateChrome();
  }

  async function fetchLatestVersion() {
    const response = await fetch(`./version.json?check=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  async function showVersionStatus() {
    if (!versionButton) return;
    versionButton.textContent = APP_VERSION;
    versionButton.setAttribute("aria-label", `当前版本 ${APP_VERSION}，点击检查更新`);
    try {
      const latest = await fetchLatestVersion();
      const hasUpdate = latest.version && latest.version !== APP_VERSION;
      versionButton.classList.toggle("update-available", hasUpdate);
      if (hasUpdate) {
        versionButton.textContent = `${APP_VERSION} · 更新`;
        versionButton.setAttribute("aria-label", `当前版本 ${APP_VERSION}，最新版本 ${latest.version}，点击更新`);
      }
    } catch (_) {
      versionButton.title = "当前离线，仍可继续训练";
    }
  }

  async function forceAppUpdate() {
    if (!versionButton || versionButton.disabled) return;
    const original = versionButton.textContent;
    versionButton.disabled = true;
    versionButton.textContent = "检查中…";
    try {
      const latest = await fetchLatestVersion();
      if ("serviceWorker" in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.update()));
      }
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.filter((key) => key.startsWith("ielts-listening-")).map((key) => caches.delete(key)));
      }
      const url = new URL(window.location.href);
      url.searchParams.set("v", latest.version || APP_VERSION);
      url.searchParams.set("refresh", Date.now());
      window.location.replace(url.toString());
    } catch (_) {
      versionButton.textContent = "离线";
      versionButton.title = "联网后再点版本号检查更新";
      setTimeout(() => {
        versionButton.disabled = false;
        versionButton.textContent = original;
      }, 1400);
    }
  }

  function rebuildDecks() {
    items = mergeCustomItems(sourceItems, state.customItems);
    activities = makeActivities(items);
    activityMap = new Map(activities.map((activity) => [activity.key, activity]));
  }

  function reconcileSyncedCustomItems() {
    const published = new Map(sourceItems.filter((item) => item.sourceType === "user").map((item) => [item.id, item]));
    state.customItems = state.customItems.filter((custom) => {
      const item = published.get(custom.id || keyFor(custom.term));
      if (!item) return true;
      const modes = normaliseModes(custom.modes || custom.mode);
      return !modes.every((mode) => item.modes.includes(mode));
    });
  }

  function toggleStar(itemId) {
    if (state.starred[itemId]) delete state.starred[itemId];
    else state.starred[itemId] = true;
    saveState();
    return Boolean(state.starred[itemId]);
  }

  function starButton(item, className = "star-button") {
    const active = Boolean(state.starred[item.id]);
    return `<button class="${className}${active ? " active" : ""}" data-star="${escapeHtml(item.id)}" aria-label="${active ? "取消重点" : "标为重点"}" aria-pressed="${active}">${active ? "★" : "☆"}</button>`;
  }

  function itemStats(item) {
    const records = item.modes.map((mode) => state.progress[`${item.id}:${mode}`]).filter(Boolean);
    return records.reduce((summary, record) => ({
      attempts: summary.attempts + (record.attempts || (record.passes || 0) + (record.lapses || 0)),
      passes: summary.passes + (record.passes || 0),
      lapses: summary.lapses + (record.lapses || 0),
      stage: Math.max(summary.stage, record.stage || 0),
      due: !summary.due || (record.due && record.due < summary.due) ? record.due : summary.due,
    }), { attempts: 0, passes: 0, lapses: 0, stage: 0, due: "" });
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

  function updateDirectionChrome() {
    const results = directionRun?.results || [];
    dayCount.textContent = `${results.length}/${DIRECTION_QUESTION_COUNT}`;
    rail.innerHTML = Array.from({ length: DIRECTION_QUESTION_COUNT }, (_, index) => {
      const result = results[index];
      const css = result ? (result.passed ? " done" : " weak") : "";
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
    const direction = mode === "direction";
    appShell.classList.toggle("browse-mode", browsing);
    appShell.classList.toggle("direction-mode", direction);
    screenTitle.textContent = browsing ? "随便刷" : (direction ? "方位检测" : "今日 50");
    if (browsing) dayCount.textContent = "∞";
    else if (direction) updateDirectionChrome();
    else updateChrome();
  }

  function homeScreen() {
    window.scrollTo(0, 0);
    setShellMode("daily");
    const done = baseDone();
    const remainingRetries = state.daily.queue.filter((entry) => entry.isRetry).length;
    const buttonText = state.daily.completed ? "今天已完成" : (state.daily.started ? "继续训练" : "开始今日 50");
    const totalErrors = Object.values(state.progress).reduce((sum, record) => sum + (record.lapses || 0), 0);
    const starredCount = Object.keys(state.starred).length;
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
        <button id="direction" class="direction-entry">
          <span><strong>方位检测</strong><small>10 题 · 听音后 2 秒选中位置</small></span>
          <b aria-hidden="true">⌖</b>
        </button>
        <button id="browse" class="browse-entry">
          <span><strong>随便刷</strong><small>分页浏览、全词发音，想停就停</small></span>
          <b aria-hidden="true">∞</b>
        </button>
        <div class="home-actions">
          <button id="inbox" class="compact-entry">
            <span><strong>错词收件箱</strong><small>${state.customItems.length} 条待同步</small></span><b>＋</b>
          </button>
          <button id="starred" class="compact-entry">
            <span><strong>重点词</strong><small>${starredCount} 个已标记</small></span><b>★</b>
          </button>
        </div>
        <div class="memory-summary">
          <span>累计错误 <strong>${totalErrors}</strong></span>
          <span>记忆阶段 <strong>1—6</strong></span>
        </div>
        <p class="status-line">连续 ${state.streak || 0} 天${remainingRetries ? ` · 还有 ${remainingRetries} 个回炉题` : ""}</p>
        <details>
          <summary>进度与备份</summary>
          <div class="tools">
            <button id="export" class="secondary">导出学习进度</button>
            <label class="secondary file-label">导入学习进度<input id="import" type="file" accept="application/json"></label>
            <button id="reset-training" class="secondary danger-button">重新开始正式训练</button>
            <p>词库 ${items.length} 条 · 飞书 revision ${items[0]?.sourceRevision || "-"}</p>
          </div>
        </details>
      </section>`;
    document.getElementById("start")?.addEventListener("click", () => {
      state.daily.started = true;
      saveState();
      renderCurrent();
    });
    document.getElementById("direction")?.addEventListener("click", directionIntroScreen);
    document.getElementById("browse")?.addEventListener("click", browseScreen);
    document.getElementById("inbox")?.addEventListener("click", inboxScreen);
    document.getElementById("starred")?.addEventListener("click", () => {
      browseFilter = "starred";
      browsePage = 1;
      browseScreen();
    });
    document.getElementById("export")?.addEventListener("click", exportProgress);
    document.getElementById("import")?.addEventListener("change", importProgress);
    document.getElementById("reset-training")?.addEventListener("click", () => {
      if (!window.confirm("确定清空正式训练进度并重新抽取 50 题吗？错词库和重点标记会保留。")) return;
      state = resetTrainingState(state, TRAINING_RESET_ID, `manual-${Date.now()}`);
      prepareDaily(state, activities);
      saveState();
      homeScreen();
    });
  }

  function clearDirectionTiming() {
    clearInterval(directionTimerId);
    clearTimeout(directionDeadlineId);
    clearTimeout(directionFeedbackId);
    directionTimerId = null;
    directionDeadlineId = null;
    directionFeedbackId = null;
    directionStartedAt = 0;
  }

  function stopDirectionAudio() {
    if (!directionAudio) return;
    directionAudio.pause();
    directionAudio.onplaying = null;
    directionAudio.onerror = null;
  }

  function leaveDirection() {
    clearDirectionTiming();
    stopDirectionAudio();
    directionRun = null;
    homeScreen();
  }

  function directionBoardMarkup(interactive = true) {
    const nodes = directions.map((direction) => {
      const position = `grid-row:${direction.row + 1};grid-column:${direction.column + 1}`;
      if (!interactive) return `<span class="direction-target direction-target-preview" style="${position}"></span>`;
      return `<button class="direction-target" type="button" data-direction="${escapeHtml(direction.id)}"
        style="${position}" aria-label="${escapeHtml(direction.meaning)}方位" disabled><span></span></button>`;
    }).join("");
    return `<div class="direction-board${interactive ? "" : " direction-board-preview"}">
      ${nodes}
      <div class="direction-origin" aria-hidden="true"><span></span></div>
    </div>`;
  }

  function directionIntroScreen() {
    window.scrollTo(0, 0);
    clearDirectionTiming();
    stopDirectionAudio();
    directionRun = null;
    setShellMode("direction");
    screen.innerHTML = `
      <section class="direction-intro">
        <div class="direction-toolbar">
          <button id="direction-back" class="text-button">← 今日任务</button>
          <span class="mode-label">AUDIO · 2 秒</span>
        </div>
        <div class="direction-intro-card">
          <p class="eyebrow">8-WAY REFLEX</p>
          <h2>听到英文，立即点方位。</h2>
          <p>每轮 10 题。八个方向都会出现，全部答对且每题不超过 2 秒才算过关。</p>
          ${directionBoardMarkup(false)}
          <div class="direction-rules">
            <span><b>01</b> 只播放英文</span>
            <span><b>02</b> 圆点没有文字</span>
            <span><b>03</b> 不能题内重播</span>
          </div>
        </div>
        <button id="direction-start" class="primary">开始 10 题</button>
      </section>`;
    document.getElementById("direction-back").addEventListener("click", leaveDirection);
    document.getElementById("direction-start").addEventListener("click", startDirectionRun);
  }

  function startDirectionRun() {
    clearDirectionTiming();
    stopDirectionAudio();
    directionRun = {
      deck: createDirectionDeck(directions, `${Date.now()}:${Math.random()}`),
      results: [],
    };
    renderDirectionQuestion();
  }

  function playDirectionPrompt(question) {
    if (!directionAudio) directionAudio = new Audio();
    directionAudio.pause();
    directionAudio.currentTime = 0;
    directionAudio.src = `./${question.audioPath}`;
    directionAudio.preload = "auto";
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback) => {
        if (settled) return;
        settled = true;
        directionAudio.onplaying = null;
        directionAudio.onerror = null;
        callback();
      };
      directionAudio.onplaying = () => finish(resolve);
      directionAudio.onerror = () => finish(() => reject(new Error("audio")));
      const playing = directionAudio.play();
      if (playing?.catch) playing.catch(() => finish(() => reject(new Error("audio"))));
    });
  }

  function startDirectionCountdown() {
    const board = document.querySelector(".direction-board");
    const timerBar = document.getElementById("direction-timer-bar");
    const timerCount = document.getElementById("direction-timer-count");
    const prompt = document.getElementById("direction-prompt");
    if (!directionRun || !board || !timerBar || !timerCount || !prompt) return;
    directionAnswered = false;
    directionStartedAt = performance.now();
    board.classList.add("ready");
    prompt.textContent = "现在选择";
    timerBar.classList.remove("paused");
    document.querySelectorAll(".direction-target").forEach((button) => { button.disabled = false; });
    directionTimerId = setInterval(() => {
      const remaining = Math.max(0, DIRECTION_RESPONSE_LIMIT_MS - (performance.now() - directionStartedAt));
      timerCount.textContent = remaining > 0 ? (remaining / 1000).toFixed(1) : "超时";
      timerCount.classList.toggle("expired", remaining === 0);
    }, 50);
    directionDeadlineId = setTimeout(() => finishDirectionAnswer(null), DIRECTION_RESPONSE_LIMIT_MS);
  }

  function showDirectionAudioError(question) {
    const prompt = document.getElementById("direction-prompt");
    const retry = document.getElementById("direction-audio-retry");
    if (!directionRun || !prompt || !retry) return;
    prompt.textContent = "音频没有开始，本题尚未计时";
    retry.hidden = false;
    retry.onclick = () => {
      retry.hidden = true;
      prompt.textContent = "准备播放…";
      playDirectionPrompt(question).then(startDirectionCountdown).catch(() => showDirectionAudioError(question));
    };
  }

  function renderDirectionQuestion() {
    window.scrollTo(0, 0);
    clearDirectionTiming();
    setShellMode("direction");
    if (!directionRun || directionRun.results.length >= DIRECTION_QUESTION_COUNT) {
      renderDirectionResult();
      return;
    }
    directionAnswered = true;
    const index = directionRun.results.length;
    const question = directionRun.deck[index];
    screen.innerHTML = `
      <section class="direction-session">
        <div class="direction-toolbar">
          <button id="direction-exit" class="text-button">← 退出</button>
          <span class="mode-label">第 ${index + 1}/${DIRECTION_QUESTION_COUNT} 题</span>
        </div>
        <div class="direction-card">
          <div class="timer-label"><span>反应时间</span><strong id="direction-timer-count">2.0</strong></div>
          <div class="timer"><div id="direction-timer-bar" class="direction-timer-bar paused"></div></div>
          <p id="direction-prompt" class="direction-prompt" aria-live="polite">准备播放…</p>
          ${directionBoardMarkup(true)}
          <div id="direction-feedback" class="direction-feedback" aria-live="polite"></div>
          <button id="direction-audio-retry" class="test-play direction-audio-retry" type="button" hidden>重新播放</button>
        </div>
      </section>`;
    document.getElementById("direction-exit").addEventListener("click", leaveDirection);
    document.querySelectorAll(".direction-target").forEach((button) => {
      button.addEventListener("click", () => finishDirectionAnswer(button.dataset.direction));
    });
    playDirectionPrompt(question).then(startDirectionCountdown).catch(() => showDirectionAudioError(question));
  }

  function finishDirectionAnswer(selectedId) {
    if (directionAnswered || !directionRun || !directionStartedAt) return;
    directionAnswered = true;
    clearInterval(directionTimerId);
    clearTimeout(directionDeadlineId);
    directionTimerId = null;
    directionDeadlineId = null;
    const index = directionRun.results.length;
    const question = directionRun.deck[index];
    const elapsed = selectedId ? performance.now() - directionStartedAt : DIRECTION_RESPONSE_LIMIT_MS;
    const result = {
      ...judgeDirectionAttempt(question.id, selectedId, elapsed),
      term: question.term,
      meaning: question.meaning,
    };
    directionRun.results.push(result);
    document.querySelectorAll(".direction-target").forEach((button) => {
      button.disabled = true;
      if (button.dataset.direction === question.id) button.classList.add("correct");
      if (selectedId && button.dataset.direction === selectedId && selectedId !== question.id) button.classList.add("wrong");
    });
    const timerCount = document.getElementById("direction-timer-count");
    const timerBar = document.getElementById("direction-timer-bar");
    if (timerCount) {
      timerCount.textContent = result.outcome === "timeout" ? "超时" : `${(result.elapsedMs / 1000).toFixed(2)}s`;
      timerCount.classList.toggle("expired", !result.passed);
    }
    timerBar?.classList.add("stopped");
    const label = result.passed ? "答对" : (result.outcome === "timeout" ? "超时" : (result.outcome === "slow" ? "超过 2 秒" : "选错"));
    const feedback = document.getElementById("direction-feedback");
    if (feedback) {
      feedback.className = `direction-feedback visible ${result.passed ? "pass" : "weak"}`;
      feedback.innerHTML = `<strong>${escapeHtml(question.term)}</strong><span>${escapeHtml(question.meaning)} · ${label}</span>`;
    }
    updateDirectionChrome();
    directionFeedbackId = setTimeout(renderDirectionQuestion, 700);
  }

  function renderDirectionResult() {
    window.scrollTo(0, 0);
    clearDirectionTiming();
    stopDirectionAudio();
    setShellMode("direction");
    const results = directionRun?.results || [];
    const passedCount = results.filter((result) => result.passed).length;
    const passed = isDirectionRunPassed(results);
    const average = results.length ? results.reduce((sum, result) => sum + result.elapsedMs, 0) / results.length : 0;
    const misses = results.filter((result) => !result.passed);
    const directionMap = new Map(directions.map((direction) => [direction.id, direction]));
    const missesMarkup = misses.length ? `
      <div class="direction-misses">
        <p>需要再练</p>
        ${misses.map((result) => {
          const selected = directionMap.get(result.selectedId);
          const reason = result.outcome === "timeout" ? "超时" : (result.outcome === "slow" ? `${(result.elapsedMs / 1000).toFixed(2)} 秒` : `误选 ${selected?.meaning || "其他方位"}`);
          return `<div><strong>${escapeHtml(result.term)} · ${escapeHtml(result.meaning)}</strong><span>${escapeHtml(reason)}</span></div>`;
        }).join("")}
      </div>` : "";
    screen.innerHTML = `
      <section class="direction-result">
        <div class="direction-toolbar">
          <button id="direction-result-home" class="text-button">← 今日任务</button>
          <span class="mode-label">本轮完成</span>
        </div>
        <div class="direction-result-card">
          <p class="result-mark ${passed ? "pass" : "weak"}">${passed ? "方位反射合格" : "本轮还未过关"}</p>
          <div class="direction-score"><strong>${passedCount}</strong><span>/10</span></div>
          <p>${passed ? "十题全部在 2 秒内答对。" : "必须十题全部答对且不超时，再来一轮。"}</p>
          <div class="direction-result-stat"><span>平均反应</span><strong>${(average / 1000).toFixed(2)} 秒</strong></div>
          ${missesMarkup}
        </div>
        <button id="direction-restart" class="primary">再测一次</button>
        <button id="direction-finish-home" class="secondary direction-home-button">返回首页</button>
      </section>`;
    document.getElementById("direction-result-home").addEventListener("click", leaveDirection);
    document.getElementById("direction-finish-home").addEventListener("click", leaveDirection);
    document.getElementById("direction-restart").addEventListener("click", startDirectionRun);
  }

  function sessionMeta(entry, activity) {
    const label = activity.mode === "spelling" ? "听音拼写" : "快速看义";
    return `<div class="session-toolbar">
      <button id="pause-session" class="text-button">← 暂停</button>
      <div class="session-meta"><span class="mode-label">${label}</span><span>${entry.isRetry ? '<b class="retry-label">回炉题</b>' : `${baseDone() + 1}/50`}</span></div>
      ${starButton(activity, "session-star")}
    </div>`;
  }

  function bindSessionToolbar(activity) {
    document.getElementById("pause-session")?.addEventListener("click", () => {
      clearInterval(recognitionTimerId);
      saveState();
      homeScreen();
    });
    document.querySelector(".session-star")?.addEventListener("click", (event) => {
      const active = toggleStar(activity.id);
      event.currentTarget.classList.toggle("active", active);
      event.currentTarget.textContent = active ? "★" : "☆";
      event.currentTarget.setAttribute("aria-pressed", String(active));
    });
  }

  function renderSpelling(entry, activity) {
    window.scrollTo(0, 0);
    screen.innerHTML = `
      <section class="session">
        ${sessionMeta(entry, activity)}
        <div class="question-card">
          <p class="prompt">会自动读一遍，写出完整英文</p>
          <div class="play-zone">
            <button id="play" class="play-button" aria-label="再读一次">▶ 再读</button>
            <p class="play-hint">单复数、空格、连字符都要准确</p>
          </div>
        </div>
        <form id="spelling-form" class="spelling-form">
          <input id="answer" class="spelling-input" type="text" inputmode="text"
            autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false"
            enterkeyhint="done" aria-label="输入英文答案" placeholder="输入你听到的词">
          <div class="answer-actions">
            <button class="submit-button" type="submit">检查拼写</button>
            <button id="spelling-dont-know" class="dont-know-button" type="button">不会</button>
          </div>
        </form>
      </section>`;
    const playButton = document.getElementById("play");
    playButton.addEventListener("click", () => playAudio(activity, playButton));
    bindSessionToolbar(activity);
    document.getElementById("spelling-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const typed = document.getElementById("answer").value;
      if (!normaliseAnswer(typed)) return;
      const correct = activity.acceptedAnswers.some((answer) => normaliseAnswer(answer) === normaliseAnswer(typed));
      recordAttempt(entry, activity, correct ? "pass" : "fail", { typed });
    });
    document.getElementById("spelling-dont-know").addEventListener("click", () => {
      recordAttempt(entry, activity, "fail", { skipped: true });
    });
    playAudio(activity, playButton);
  }

  function renderRecognition(entry, activity) {
    window.scrollTo(0, 0);
    clearInterval(recognitionTimerId);
    recognitionStartedAt = 0;
    const choices = buildChoices(activity, activities, `${Date.now()}:${Math.random()}`);
    screen.innerHTML = `
      <section class="session">
        ${sessionMeta(entry, activity)}
        <div class="question-card">
          <div class="timer-label"><span>反应时间</span><strong id="timer-count">5</strong></div>
          <div class="timer"><div id="timer-bar" class="timer-bar paused"></div></div>
          <p class="prompt">选出最直接的意思</p>
          <div class="recognition-term">
            <h2 class="term">${escapeHtml(activity.term)}</h2>
            <button id="recognition-play" class="test-play" type="button" aria-label="再读一次">▶ 再读</button>
          </div>
          <div class="choices">
            ${choices.map((choice) => `<button class="choice" data-choice="${escapeHtml(choice)}">${escapeHtml(choice)}</button>`).join("")}
          </div>
          <button id="recognition-dont-know" class="dont-know-button" type="button">不会</button>
        </div>
      </section>`;
    const timerCount = document.getElementById("timer-count");
    const timerBar = document.getElementById("timer-bar");
    const playButton = document.getElementById("recognition-play");
    bindSessionToolbar(activity);
    const startTimer = () => {
      if (recognitionStartedAt || !screen.contains(timerBar)) return;
      recognitionStartedAt = performance.now();
      timerBar.classList.remove("paused");
      recognitionTimerId = setInterval(() => {
        const remaining = Math.max(0, Math.ceil((RESPONSE_LIMIT_MS - (performance.now() - recognitionStartedAt)) / 1000));
        timerCount.textContent = remaining > 0 ? String(remaining) : "超时";
        timerCount.classList.toggle("expired", remaining === 0);
        if (remaining === 0) clearInterval(recognitionTimerId);
      }, 100);
    };
    playButton.addEventListener("click", () => playAudio(activity, playButton));
    document.querySelectorAll(".choice").forEach((button) => button.addEventListener("click", () => {
      clearInterval(recognitionTimerId);
      const elapsed = recognitionStartedAt ? performance.now() - recognitionStartedAt : 0;
      const selected = button.dataset.choice;
      const correct = selected === activity.meaning;
      const outcome = correct && elapsed <= RESPONSE_LIMIT_MS ? "pass" : (correct ? "slow" : "fail");
      recordAttempt(entry, activity, outcome, { selected, elapsed });
    }));
    document.getElementById("recognition-dont-know").addEventListener("click", () => {
      clearInterval(recognitionTimerId);
      recordAttempt(entry, activity, "fail", { skipped: true });
    });
    playAudio(activity, playButton).then(startTimer);
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
    const deck = createBrowseDeck(items, browseFilter, browseSeed, state.starred);
    const pageCount = Math.max(1, Math.ceil(deck.length / BROWSE_PAGE_SIZE));
    browsePage = Math.min(Math.max(1, browsePage), pageCount);
    const pageItems = deck.slice((browsePage - 1) * BROWSE_PAGE_SIZE, browsePage * BROWSE_PAGE_SIZE);
    const filters = [
      ["all", "全部"],
      ["spelling", "听写"],
      ["recognition", "看懂"],
      ["errors", "我的错词"],
      ["starred", "重点词"],
    ];
    screen.innerHTML = `
      <section class="browse">
        <div class="browse-toolbar">
          <button id="browse-back" class="text-button">← 今日任务</button>
          <button id="browse-shuffle" class="text-button">换个顺序</button>
        </div>
        <div class="browse-intro">
          <p>每页 ${BROWSE_PAGE_SIZE} 个。听发音、做标记，刷完一页就能停。</p>
          <span>${deck.length} 条</span>
        </div>
        <div class="filter-strip" role="group" aria-label="筛选词表">
          ${filters.map(([value, label]) => `<button class="filter-chip${browseFilter === value ? " active" : ""}" data-filter="${value}">${label}</button>`).join("")}
        </div>
        <div class="word-stream">
          ${pageItems.length ? pageItems.map((item) => browseCard(item)).join("") : '<div class="empty-card"><strong>这里还没有词</strong><p>答题或浏览时点 ☆，就会收进重点词。</p></div>'}
        </div>
        ${pagination(pageCount)}
      </section>`;
    document.getElementById("browse-back").addEventListener("click", homeScreen);
    document.getElementById("browse-shuffle").addEventListener("click", () => {
      browseSeed = `${Date.now()}:${Math.random()}`;
      browsePage = 1;
      browseScreen();
    });
    document.querySelectorAll(".filter-chip").forEach((button) => button.addEventListener("click", () => {
      browseFilter = button.dataset.filter;
      browsePage = 1;
      browseScreen();
    }));
    document.querySelectorAll(".mini-play").forEach((button) => button.addEventListener("click", () => {
      const item = items.find((candidate) => candidate.id === button.dataset.id);
      if (item) playAudio(item, button);
    }));
    document.querySelectorAll(".star-button").forEach((button) => button.addEventListener("click", () => {
      toggleStar(button.dataset.star);
      browseScreen();
    }));
    document.querySelectorAll("[data-page]").forEach((button) => button.addEventListener("click", () => {
      browsePage = Number(button.dataset.page);
      browseScreen();
    }));
  }

  function pagination(pageCount) {
    return `<nav class="pagination" aria-label="词表翻页">
      <button class="secondary" data-page="${Math.max(1, browsePage - 1)}" ${browsePage === 1 ? "disabled" : ""}>上一页</button>
      <span><strong>${browsePage}</strong> / ${pageCount}</span>
      <button class="secondary" data-page="${Math.min(pageCount, browsePage + 1)}" ${browsePage === pageCount ? "disabled" : ""}>下一页</button>
    </nav>`;
  }

  function browseCard(item) {
    const tags = [];
    if (item.modes.includes("spelling")) tags.push("听写");
    if (item.modes.includes("recognition")) tags.push("看懂");
    if (item.isRealError) tags.push("错词");
    if (state.starred[item.id]) tags.push("重点");
    const rawNote = String(item.errorNote || item.note || "").trim();
    const note = /^[-—–]+$/.test(rawNote) ? "" : rawNote;
    const stats = itemStats(item);
    return `
      <article class="word-card${item.isRealError ? " real-error" : ""}${state.starred[item.id] ? " starred" : ""}">
        <div class="word-main">
          <div>
            <h2>${escapeHtml(item.term)}</h2>
            <p>${escapeHtml(item.meaning)}</p>
          </div>
          <div class="word-actions">
            ${starButton(item)}
            <button class="mini-play" data-id="${escapeHtml(item.id)}" aria-label="播放 ${escapeHtml(item.term)}">▶</button>
          </div>
        </div>
        ${note ? `<p class="word-note">${escapeHtml(note)}</p>` : ""}
        <div class="word-tags">${tags.map((tag) => `<span>${tag}</span>`).join("")}</div>
        ${stats.attempts ? `<div class="word-stats"><span>错 ${stats.lapses}</span><span>对 ${stats.passes}</span><span>阶段 ${stats.stage}/6</span>${stats.due ? `<span>复习 ${escapeHtml(stats.due)}</span>` : ""}</div>` : ""}
      </article>`;
  }

  function recordAttempt(entry, activity, outcome, detail) {
    state.daily.queue.shift();
    if (!entry.isRetry && !state.daily.answeredBase[activity.key]) {
      state.daily.answeredBase[activity.key] = true;
      state.daily.outcomes[activity.key] = outcome;
      state.progress[activity.key] = scheduleReview(state.progress[activity.key], outcome, state.daily.date);
    } else if (entry.isRetry) {
      const record = state.progress[activity.key] || { stage: 0, passes: 0, lapses: 0, attempts: 0, lastSeen: state.daily.date, due: addDays(state.daily.date, 1) };
      state.progress[activity.key] = {
        ...record,
        attempts: (record.attempts || 0) + 1,
        passes: (record.passes || 0) + (outcome === "pass" ? 1 : 0),
        lapses: (record.lapses || 0) + (outcome === "pass" ? 0 : 1),
      };
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
    const record = state.progress[activity.key] || {};
    const label = detail.skipped ? "已标记为不会" : (pass ? "本次通过" : (outcome === "slow" ? "答对了，但超过 5 秒" : "这次答错了"));
    const typed = detail.skipped
      ? `<p class="typed">你选择了：不会</p>`
      : (detail.typed !== undefined
      ? `<p class="typed">你写的是：${diffAnswer(detail.typed, activity.term)}</p>`
      : (detail.selected ? `<p class="typed">你选的是：${escapeHtml(detail.selected)}</p>` : ""));
    screen.innerHTML = `
      <section class="result">
        <div class="result-toolbar">
          <button id="result-home" class="text-button">← 暂停</button>
          ${starButton(activity, "session-star")}
        </div>
        <div class="result-card">
          <p class="result-mark ${pass ? "pass" : "weak"}">${label}</p>
          <div class="answer-row">
            <h2 class="answer">${escapeHtml(activity.term)}</h2>
            <button id="result-play" class="test-play" type="button" aria-label="再读一次">▶ 再读</button>
          </div>
          <p class="meaning">${escapeHtml(activity.meaning)}</p>
          ${typed}
          <p class="note">${escapeHtml(activity.errorNote || activity.note || "")}${pass ? "" : " · 已放回今天的队列"}</p>
          <div class="memory-strip">
            <span><b>${record.lapses || 0}</b>累计错误</span>
            <span><b>${record.passes || 0}</b>累计答对</span>
            <span><b>${record.stage || 0}/6</b>记忆阶段</span>
            <span><b>${escapeHtml(record.due || "—")}</b>下次复习</span>
          </div>
        </div>
        <button id="continue" class="primary">继续</button>
      </section>`;
    document.getElementById("continue").addEventListener("click", renderCurrent);
    const resultPlayButton = document.getElementById("result-play");
    resultPlayButton.addEventListener("click", () => playAudio(activity, resultPlayButton));
    document.getElementById("result-home").addEventListener("click", () => {
      saveState();
      homeScreen();
    });
    document.querySelector(".session-star")?.addEventListener("click", (event) => {
      const active = toggleStar(activity.id);
      event.currentTarget.classList.toggle("active", active);
      event.currentTarget.textContent = active ? "★" : "☆";
    });
  }

  function playAudio(activity, targetButton) {
    const button = targetButton || document.getElementById("play");
    if (activeAudio) {
      activeAudio.pause();
      activeAudio = null;
    }
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    button?.classList.add("playing");
    const finish = () => button?.classList.remove("playing");
    return new Promise((resolve) => {
      let started = false;
      let fallbackUsed = false;
      let audio = null;
      const markStarted = () => {
        if (started) return;
        started = true;
        resolve();
      };
      const useFallback = () => {
        if (fallbackUsed) return;
        fallbackUsed = true;
        if (activeAudio === audio) activeAudio = null;
        finish();
        markStarted();
        speakFallback(activity.audioText || activity.term);
      };
      if (!activity.audioPath) {
        useFallback();
        return;
      }
      audio = new Audio(`./${activity.audioPath}`);
      activeAudio = audio;
      audio.addEventListener("playing", markStarted, { once: true });
      audio.addEventListener("ended", () => {
        if (activeAudio === audio) activeAudio = null;
        finish();
      }, { once: true });
      audio.addEventListener("error", useFallback, { once: true });
      audio.play().then(markStarted).catch(useFallback);
    });
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

  function wrongWordPrompt() {
    return `请把我接下来提供的 IELTS 阅读/听力错词整理成纯 JSON 数组，不要解释。每项格式：{"term":"英文词或短语","meaning":"准确中文义","mode":"spelling 或 recognition 或 both","reason":"我错在哪里"}。听错、没拼对、单复数或词形错误归 spelling；不认识、选项没看懂、词义混淆归 recognition；两种问题都有归 both。`;
  }

  async function copyText(value) {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
    const area = document.createElement("textarea");
    area.value = value;
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }

  function syncPackage() {
    return JSON.stringify({ version: 1, entries: state.customItems }, null, 2);
  }

  function inboxScreen() {
    window.scrollTo(0, 0);
    setShellMode("browse");
    screenTitle.textContent = "错词收件箱";
    dayCount.textContent = String(state.customItems.length);
    screen.innerHTML = `
      <section class="inbox-screen">
        <div class="browse-toolbar">
          <button id="inbox-back" class="text-button">← 今日任务</button>
          <button id="copy-gpt-prompt" class="text-button">复制给 GPT 的要求</button>
        </div>
        <div class="inbox-hero">
          <p class="eyebrow">GPT / CODEX / MANUAL</p>
          <h2>谁帮你总结都行，最后都进同一个词库。</h2>
          <p>把 GPT 输出的 JSON，或每行“英文 | 中文 | 类型 | 错误原因”粘到下面。类型可写 spelling、recognition 或 both。</p>
        </div>
        <label class="inbox-label" for="wrong-word-input">粘贴错词包</label>
        <textarea id="wrong-word-input" class="inbox-input" rows="9" placeholder='[{"term":"retain","meaning":"保留","mode":"recognition","reason":"和 obtain 混淆"}]'></textarea>
        <button id="import-wrong-words" class="primary">检查并加入本机词库</button>
        <p id="inbox-message" class="inbox-message" aria-live="polite"></p>
        <div class="sync-card">
          <div><strong>本机新增 ${state.customItems.length} 条</strong><p>提交到 GitHub 后，其他设备也会获得这些词。</p></div>
          <button id="submit-sync" class="secondary" ${state.customItems.length ? "" : "disabled"}>提交同步</button>
          <button id="copy-package" class="secondary" ${state.customItems.length ? "" : "disabled"}>复制同步包</button>
        </div>
      </section>`;
    const message = document.getElementById("inbox-message");
    document.getElementById("inbox-back").addEventListener("click", homeScreen);
    document.getElementById("copy-gpt-prompt").addEventListener("click", async () => {
      await copyText(wrongWordPrompt());
      message.textContent = "已复制。发给任意网页 GPT，再把它输出的 JSON 粘回来。";
    });
    document.getElementById("import-wrong-words").addEventListener("click", () => {
      try {
        const entries = parseWrongWordInput(document.getElementById("wrong-word-input").value);
        if (!entries.length) throw new Error("还没有粘贴错词");
        const merged = new Map(state.customItems.map((item) => [item.id || keyFor(item.term), cleanCustomEntry(item)]));
        entries.forEach((entry) => {
          const existing = merged.get(entry.id);
          merged.set(entry.id, existing ? { ...existing, ...entry, modes: [...new Set([...existing.modes, ...entry.modes])] } : entry);
        });
        state.customItems = [...merged.values()];
        rebuildDecks();
        saveState();
        message.textContent = `已加入 ${entries.length} 条，本机现在就能刷；正在等待提交到 GitHub。`;
        setTimeout(inboxScreen, 650);
      } catch (error) {
        message.textContent = `没有导入：${error.message}`;
        message.classList.add("error");
      }
    });
    document.getElementById("copy-package").addEventListener("click", async () => {
      await copyText(syncPackage());
      message.textContent = "同步包已复制，可以直接发给任意 Codex 入库。";
    });
    document.getElementById("submit-sync").addEventListener("click", async () => {
      const body = `请自动导入以下错词包。\n\n\`\`\`json\n${syncPackage()}\n\`\`\``;
      const url = `${REPOSITORY_URL}/issues/new?title=${encodeURIComponent(`[错词同步] ${dateKey()} ${state.customItems.length}条`)}&body=${encodeURIComponent(body)}`;
      if (url.length > 7000) {
        await copyText(syncPackage());
        window.open(`${REPOSITORY_URL}/issues/new`, "_blank", "noopener");
        message.textContent = "词太多，已复制同步包。请在新建 Issue 中粘贴并提交。";
      } else {
        window.open(url, "_blank", "noopener");
        message.textContent = "已打开 GitHub 提交页，确认内容后点 Submit new issue。";
      }
    });
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
        if (![1, 2, 3].includes(parsed.version) || !parsed.progress) throw new Error("invalid");
        state = safeState(parsed);
        migrateNumberVariantState(state, sourceItems);
        rebuildDecks();
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
      versionButton?.addEventListener("click", forceAppUpdate);
      showVersionStatus();
      const [response, directionResponse] = await Promise.all([
        fetch(`./data/listening.json?v=${encodeURIComponent(APP_VERSION)}`),
        fetch(`./data/directions.json?v=${encodeURIComponent(APP_VERSION)}`),
      ]);
      if (!response.ok || !directionResponse.ok) throw new Error(`HTTP ${response.status}/${directionResponse.status}`);
      [sourceItems, directions] = await Promise.all([response.json(), directionResponse.json()]);
      loadState();
      state = applyTrainingReset(state);
      migrateNumberVariantState(state, sourceItems);
      reconcileSyncedCustomItems();
      rebuildDecks();
      prepareDaily(state, activities);
      saveState();
      homeScreen();
      if ("serviceWorker" in navigator) {
        const hadController = Boolean(navigator.serviceWorker.controller);
        let refreshing = false;
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          if (hadController && !refreshing) {
            refreshing = true;
            window.location.reload();
          }
        });
        navigator.serviceWorker.register(`./sw.js?v=${encodeURIComponent(APP_VERSION)}`, { updateViaCache: "none" })
          .then((registration) => registration.update())
          .catch(() => {});
      }
    } catch (error) {
      screen.innerHTML = `<section class="finished"><h2>词库没有加载成功</h2><p>${escapeHtml(error.message)}。联网后刷新页面再试。</p></section>`;
    }
  }

  init();
}());
