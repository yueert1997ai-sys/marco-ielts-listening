(function () {
  "use strict";

  const STORAGE_KEY = "marcoIeltsListening.v1";
  const APP_VERSION = "v2.11.3";
  const AUTO_UPDATE_SESSION_KEY = "marcoIeltsListening.autoUpdateAttempt";
  const AUTO_UPDATE_THROTTLE_MS = 60 * 1000;
  const TRAINING_RESET_ID = "fresh-start-v2.5.0";
  const LEARNING_REVIEW_SPLIT_ID = "learning-review-v2.9.0";
  const DECK_REVISION = "whole-bank-v2";
  const DAILY_PER_MODE = 25;
  const DAILY_REVIEW_LIMIT = 30;
  const ERROR_TRAINING_PER_MODE = 25;
  const BROWSE_PAGE_SIZE = 20;
  const RESPONSE_LIMIT_MS = 5000;
  const DIRECTION_RESPONSE_LIMIT_MS = 2000;
  const HARD_DIRECTION_RESPONSE_LIMIT_MS = 1000;
  const HARD_DIRECTION_PLAYBACK_RATE = 1.4;
  const DIRECTION_QUESTION_COUNT = 10;
  const HARD_DIRECTION_IDS = ["northeast", "southeast", "southwest", "northwest"];
  const AUDIO_PLAYBACK_RATE = 1.2;
  const QUICK_PASS_DELAY_MS = 560;
  const SPELLING_MEANING_DELAY_MS = 950;
  const QUESTION_TRANSITION_MS = 180;
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
      reviewDaily: null,
      errorDaily: null,
      streak: 0,
      lastCompletedDate: null,
      trainingResetId: null,
      deckNonce: DECK_REVISION,
      learningReviewSplitId: null,
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
      reviewDaily: raw.reviewDaily && typeof raw.reviewDaily === "object" ? raw.reviewDaily : null,
      errorDaily: raw.errorDaily && typeof raw.errorDaily === "object" ? raw.errorDaily : null,
    };
  }

  function resetTrainingState(current, resetId = TRAINING_RESET_ID, deckNonce = resetId) {
    const preserved = safeState(current);
    return {
      ...preserved,
      progress: {},
      daily: null,
      reviewDaily: null,
      errorDaily: null,
      streak: 0,
      lastCompletedDate: null,
      trainingResetId: resetId,
      deckNonce,
      learningReviewSplitId: LEARNING_REVIEW_SPLIT_ID,
    };
  }

  function applyTrainingReset(current) {
    const safe = safeState(current);
    return safe.trainingResetId === TRAINING_RESET_ID
      ? safe
      : resetTrainingState(safe, TRAINING_RESET_ID, DECK_REVISION);
  }

  function applyLearningReviewSplit(current) {
    const safe = safeState(current);
    if (safe.learningReviewSplitId === LEARNING_REVIEW_SPLIT_ID) return safe;
    return {
      ...safe,
      daily: null,
      reviewDaily: null,
      learningReviewSplitId: LEARNING_REVIEW_SPLIT_ID,
    };
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

  function createDirectionDeck(directions, seed = "direction", options = {}) {
    const allowedIds = Array.isArray(options.allowedIds) ? [...new Set(options.allowedIds)] : null;
    const questionCount = options.questionCount || DIRECTION_QUESTION_COUNT;
    const allUnique = [...new Map((directions || []).map((item) => [item.id, item])).values()];
    const unique = allowedIds ? allUnique.filter((item) => allowedIds.includes(item.id)) : allUnique;
    const expectedCount = allowedIds ? allowedIds.length : 8;
    if (unique.length !== expectedCount) throw new Error(`方位检测需要正好 ${expectedCount} 个不同方向`);
    if (questionCount < unique.length) throw new Error("题目数量不能少于方位数量");
    const pool = [];
    for (let round = 0; pool.length < questionCount; round += 1) {
      const batch = seededShuffle(unique, `${seed}:round:${round}`);
      pool.push(...batch.slice(0, questionCount - pool.length));
    }
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const deck = seededShuffle(pool, `${seed}:deck:${attempt}`);
      if (deck.every((item, index) => index === 0 || item.id !== deck[index - 1].id)) return deck;
    }
    throw new Error("方位题目没有成功打乱");
  }

  function createHardDirectionDeck(directions, seed = "hard-direction") {
    return createDirectionDeck(directions, seed, { allowedIds: HARD_DIRECTION_IDS });
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

  function createLearningDeck(activities, progress, today = dateKey(), starred = {}, deckNonce = DECK_REVISION) {
    function pick(mode) {
      return activities
        .filter((activity) => activity.mode === mode && !progress[activity.key])
        .sort((a, b) => compareRank(
          [starred[a.id] ? 0 : 1, hashString(`${deckNonce}:${today}:learn:${mode}:${a.key}`)],
          [starred[b.id] ? 0 : 1, hashString(`${deckNonce}:${today}:learn:${mode}:${b.key}`)]
        ))
        .slice(0, DAILY_PER_MODE)
        .map((activity) => activity.key);
    }
    return seededShuffle([...pick("spelling"), ...pick("recognition")], `${today}:learning:${deckNonce}`);
  }

  function createReviewDeck(activities, progress, today = dateKey(), limit = DAILY_REVIEW_LIMIT) {
    const candidates = activities.filter((activity) => {
      const record = progress[activity.key];
      return record && (record.lapses || 0) > 0 && (!record.due || record.due <= today);
    });
    candidates.sort((a, b) => {
      const first = progress[a.key];
      const second = progress[b.key];
      return compareRank(
        [-(first.lapses || 0), first.due || "", first.stage || 0, hashString(`${today}:review:${a.key}`)],
        [-(second.lapses || 0), second.due || "", second.stage || 0, hashString(`${today}:review:${b.key}`)]
      );
    });
    return seededShuffle(candidates.slice(0, limit).map((activity) => activity.key), `${today}:review-order`);
  }

  function createErrorTrainingDeck(activities, today = dateKey(), starred = {}, limitPerMode = ERROR_TRAINING_PER_MODE) {
    function pick(mode) {
      const candidates = activities.filter((activity) => activity.mode === mode && activity.isRealError);
      const important = candidates.filter((activity) => starred[activity.id]);
      const ordinary = candidates.filter((activity) => !starred[activity.id]);
      return [
        ...seededShuffle(important, `${today}:errors:${mode}:starred`),
        ...seededShuffle(ordinary, `${today}:errors:${mode}:ordinary`),
      ].slice(0, limitPerMode).map((activity) => activity.key);
    }
    return seededShuffle([...pick("spelling"), ...pick("recognition")], `${today}:errors:order`);
  }

  function makeDailySession(date, baseKeys) {
    return {
      date,
      baseKeys,
      queue: baseKeys.map((key) => ({ key, isRetry: false })),
      answeredBase: {},
      outcomes: {},
      retryCount: {},
      started: false,
      completed: baseKeys.length === 0,
    };
  }

  function enqueueReviewActivity(reviewDaily, key) {
    if (!reviewDaily || !key) return false;
    if (!reviewDaily.baseKeys.includes(key)) reviewDaily.baseKeys.push(key);
    const alreadyPending = reviewDaily.queue.some((entry) => entry.key === key);
    if (!alreadyPending) reviewDaily.queue.push({ key, isRetry: false });
    reviewDaily.completed = false;
    return !alreadyPending;
  }

  function prepareDaily(state, activities, today = dateKey()) {
    if (!state.daily || state.daily.date !== today || !Array.isArray(state.daily.queue)) {
      const learningKeys = createLearningDeck(activities, state.progress, today, state.starred, state.deckNonce || DECK_REVISION);
      state.daily = makeDailySession(today, learningKeys);
    }
    if (!state.reviewDaily || state.reviewDaily.date !== today || !Array.isArray(state.reviewDaily.queue)) {
      const reviewKeys = createReviewDeck(activities, state.progress, today);
      state.reviewDaily = makeDailySession(today, reviewKeys);
    }
    if (!state.errorDaily || state.errorDaily.date !== today || !Array.isArray(state.errorDaily.queue)) {
      const errorKeys = createErrorTrainingDeck(activities, today, state.starred);
      state.errorDaily = makeDailySession(today, errorKeys);
    }
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

  function partOfSpeechForMeaning(activity, meaning, activities) {
    if (meaning === activity.meaning) return activity.partOfSpeech || "词性待补";
    const match = activities.find((item) =>
      item.mode === "recognition" && item.meaning === meaning && item.partOfSpeech
    );
    return match?.partOfSpeech || "词性待补";
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

    const sessions = [state.daily, state.reviewDaily, state.errorDaily].filter(Boolean);
    if (!sessions.length) return state;
    const uniqueKeys = (values) => {
      const seen = new Set();
      return (values || []).map((key) => remapActivityKey(key, aliases)).filter((key) => {
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };
    const remapObject = (value, combine) => Object.entries(value || {}).reduce((result, [key, entry]) => {
      const canonical = remapActivityKey(key, aliases);
      result[canonical] = canonical in result ? combine(result[canonical], entry) : entry;
      return result;
    }, {});
    const outcomeRank = { pass: 0, slow: 1, fail: 2 };
    sessions.forEach((session) => {
      session.baseKeys = uniqueKeys(session.baseKeys);
      const queueSeen = new Set();
      session.queue = (session.queue || []).map((entry) => ({
        ...entry,
        key: remapActivityKey(entry.key, aliases),
      })).filter((entry) => {
        const signature = `${entry.isRetry ? "retry" : "base"}:${entry.key}`;
        if (queueSeen.has(signature)) return false;
        queueSeen.add(signature);
        return true;
      });
      session.answeredBase = remapObject(session.answeredBase, (a, b) => Boolean(a || b));
      session.outcomes = remapObject(session.outcomes,
        (a, b) => (outcomeRank[b] || 0) > (outcomeRank[a] || 0) ? b : a);
      session.retryCount = remapObject(session.retryCount, (a, b) => Math.max(a || 0, b || 0));
    });
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
    if (!/^[A-Za-z0-9][A-Za-z0-9 '&\-]*$/.test(term)) throw new Error(`英文格式不正确：${term}`);
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

  function normalisePastedText(text) {
    return String(text || "")
      .replace(/(?:&#x20;|&#32;|&nbsp;)/gi, " ")
      .replace(/[‘’]/g, "'")
      .replace(/[–—]/g, "-");
  }

  function parseWrongWordDrafts(text, knownItems = []) {
    const value = normalisePastedText(text).trim();
    if (!value) return [];
    if (value.startsWith("[") || value.startsWith("{")) return parseWrongWordInput(value);

    const lines = value.split(/\r?\n/).flatMap((rawLine) => {
      const line = rawLine.trim();
      if (!line) return [];
      if (!/[\u3400-\u9fff]/.test(line) && /[,，;；]/.test(line)) {
        return line.split(/\s*[,，;；]\s*/).filter(Boolean);
      }
      return [line];
    });
    const known = new Map(knownItems.map((item) => [keyFor(item.term), item]));
    const drafts = [];

    const addDraft = (termValue, meaningValue = "", hint = "") => {
      const term = String(termValue || "").trim().replace(/^[`'\"]+|[`'\".,;:!?]+$/g, "");
      if (!term) return;
      if (!/^[A-Za-z0-9][A-Za-z0-9 '&\-]*$/.test(term)) throw new Error(`英文格式不正确：${term}`);
      const id = keyFor(term);
      const matched = known.get(id);
      const usageOnly = /^(?:作为|作|形容词|名词|动词|副词|不认识|不确定|听不懂|拼写)/.test(meaningValue.trim());
      const meaning = usageOnly ? (matched?.meaning || "") : (meaningValue.trim() || matched?.meaning || "");
      drafts.push({
        id: matched?.id || id,
        term: matched?.term || term,
        meaning,
        modes: ["recognition"],
        reason: hint || (usageOnly ? `随手粘贴：${meaningValue.trim()}` : "随手粘贴：识义"),
        category: "我的同步错词",
        addedAt: dateKey(),
        matched: Boolean(matched),
      });
    };

    lines.forEach((rawLine) => {
      const line = rawLine
        .replace(/^\s*(?:[-*•·]\s+|\d{1,3}\s*[.)、）]\s*)/, "")
        .trim();
      if (!line) return;

      const pipeCells = line.split(/\s*[|｜\t]\s*/);
      if (pipeCells.length >= 2) {
        const mode = pipeCells[2] || "recognition";
        const entry = cleanCustomEntry({
          term: pipeCells[0], meaning: pipeCells[1], mode,
          reason: pipeCells.slice(3).join(" | ") || "随手粘贴：识义",
        });
        drafts.push({ ...entry, matched: known.has(entry.id) });
        return;
      }

      const chineseIndex = line.search(/[\u3400-\u9fff]/);
      const termPart = (chineseIndex >= 0 ? line.slice(0, chineseIndex) : line)
        .replace(/\s*[:：=-]\s*$/, "").trim();
      const meaningPart = chineseIndex >= 0
        ? line.slice(chineseIndex).replace(/^\s*[:：=-]\s*/, "").trim()
        : "";
      const exact = known.get(keyFor(termPart));
      if (exact || meaningPart) {
        addDraft(termPart, meaningPart);
        return;
      }

      const tokens = termPart.split(/\s+/).filter(Boolean);
      if (tokens.length > 1 && tokens.every((token) => known.has(keyFor(token)))) {
        tokens.forEach((token) => addDraft(token));
        return;
      }
      addDraft(termPart);
    });

    const merged = new Map();
    drafts.forEach((entry) => {
      const existing = merged.get(entry.id);
      if (!existing) merged.set(entry.id, entry);
      else merged.set(entry.id, {
        ...existing,
        ...entry,
        meaning: entry.meaning || existing.meaning,
        modes: [...new Set([...existing.modes, ...entry.modes])],
        matched: existing.matched || entry.matched,
      });
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

  function hasVersionUpdate(currentVersion, latestVersion) {
    return Boolean(latestVersion && latestVersion !== currentVersion);
  }

  function shouldAutoAdvance(outcome) {
    return outcome === "pass";
  }

  function formatResultNote(note, outcome, sessionKind) {
    const rawDetail = String(note || "").trim();
    const detail = /^[—–-]+$/.test(rawDetail) ? "" : rawDetail;
    const followUp = outcome === "pass"
      ? ""
      : (sessionKind === "learning" ? "已加入高频复习" : (sessionKind === "errors" ? "已放回错词专项队列" : "已放回复习队列"));
    return [detail, followUp].filter(Boolean).join(" · ");
  }

  const api = {
    dateKey, addDays, hashString, normaliseAnswer, makeActivities, safeState,
    createDailyDeck, createLearningDeck, createReviewDeck, createErrorTrainingDeck, prepareDaily, scheduleReview, insertRetry, buildChoices,
    partOfSpeechForMeaning,
    createBrowseDeck, parseWrongWordInput, parseWrongWordDrafts, mergeCustomItems, migrateNumberVariantState, seededShuffle,
    createDirectionDeck, createHardDirectionDeck, judgeDirectionAttempt, isDirectionRunPassed,
    resetTrainingState, applyTrainingReset, applyLearningReviewSplit, enqueueReviewActivity, shouldRevealAnswer,
    hasVersionUpdate, shouldAutoAdvance, formatResultNote,
    RESPONSE_LIMIT_MS, DIRECTION_RESPONSE_LIMIT_MS, HARD_DIRECTION_RESPONSE_LIMIT_MS,
    AUDIO_PLAYBACK_RATE, HARD_DIRECTION_PLAYBACK_RATE, QUICK_PASS_DELAY_MS, SPELLING_MEANING_DELAY_MS, QUESTION_TRANSITION_MS,
    DIRECTION_QUESTION_COUNT, HARD_DIRECTION_IDS,
    INTERVALS, BROWSE_PAGE_SIZE, DAILY_REVIEW_LIMIT, ERROR_TRAINING_PER_MODE, APP_VERSION,
    TRAINING_RESET_ID, LEARNING_REVIEW_SPLIT_ID, DECK_REVISION,
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
  let preloadedAudio = null;
  let preloadedAudioPath = "";
  let currentResult = null;
  let browseFilter = "all";
  let browseSeed = `${dateKey()}:browse`;
  let browsePage = 1;
  let activeTrainingKind = "learning";
  let directionRun = null;
  let directionStartedAt = 0;
  let directionTimerId = null;
  let directionDeadlineId = null;
  let directionFeedbackId = null;
  let directionAnswered = false;
  let directionAudio = null;
  let directionMode = "standard";
  let automaticUpdateReady = false;
  let automaticUpdateCheckInFlight = false;
  let lastAutomaticUpdateCheckAt = 0;
  let appReloading = false;
  const directionModes = {
    standard: {
      id: "standard",
      responseLimitMs: DIRECTION_RESPONSE_LIMIT_MS,
      playbackRate: 1,
      directionIds: null,
      eyebrow: "8-WAY REFLEX",
      description: "八个方向都会出现，全部答对且每题不超过 2 秒才算过关。",
    },
    hard: {
      id: "hard",
      responseLimitMs: HARD_DIRECTION_RESPONSE_LIMIT_MS,
      playbackRate: HARD_DIRECTION_PLAYBACK_RATE,
      directionIds: HARD_DIRECTION_IDS,
      eyebrow: "45° REFLEX",
      description: "只考东北、东南、西南、西北，音频以 1.4 倍速播放，每题不超过 1 秒。",
    },
  };
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

  function getAutomaticUpdateAttempt() {
    try { return sessionStorage.getItem(AUTO_UPDATE_SESSION_KEY); }
    catch (_) { return null; }
  }

  function setAutomaticUpdateAttempt(version) {
    try {
      if (version) sessionStorage.setItem(AUTO_UPDATE_SESSION_KEY, version);
      else sessionStorage.removeItem(AUTO_UPDATE_SESSION_KEY);
    } catch (_) {}
  }

  function canApplyAutomaticUpdate() {
    return Boolean(screen.querySelector(".home"));
  }

  async function showVersionStatus({ autoApply = false } = {}) {
    if (!versionButton) return;
    versionButton.textContent = APP_VERSION;
    versionButton.setAttribute("aria-label", `当前版本 ${APP_VERSION}，点击检查更新`);
    try {
      const latest = await fetchLatestVersion();
      const hasUpdate = hasVersionUpdate(APP_VERSION, latest.version);
      versionButton.classList.toggle("update-available", hasUpdate);
      if (hasUpdate) {
        versionButton.textContent = `${APP_VERSION} · 更新`;
        versionButton.setAttribute("aria-label", `当前版本 ${APP_VERSION}，最新版本 ${latest.version}，点击更新`);
        if (autoApply && canApplyAutomaticUpdate() && getAutomaticUpdateAttempt() !== latest.version) {
          setAutomaticUpdateAttempt(latest.version);
          await forceAppUpdate(latest);
        }
      } else {
        setAutomaticUpdateAttempt(null);
      }
    } catch (_) {
      versionButton.title = "当前离线，仍可继续训练";
    }
  }

  async function forceAppUpdate(latestHint = null) {
    if (!versionButton || versionButton.disabled) return;
    const original = versionButton.textContent;
    versionButton.disabled = true;
    versionButton.textContent = "检查中…";
    try {
      const latest = latestHint || await fetchLatestVersion();
      if (!hasVersionUpdate(APP_VERSION, latest.version)) {
        versionButton.textContent = "已是最新";
        setTimeout(() => {
          versionButton.disabled = false;
          versionButton.textContent = APP_VERSION;
        }, 1400);
        return;
      }
      if ("serviceWorker" in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.update()));
      }
      const url = new URL(window.location.href);
      url.searchParams.set("v", latest.version || APP_VERSION);
      url.searchParams.set("refresh", Date.now());
      appReloading = true;
      window.location.replace(url.toString());
    } catch (_) {
      setAutomaticUpdateAttempt(null);
      versionButton.textContent = "离线";
      versionButton.title = "联网后再点版本号检查更新";
      setTimeout(() => {
        versionButton.disabled = false;
        versionButton.textContent = original;
      }, 1400);
    }
  }

  function requestAutomaticUpdateCheck({ force = false } = {}) {
    if (!automaticUpdateReady || automaticUpdateCheckInFlight || document.visibilityState === "hidden") return;
    if (!canApplyAutomaticUpdate()) return;
    const now = Date.now();
    if (!force && now - lastAutomaticUpdateCheckAt < AUTO_UPDATE_THROTTLE_MS) return;
    lastAutomaticUpdateCheckAt = now;
    automaticUpdateCheckInFlight = true;
    showVersionStatus({ autoApply: true }).finally(() => { automaticUpdateCheckInFlight = false; });
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

  function currentTrainingSession() {
    if (activeTrainingKind === "review") return state.reviewDaily;
    if (activeTrainingKind === "errors") return state.errorDaily;
    return state.daily;
  }

  function sessionDone(session) {
    return session ? Object.keys(session.answeredBase || {}).length : 0;
  }

  function baseDone() {
    return sessionDone(currentTrainingSession());
  }

  function updateChrome() {
    const session = currentTrainingSession() || { baseKeys: [], outcomes: {} };
    const total = session.baseKeys.length;
    dayCount.textContent = `${sessionDone(session)}/${total}`;
    rail.style.gridTemplateColumns = `repeat(${Math.max(1, total)}, 1fr)`;
    rail.innerHTML = Array.from({ length: total }, (_, index) => {
      const key = session.baseKeys[index];
      const outcome = key ? session.outcomes[key] : null;
      const css = outcome ? (outcome === "pass" ? " done" : " weak") : "";
      return `<span class="signal-tick${css}"></span>`;
    }).join("");
  }

  function updateDirectionChrome() {
    const results = directionRun?.results || [];
    dayCount.textContent = `${results.length}/${DIRECTION_QUESTION_COUNT}`;
    rail.style.gridTemplateColumns = `repeat(${DIRECTION_QUESTION_COUNT}, 1fr)`;
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

  function setShellMode(mode, activeSession = false) {
    const browsing = mode === "browse";
    const direction = mode === "direction";
    const reviewing = mode === "review";
    const errorTraining = mode === "errors";
    appShell.classList.toggle("active-session", activeSession);
    appShell.classList.toggle("browse-mode", browsing);
    appShell.classList.toggle("direction-mode", direction);
    screenTitle.textContent = browsing ? "随便刷" : (direction ? "方位检测" : (reviewing ? "高频复习" : (errorTraining ? "错词专项" : "今日新词")));
    if (browsing) dayCount.textContent = "∞";
    else if (direction) updateDirectionChrome();
    else updateChrome();
  }

  function homeScreen() {
    window.scrollTo(0, 0);
    activeTrainingKind = "learning";
    setShellMode("daily");
    const done = sessionDone(state.daily);
    const learningTotal = state.daily.baseKeys.length;
    const learningSpelling = state.daily.baseKeys.filter((key) => key.endsWith(":spelling")).length;
    const learningRecognition = state.daily.baseKeys.filter((key) => key.endsWith(":recognition")).length;
    const reviewPending = state.reviewDaily.queue.length;
    const errorTrainingPending = state.errorDaily.queue.length;
    const buttonText = state.daily.completed ? "今日已完成" : (state.daily.started ? "继续训练" : "开始训练");
    const remaining = Math.max(0, learningTotal - done);
    const errorPoolCount = new Set(Object.entries(state.progress)
      .filter(([, record]) => (record.lapses || 0) > 0)
      .map(([key]) => key.replace(/:(spelling|recognition)$/, ""))).size;
    const starredCount = Object.keys(state.starred).length;
    screen.innerHTML = `
      <section class="home">
        <div class="home-card">
          <div class="home-card-head">
            <div>
              <p class="eyebrow">${escapeHtml(state.daily.date)} · 今日训练</p>
              <h2>${state.daily.completed ? "今天完成" : `还剩 ${remaining} 题`}</h2>
              <p>${learningSpelling} 听写 · ${learningRecognition} 识义</p>
            </div>
            <div class="home-progress" aria-label="今日已完成 ${done} / ${learningTotal}">
              <strong>${done}</strong><span>/${learningTotal}</span>
            </div>
          </div>
          <button id="start" class="primary" ${state.daily.completed ? "disabled" : ""}>${buttonText}</button>
        </div>
        <div class="home-core-actions">
          <button id="review" class="home-task review-task" ${reviewPending ? "" : "disabled"}>
            <span>高频复习</span><strong>${reviewPending ? `${reviewPending} 题` : "暂无"}</strong>
          </button>
          <button id="direction" class="home-task direction-task">
            <span>方位检测</span><strong>10 题</strong>
          </button>
        </div>
        <p class="status-line">连续 ${state.streak || 0} 天 · 复习池 ${errorPoolCount} 项</p>
        <details id="home-more" class="home-more">
          <summary><span>更多练习与设置</span><b aria-hidden="true">＋</b></summary>
          <div class="home-menu">
            <button id="error-training" class="menu-entry error-training-entry" ${errorTrainingPending ? "" : "disabled"}><span>错词专项</span><small>${errorTrainingPending ? `${errorTrainingPending} 题` : (state.errorDaily.completed ? "今日已完成" : "暂无错词")}</small></button>
            <button id="browse" class="menu-entry"><span>随便刷</span><small>自由浏览词库</small></button>
            <button id="starred" class="menu-entry"><span>重点词</span><small>${starredCount} 个</small></button>
            <button id="inbox" class="menu-entry"><span>错词收件箱</span><small>${state.customItems.length} 条待同步</small></button>
          </div>
          <div class="tools">
            <button id="export" class="secondary">导出学习进度</button>
            <label class="secondary file-label">导入学习进度<input id="import" type="file" accept="application/json"></label>
            <button id="reset-training" class="secondary danger-button">重新开始正式训练</button>
            <p>词库 ${items.length} 条 · 飞书 revision ${items[0]?.sourceRevision || "-"}</p>
          </div>
        </details>
      </section>`;
    document.getElementById("start")?.addEventListener("click", () => {
      activeTrainingKind = "learning";
      state.daily.started = true;
      saveState();
      renderCurrent();
    });
    document.getElementById("review")?.addEventListener("click", () => {
      activeTrainingKind = "review";
      state.reviewDaily.started = true;
      saveState();
      renderCurrent();
    });
    document.getElementById("direction")?.addEventListener("click", directionIntroScreen);
    document.getElementById("error-training")?.addEventListener("click", () => {
      activeTrainingKind = "errors";
      state.errorDaily.started = true;
      saveState();
      renderCurrent();
    });
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
      if (!window.confirm("确定清空新词和复习进度吗？错词库和重点标记会保留。")) return;
      state = resetTrainingState(state, TRAINING_RESET_ID, `manual-${Date.now()}`);
      prepareDaily(state, activities);
      saveState();
      homeScreen();
    });
    requestAutomaticUpdateCheck();
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

  function directionBoardMarkup(interactive = true, directionIds = null) {
    const allowed = Array.isArray(directionIds) ? new Set(directionIds) : null;
    const visibleDirections = allowed ? directions.filter((direction) => allowed.has(direction.id)) : directions;
    const diagonal = allowed && allowed.size === HARD_DIRECTION_IDS.length
      && HARD_DIRECTION_IDS.every((id) => allowed.has(id));
    const nodes = visibleDirections.map((direction) => {
      const position = `grid-row:${direction.row + 1};grid-column:${direction.column + 1}`;
      if (!interactive) return `<span class="direction-target direction-target-preview" style="${position}"></span>`;
      return `<button class="direction-target" type="button" data-direction="${escapeHtml(direction.id)}"
        style="${position}" aria-label="${escapeHtml(direction.meaning)}方位" disabled><span></span></button>`;
    }).join("");
    return `<div class="direction-board${interactive ? "" : " direction-board-preview"}${diagonal ? " direction-board-diagonal" : ""}">
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
    const config = directionModes[directionMode] || directionModes.standard;
    const seconds = config.responseLimitMs / 1000;
    screen.innerHTML = `
      <section class="direction-intro">
        <div class="direction-toolbar">
          <button id="direction-back" class="text-button">← 今日任务</button>
          <span class="mode-label">AUDIO · ${seconds} 秒${config.playbackRate > 1 ? ` · ${config.playbackRate}×` : ""}</span>
        </div>
        <div class="direction-mode-switch" role="group" aria-label="选择方位检测难度">
          <button type="button" data-direction-mode="standard" class="direction-mode-option${config.id === "standard" ? " active" : ""}" aria-pressed="${config.id === "standard"}">
            <span>标准模式</span><strong>8 方位 · 2.0s</strong>
          </button>
          <button type="button" data-direction-mode="hard" class="direction-mode-option hard${config.id === "hard" ? " active" : ""}" aria-pressed="${config.id === "hard"}">
            <span>困难模式</span><strong>45° · 1.0s</strong>
          </button>
        </div>
        <div class="direction-intro-card">
          <p class="eyebrow">${config.eyebrow}</p>
          <h2>听到英文，立即点方位。</h2>
          <p>每轮 10 题。${config.description}</p>
          ${directionBoardMarkup(false, config.directionIds)}
          <div class="direction-rules">
            <span><b>01</b> 只播放英文</span>
            <span><b>02</b> 圆点没有文字</span>
            <span><b>03</b> 不能题内重播</span>
          </div>
        </div>
        <button id="direction-start" class="primary">开始${config.id === "hard" ? "困难" : "标准"} 10 题</button>
      </section>`;
    document.getElementById("direction-back").addEventListener("click", leaveDirection);
    document.getElementById("direction-start").addEventListener("click", startDirectionRun);
    document.querySelectorAll("[data-direction-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        directionMode = button.dataset.directionMode;
        directionIntroScreen();
      });
    });
  }

  function startDirectionRun() {
    clearDirectionTiming();
    stopDirectionAudio();
    const config = directionModes[directionMode] || directionModes.standard;
    directionRun = {
      mode: config.id,
      responseLimitMs: config.responseLimitMs,
      playbackRate: config.playbackRate,
      directionIds: config.directionIds,
      deck: createDirectionDeck(directions, `${Date.now()}:${Math.random()}`, { allowedIds: config.directionIds }),
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
    const playbackRate = directionRun?.playbackRate || 1;
    directionAudio.defaultPlaybackRate = playbackRate;
    directionAudio.playbackRate = playbackRate;
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
    const responseLimitMs = directionRun.responseLimitMs || DIRECTION_RESPONSE_LIMIT_MS;
    directionAnswered = false;
    directionStartedAt = performance.now();
    board.classList.add("ready");
    prompt.textContent = "现在选择";
    timerBar.classList.remove("paused");
    document.querySelectorAll(".direction-target").forEach((button) => { button.disabled = false; });
    directionTimerId = setInterval(() => {
      const remaining = Math.max(0, responseLimitMs - (performance.now() - directionStartedAt));
      timerCount.textContent = remaining > 0 ? (remaining / 1000).toFixed(1) : "超时";
      timerCount.classList.toggle("expired", remaining === 0);
    }, 50);
    directionDeadlineId = setTimeout(() => finishDirectionAnswer(null), responseLimitMs);
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
    const responseLimitMs = directionRun.responseLimitMs || DIRECTION_RESPONSE_LIMIT_MS;
    screen.innerHTML = `
      <section class="direction-session">
        <div class="direction-toolbar">
          <button id="direction-exit" class="text-button">← 退出</button>
          <span class="mode-label">第 ${index + 1}/${DIRECTION_QUESTION_COUNT} 题</span>
        </div>
        <div class="direction-card">
          <div class="timer-label"><span>${directionRun.mode === "hard" ? `困难模式 · 45° · ${directionRun.playbackRate}×` : "标准模式 · 8 方位"}</span><strong id="direction-timer-count">${(responseLimitMs / 1000).toFixed(1)}</strong></div>
          <div class="timer"><div id="direction-timer-bar" class="direction-timer-bar paused" style="animation-duration:${responseLimitMs}ms"></div></div>
          <p id="direction-prompt" class="direction-prompt" aria-live="polite">准备播放…</p>
          ${directionBoardMarkup(true, directionRun.directionIds)}
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
    const responseLimitMs = directionRun.responseLimitMs || DIRECTION_RESPONSE_LIMIT_MS;
    const elapsed = selectedId ? performance.now() - directionStartedAt : responseLimitMs;
    const result = {
      ...judgeDirectionAttempt(question.id, selectedId, elapsed, responseLimitMs),
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
    const label = result.passed ? "答对" : (result.outcome === "timeout" ? "超时" : (result.outcome === "slow" ? `超过 ${responseLimitMs / 1000} 秒` : "选错"));
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
    const config = directionModes[directionRun?.mode] || directionModes.standard;
    const seconds = config.responseLimitMs / 1000;
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
          <span class="mode-label">${config.id === "hard" ? "困难" : "标准"} · 本轮完成</span>
        </div>
        <div class="direction-result-card">
          <p class="result-mark ${passed ? "pass" : "weak"}">${passed ? `${config.id === "hard" ? "45° " : ""}方位反射合格` : "本轮还未过关"}</p>
          <div class="direction-score"><strong>${passedCount}</strong><span>/10</span></div>
          <p>${passed ? `十题全部在 ${seconds} 秒内答对。` : `必须十题全部答对且每题不超过 ${seconds} 秒，再来一轮。`}</p>
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
    const modeLabel = activity.mode === "spelling" ? "听写" : "识义";
    return `<div class="session-toolbar">
      <button id="pause-session" class="text-button">← 暂停</button>
      <div class="session-meta"><span class="mode-label">${modeLabel}</span>${entry.isRetry ? '<b class="retry-label">回炉题</b>' : ""}</div>
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

  function primeUpcomingSpellingKeyboard() {
    const nextEntry = currentTrainingSession()?.queue?.[0];
    const nextActivity = nextEntry ? activityMap.get(nextEntry.key) : null;
    if (nextActivity?.mode !== "spelling") return;
    document.querySelector(".keyboard-primer")?.remove();
    const primer = document.createElement("input");
    primer.type = "text";
    primer.inputMode = "text";
    primer.autocomplete = "off";
    primer.tabIndex = -1;
    primer.className = "keyboard-primer";
    primer.setAttribute("aria-hidden", "true");
    document.body.append(primer);
    primer.focus({ preventScroll: true });
  }

  function renderSpelling(entry, activity) {
    window.scrollTo(0, 0);
    screen.innerHTML = `
      <section class="session">
        ${sessionMeta(entry, activity)}
        <div class="question-card">
          <p class="prompt">听音，写出完整英文</p>
          <div class="play-zone">
            <button id="play" class="play-button" aria-label="再读一次">▶ 再读</button>
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
    const answerInput = document.getElementById("answer");
    document.getElementById("spelling-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const typed = answerInput.value;
      if (!normaliseAnswer(typed)) return;
      const correct = activity.acceptedAnswers.some((answer) => normaliseAnswer(answer) === normaliseAnswer(typed));
      recordAttempt(entry, activity, correct ? "pass" : "fail", { typed });
    });
    document.getElementById("spelling-dont-know").addEventListener("click", () => {
      recordAttempt(entry, activity, "fail", { skipped: true });
    });
    answerInput.focus({ preventScroll: true });
    window.setTimeout(() => document.querySelector(".keyboard-primer")?.remove(), 0);
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
          <p class="prompt">选中文</p>
          <div class="recognition-term">
            <h2 class="term">${escapeHtml(activity.term)}</h2>
            <button id="recognition-play" class="test-play" type="button" aria-label="再读一次">▶ 再读</button>
          </div>
          <div class="choices">
            ${choices.map((choice) => `<button class="choice" data-choice="${escapeHtml(choice)}"><span class="choice-pos">${escapeHtml(partOfSpeechForMeaning(activity, choice, activities))}</span><span class="choice-meaning">${escapeHtml(choice)}</span></button>`).join("")}
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

  function renderCurrent(options = {}) {
    const session = currentTrainingSession();
    const shellMode = activeTrainingKind === "review" ? "review" : (activeTrainingKind === "errors" ? "errors" : "daily");
    setShellMode(shellMode, Boolean(session.queue[0]));
    updateChrome();
    const entry = session.queue[0];
    if (!entry) {
      if (activeTrainingKind === "learning") finishDay();
      else {
        session.completed = true;
        saveState();
      }
      const isReview = activeTrainingKind === "review";
      const isErrorTraining = activeTrainingKind === "errors";
      screen.innerHTML = `
        <section class="finished">
          <div class="hero-number">✓</div>
          <h2>${isErrorTraining ? "今天的错词专项完成" : (isReview ? "今天的复习清完了" : "今天的新词学完了")}</h2>
          <p>${isErrorTraining ? "这一轮只练了真实错词，训练结果已计入记忆曲线。" : (isReview ? "新词学习不受影响，明天再按错误频率和到期时间生成复习。" : "答错的词已进入独立复习池，不会堵住今天的新词进度。")}</p>
          <button id="back-home" class="secondary">返回首页</button>
        </section>`;
      document.getElementById("back-home").addEventListener("click", homeScreen);
      return;
    }
    const activity = activityMap.get(entry.key);
    if (!activity) {
      session.queue.shift();
      saveState();
      return renderCurrent();
    }
    if (activity.mode === "spelling") renderSpelling(entry, activity);
    else renderRecognition(entry, activity);
    if (options.animate) {
      const card = screen.querySelector(".question-card");
      card?.classList.add("question-card-enter");
    }
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
    const sessionKind = activeTrainingKind;
    const session = currentTrainingSession();
    session.queue.shift();
    if (!entry.isRetry && !session.answeredBase[activity.key]) {
      session.answeredBase[activity.key] = true;
      session.outcomes[activity.key] = outcome;
    }
    state.progress[activity.key] = scheduleReview(state.progress[activity.key], outcome, session.date);
    if (outcome !== "pass") {
      if (sessionKind === "review") insertRetry(session, activity.key);
      else if (sessionKind === "errors") {
        insertRetry(session, activity.key);
        enqueueReviewActivity(state.reviewDaily, activity.key);
      } else enqueueReviewActivity(state.reviewDaily, activity.key);
    }
    currentResult = { entry, activity, outcome, detail, sessionKind };
    saveState();
    preloadUpcomingAudio();
    if (shouldAutoAdvance(outcome)) showQuickPass(activity);
    else renderResult();
  }

  function showQuickPass(activity) {
    const card = screen.querySelector(".question-card");
    if (!card) {
      renderCurrent({ animate: true });
      return;
    }
    screen.querySelectorAll("button, input").forEach((control) => { control.disabled = true; });
    primeUpcomingSpellingKeyboard();
    if (activity.mode === "recognition") {
      const correctChoice = [...card.querySelectorAll(".choice")]
        .find((choice) => choice.dataset.choice === activity.meaning);
      if (correctChoice) {
        correctChoice.classList.add("choice-correct");
      }
    } else {
      card.closest(".session")?.querySelector(".spelling-input")?.classList.add("answer-correct");
      const submit = card.closest(".session")?.querySelector(".submit-button");
      if (submit) submit.textContent = "✓ 正确";
    }
    const feedback = document.createElement("div");
    feedback.className = "quick-feedback";
    feedback.setAttribute("role", "status");
    feedback.setAttribute("aria-live", "polite");
    feedback.innerHTML = `<strong>正确</strong><span>${escapeHtml(activity.mode === "spelling" ? activity.meaning : "下一题")}</span>`;
    card.append(feedback);
    card.classList.add("quick-pass");
    const delay = activity.mode === "spelling" ? SPELLING_MEANING_DELAY_MS : QUICK_PASS_DELAY_MS;
    window.setTimeout(() => card.classList.add("quick-pass-leave"), delay - QUESTION_TRANSITION_MS);
    window.setTimeout(() => renderCurrent({ animate: true }), delay);
  }

  function renderResult() {
    window.scrollTo(0, 0);
    const { activity, outcome, detail, sessionKind } = currentResult;
    const pass = outcome === "pass";
    const record = state.progress[activity.key] || {};
    const label = detail.skipped ? "已标记为不会" : (pass ? "本次通过" : (outcome === "slow" ? "答对了，但超过 5 秒" : "这次答错了"));
    const typed = detail.skipped
      ? `<p class="typed">你选择了：不会</p>`
      : (detail.typed !== undefined
      ? `<p class="typed">你写的是：${diffAnswer(detail.typed, activity.term)}</p>`
      : (detail.selected ? `<p class="typed">你选的是：${escapeHtml(detail.selected)}</p>` : ""));
    const resultNote = formatResultNote(activity.errorNote || activity.note, outcome, sessionKind);
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
          ${resultNote ? `<p class="note">${escapeHtml(resultNote)}</p>` : ""}
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

  function preloadUpcomingAudio() {
    const nextEntry = currentTrainingSession()?.queue?.[0];
    const nextActivity = nextEntry ? activityMap.get(nextEntry.key) : null;
    const nextPath = nextActivity?.audioPath ? `./${nextActivity.audioPath}` : "";
    if (!nextPath) {
      preloadedAudio = null;
      preloadedAudioPath = "";
      return;
    }
    if (nextPath === preloadedAudioPath) return;
    preloadedAudio = new Audio(nextPath);
    preloadedAudio.preload = "auto";
    preloadedAudio.defaultPlaybackRate = AUDIO_PLAYBACK_RATE;
    preloadedAudioPath = nextPath;
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
      const audioPath = `./${activity.audioPath}`;
      if (preloadedAudio && preloadedAudioPath === audioPath) {
        audio = preloadedAudio;
        preloadedAudio = null;
        preloadedAudioPath = "";
      } else {
        audio = new Audio(audioPath);
      }
      audio.defaultPlaybackRate = AUDIO_PLAYBACK_RATE;
      audio.playbackRate = AUDIO_PLAYBACK_RATE;
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
    utterance.rate = AUDIO_PLAYBACK_RATE;
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
          <p class="eyebrow">SMART PASTE</p>
          <h2>直接把随手记粘进来。</h2>
          <p>编号、空行、“单词+中文”都会自动识别。词库里已有的词会自动补释义；全新词只需在预览里补一下中文。</p>
        </div>
        <label class="inbox-label" for="wrong-word-input">粘贴你的原始记录</label>
        <textarea id="wrong-word-input" class="inbox-input" rows="9" placeholder="1. juggle\n2) rural\n3. postpone推迟\n4. round 作为形容词"></textarea>
        <button id="parse-wrong-words" class="primary">识别并预览</button>
        <p id="inbox-message" class="inbox-message" aria-live="polite"></p>
        <div id="inbox-preview" class="inbox-preview" hidden></div>
        <div class="sync-card">
          <div><strong>本机新增 ${state.customItems.length} 条</strong><p>提交到 GitHub 后，其他设备也会获得这些词。</p></div>
          <button id="submit-sync" class="secondary" ${state.customItems.length ? "" : "disabled"}>提交同步</button>
          <button id="copy-package" class="secondary" ${state.customItems.length ? "" : "disabled"}>复制同步包</button>
        </div>
      </section>`;
    const message = document.getElementById("inbox-message");
    const area = document.getElementById("wrong-word-input");
    const preview = document.getElementById("inbox-preview");
    let drafts = [];

    const renderPreview = () => {
      if (!drafts.length) {
        preview.hidden = true;
        preview.innerHTML = "";
        return;
      }
      preview.hidden = false;
      const missing = drafts.filter((entry) => !entry.meaning).length;
      preview.innerHTML = `
        <div class="inbox-preview-head">
          <div><strong>识别到 ${drafts.length} 条</strong><p>${missing ? `${missing} 条需要补中文` : "释义已齐，可直接加入"}</p></div>
          <button id="clear-preview" class="text-button">清空预览</button>
        </div>
        <div class="inbox-preview-list">
          ${drafts.map((entry, index) => {
            const mode = entry.modes.length > 1 ? "both" : entry.modes[0];
            return `<article class="inbox-preview-row" data-index="${index}">
              <div class="inbox-preview-term">
                <strong>${escapeHtml(entry.term)}</strong>
                <span class="${entry.meaning ? "ready" : "missing"}">${entry.meaning ? (entry.matched ? "已匹配词库" : "已带释义") : "待补中文"}</span>
              </div>
              <div class="inbox-preview-fields">
                <label><small>中文意思</small><input class="inbox-meaning" value="${escapeHtml(entry.meaning)}" placeholder="输入准确中文义"></label>
                <label><small>训练类型</small><select class="inbox-mode">
                  <option value="recognition" ${mode === "recognition" ? "selected" : ""}>看词识义</option>
                  <option value="spelling" ${mode === "spelling" ? "selected" : ""}>听音拼写</option>
                  <option value="both" ${mode === "both" ? "selected" : ""}>两种都练</option>
                </select></label>
              </div>
              <button class="remove-preview text-button" data-remove="${index}">移除</button>
            </article>`;
          }).join("")}
        </div>
        <button id="confirm-wrong-words" class="primary">确认加入本机词库</button>`;

      preview.querySelector("#clear-preview").addEventListener("click", () => {
        drafts = [];
        renderPreview();
        message.textContent = "已清空预览，原文还在。";
      });
      preview.querySelectorAll("[data-remove]").forEach((button) => button.addEventListener("click", () => {
        drafts.splice(Number(button.dataset.remove), 1);
        renderPreview();
      }));
      preview.querySelectorAll(".inbox-preview-row").forEach((row) => {
        const index = Number(row.dataset.index);
        const meaningInput = row.querySelector(".inbox-meaning");
        const modeSelect = row.querySelector(".inbox-mode");
        meaningInput.addEventListener("input", () => {
          drafts[index].meaning = meaningInput.value.trim();
          const badge = row.querySelector(".inbox-preview-term span");
          badge.className = drafts[index].meaning ? "ready" : "missing";
          badge.textContent = drafts[index].meaning ? "已补释义" : "待补中文";
        });
        modeSelect.addEventListener("change", () => {
          drafts[index].modes = normaliseModes(modeSelect.value);
        });
      });
      preview.querySelector("#confirm-wrong-words").addEventListener("click", () => {
        try {
          const entries = [...preview.querySelectorAll(".inbox-preview-row")].map((row) => {
            const draft = drafts[Number(row.dataset.index)];
            return cleanCustomEntry({
              ...draft,
              meaning: row.querySelector(".inbox-meaning").value,
              mode: row.querySelector(".inbox-mode").value,
            });
          });
          const merged = new Map(state.customItems.map((item) => [item.id || keyFor(item.term), cleanCustomEntry(item)]));
          entries.forEach((entry) => {
            const existing = merged.get(entry.id);
            merged.set(entry.id, existing ? { ...existing, ...entry, modes: [...new Set([...existing.modes, ...entry.modes])] } : entry);
          });
          state.customItems = [...merged.values()];
          rebuildDecks();
          saveState();
          message.classList.remove("error");
          message.textContent = `已加入 ${entries.length} 条，本机现在就能刷；正在等待提交到 GitHub。`;
          setTimeout(inboxScreen, 650);
        } catch (error) {
          message.textContent = `还不能加入：${error.message}`;
          message.classList.add("error");
        }
      });
    };

    const parseAndPreview = () => {
      try {
        drafts = parseWrongWordDrafts(area.value, [...sourceItems, ...state.customItems]);
        if (!drafts.length) throw new Error("还没有粘贴错词");
        renderPreview();
        message.classList.remove("error");
        const missing = drafts.filter((entry) => !entry.meaning).length;
        message.textContent = missing
          ? `已识别 ${drafts.length} 条；请先补齐 ${missing} 条中文释义。`
          : `已识别 ${drafts.length} 条，检查后直接确认。`;
      } catch (error) {
        drafts = [];
        renderPreview();
        message.textContent = `没有识别：${error.message}`;
        message.classList.add("error");
      }
    };

    document.getElementById("inbox-back").addEventListener("click", homeScreen);
    document.getElementById("copy-gpt-prompt").addEventListener("click", async () => {
      await copyText(wrongWordPrompt());
      message.textContent = "已复制。发给任意网页 GPT，再把它输出的 JSON 粘回来。";
    });
    document.getElementById("parse-wrong-words").addEventListener("click", parseAndPreview);
    area.addEventListener("paste", () => setTimeout(parseAndPreview, 30));
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
        state = applyLearningReviewSplit(state);
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
      versionButton?.addEventListener("click", () => forceAppUpdate());
      const [response, directionResponse] = await Promise.all([
        fetch(`./data/listening.json?v=${encodeURIComponent(APP_VERSION)}`),
        fetch(`./data/directions.json?v=${encodeURIComponent(APP_VERSION)}`),
      ]);
      if (!response.ok || !directionResponse.ok) throw new Error(`HTTP ${response.status}/${directionResponse.status}`);
      [sourceItems, directions] = await Promise.all([response.json(), directionResponse.json()]);
      loadState();
      state = applyTrainingReset(state);
      state = applyLearningReviewSplit(state);
      migrateNumberVariantState(state, sourceItems);
      reconcileSyncedCustomItems();
      rebuildDecks();
      prepareDaily(state, activities);
      saveState();
      homeScreen();
      if ("serviceWorker" in navigator) {
        const hadController = Boolean(navigator.serviceWorker.controller);
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          if (hadController && !appReloading) {
            appReloading = true;
            window.location.reload();
          }
        });
        try {
          const registration = await navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" });
          await registration.update();
        } catch (_) {}
      }
      automaticUpdateReady = true;
      window.addEventListener("pageshow", () => requestAutomaticUpdateCheck());
      document.addEventListener("visibilitychange", () => requestAutomaticUpdateCheck());
      requestAutomaticUpdateCheck({ force: true });
    } catch (error) {
      screen.innerHTML = `<section class="finished"><h2>词库没有加载成功</h2><p>${escapeHtml(error.message)}。联网后刷新页面再试。</p></section>`;
    }
  }

  init();
}());
