(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ConfusionsFlashLogic = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const STORAGE_KEY = "marcoIeltsConfusionsFlash.v1";
  const SESSION_SIZE = 20;
  const RETRY_MIN_DISTANCE = 8;
  const RETRY_MAX_DISTANCE = 12;
  const MAX_RETRIES = 3;

  function nowIso() {
    return new Date().toISOString();
  }

  function hashString(value) {
    let hash = 2166136261;
    const text = String(value ?? "");
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function seededShuffle(values, seed) {
    return values
      .map((value, index) => ({ value, rank: hashString(`${seed}:${index}:${JSON.stringify(value)}`) }))
      .sort((first, second) => first.rank - second.rank)
      .map((entry) => entry.value);
  }

  function defaultState() {
    return { schemaVersion: 1, stats: {}, session: null };
  }

  function safeState(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return defaultState();
    const stats = raw.stats && typeof raw.stats === "object" && !Array.isArray(raw.stats) ? raw.stats : {};
    const session = raw.session && typeof raw.session === "object" && !Array.isArray(raw.session) ? raw.session : null;
    return { schemaVersion: 1, stats, session };
  }

  function flattenTerms(groups) {
    return (groups || []).flatMap((group) => (group.terms || []).map((term) => ({
      ...term,
      groupId: group.id,
      groupLabel: group.label,
    })));
  }

  function statFor(state, term) {
    const current = state.stats[term] || {};
    return {
      attempts: Number.isInteger(current.attempts) ? current.attempts : 0,
      known: Number.isInteger(current.known) ? current.known : 0,
      unknown: Number.isInteger(current.unknown) ? current.unknown : 0,
      lapses: Number.isInteger(current.lapses) ? current.lapses : 0,
      mastery: Number.isInteger(current.mastery) ? Math.max(0, Math.min(3, current.mastery)) : 0,
      streak: Number.isInteger(current.streak) ? Math.max(0, current.streak) : 0,
      lastSeen: typeof current.lastSeen === "string" ? current.lastSeen : null,
      knownDates: Array.isArray(current.knownDates) ? current.knownDates : [],
    };
  }

  function termRank(term, state, seed) {
    const stat = state.stats[term.term] ? statFor(state, term.term) : null;
    if (!stat) return [0, 0, 0, "", hashString(`${seed}:${term.term}`)];
    return [1, stat.mastery, -stat.lapses, stat.lastSeen || "", hashString(`${seed}:${term.term}`)];
  }

  function compareRank(first, second) {
    for (let index = 0; index < Math.max(first.length, second.length); index += 1) {
      if (first[index] < second[index]) return -1;
      if (first[index] > second[index]) return 1;
    }
    return 0;
  }

  function buildSession(groups, rawState, seed = nowIso(), size = SESSION_SIZE) {
    const state = safeState(rawState);
    const allTerms = flattenTerms(groups);
    if (!allTerms.length) throw new Error("易混词为空");
    const limit = Math.max(1, Math.min(size, allTerms.length));
    const selected = [...allTerms]
      .sort((first, second) => compareRank(termRank(first, state, seed), termRank(second, state, seed)))
      .slice(0, limit)
      .map((term) => term.term);
    state.session = {
      id: `flash-${hashString(`${seed}:${selected.join("|")}`)}`,
      startedAt: nowIso(),
      baseTerms: selected,
      queue: selected.map((term) => ({ term, isRetry: false })),
      cursor: 0,
      answeredBase: {},
      retryCount: {},
      results: [],
      phase: "question",
      pending: null,
      completed: false,
    };
    return state;
  }

  function currentEntry(rawState) {
    const state = safeState(rawState);
    const session = state.session;
    if (!session || session.completed || !Array.isArray(session.queue)) return null;
    return session.queue[session.cursor] || null;
  }

  function ensureActiveSession(state) {
    const session = state.session;
    if (!session || session.completed || !Array.isArray(session.queue)) throw new Error("没有进行中的易混词刷词");
    if (!session.queue[session.cursor]) throw new Error("当前易混词不存在");
    return session;
  }

  function markBaseAnswered(session, entry) {
    if (!entry.isRetry) session.answeredBase[entry.term] = true;
  }

  function scheduleRetry(session, term) {
    const count = session.retryCount[term] || 0;
    if (count >= MAX_RETRIES) return false;
    const remaining = session.queue.length - session.cursor - 1;
    if (remaining < RETRY_MIN_DISTANCE) return false;
    const span = RETRY_MAX_DISTANCE - RETRY_MIN_DISTANCE + 1;
    const distance = RETRY_MIN_DISTANCE + (hashString(`${session.id}:${term}:${count}`) % span);
    const insertAt = Math.min(session.queue.length, session.cursor + 1 + distance);
    const intervening = session.queue.slice(session.cursor + 1, insertAt).map(entry => entry.term);
    if (intervening.includes(term) || new Set(intervening).size < 6) return false;
    session.queue.splice(insertAt, 0, { term, isRetry: true });
    session.retryCount[term] = count + 1;
    return true;
  }

  function answerKnown(rawState, timestamp = nowIso()) {
    const state = safeState(rawState);
    const session = ensureActiveSession(state);
    if (session.phase !== "question") throw new Error("当前不是认识度判断阶段");
    const entry = session.queue[session.cursor];
    const stat = statFor(state, entry.term);
    const previous = JSON.parse(JSON.stringify(stat));
    stat.attempts += 1;
    stat.known += 1;
    stat.streak += 1;
    const date = new Date(timestamp);
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    if (!stat.knownDates.includes(day)) {
      stat.knownDates.push(day);
      stat.mastery = Math.min(3, stat.mastery + 1, stat.knownDates.length);
    }
    stat.lastSeen = timestamp;
    state.stats[entry.term] = stat;
    markBaseAnswered(session, entry);
    session.pending = { term: entry.term, known: true, previous, meaningChoice: null, meaningCorrect: null };
    session.results.push({ term: entry.term, known: true, isRetry: Boolean(entry.isRetry), timestamp });
    session.phase = "reveal";
    return state;
  }

  function answerUnknown(rawState, timestamp = nowIso()) {
    const state = safeState(rawState);
    const session = ensureActiveSession(state);
    if (session.phase !== "question") throw new Error("当前不是认识度判断阶段");
    const entry = session.queue[session.cursor];
    const stat = statFor(state, entry.term);
    stat.attempts += 1;
    stat.unknown += 1;
    stat.lapses += 1;
    stat.streak = 0;
    stat.mastery = 0;
    stat.lastSeen = timestamp;
    state.stats[entry.term] = stat;
    markBaseAnswered(session, entry);
    const retryScheduled = scheduleRetry(session, entry.term);
    session.pending = { term: entry.term, known: false, meaningChoice: null, meaningCorrect: null, retryScheduled };
    session.results.push({ term: entry.term, known: false, isRetry: Boolean(entry.isRetry), retryScheduled, timestamp });
    session.phase = "meaning";
    return state;
  }

  function correctKnown(rawState, timestamp = nowIso()) {
    const state = safeState(rawState);
    const session = ensureActiveSession(state);
    if (session.phase !== "reveal" || !session.pending?.known || !session.pending.previous) return state;
    state.stats[session.pending.term] = session.pending.previous;
    session.results.pop();
    session.phase = "question";
    return answerUnknown(state, timestamp);
  }

  function confirmMeaning(rawState, selectedMeaning, correctMeaning) {
    const state = safeState(rawState);
    const session = ensureActiveSession(state);
    if (session.phase !== "meaning" || !session.pending) throw new Error("当前不是释义确认阶段");
    session.pending.meaningChoice = selectedMeaning;
    session.pending.meaningCorrect = selectedMeaning === correctMeaning;
    session.phase = "reveal";
    return state;
  }

  function advance(rawState) {
    const state = safeState(rawState);
    const session = ensureActiveSession(state);
    if (session.phase !== "reveal") throw new Error("当前还不能进入下一词");
    session.cursor += 1;
    session.pending = null;
    if (session.cursor >= session.queue.length) {
      session.completed = true;
      session.phase = "complete";
    } else {
      session.phase = "question";
    }
    return state;
  }

  function primaryPartOfSpeech(value) {
    return String(value || "").toLowerCase().split(/[/.]/)[0].trim();
  }

  function makeMeaningChoices(groups, expectedTerm, seed = nowIso(), count = 4) {
    const allTerms = flattenTerms(groups);
    const expected = allTerms.find((term) => term.term === expectedTerm);
    if (!expected) throw new Error(`找不到易混词：${expectedTerm}`);
    const usedMeanings = new Set([expected.meaning]);
    const choices = [expected];
    const addFrom = (candidates, candidateSeed) => {
      seededShuffle(candidates, candidateSeed).forEach((candidate) => {
        if (choices.length >= count || usedMeanings.has(candidate.meaning)) return;
        choices.push(candidate);
        usedMeanings.add(candidate.meaning);
      });
    };
    addFrom(
      allTerms.filter((term) => term.groupId === expected.groupId && term.term !== expected.term),
      `${seed}:group`
    );
    addFrom(
      allTerms.filter((term) => term.groupId !== expected.groupId && primaryPartOfSpeech(term.partOfSpeech) === primaryPartOfSpeech(expected.partOfSpeech)),
      `${seed}:pos`
    );
    addFrom(allTerms.filter((term) => term.term !== expected.term), `${seed}:all`);
    return seededShuffle(choices.slice(0, count), `${seed}:choices`).map((term) => ({
      term: term.term,
      meaning: term.meaning,
      partOfSpeech: term.partOfSpeech,
    }));
  }

  function seenCount(rawState) {
    const state = safeState(rawState);
    return Object.values(state.stats).filter((stat) => (stat?.attempts || 0) > 0).length;
  }

  function masteredCount(rawState) {
    const state = safeState(rawState);
    return Object.values(state.stats).filter((stat) => (stat?.mastery || 0) >= 2).length;
  }

  function baseProgress(rawState) {
    const state = safeState(rawState);
    const session = state.session;
    if (!session || !Array.isArray(session.baseTerms)) return { done: 0, total: 0 };
    return { done: Object.keys(session.answeredBase || {}).length, total: session.baseTerms.length };
  }

  return {
    STORAGE_KEY,
    SESSION_SIZE,
    RETRY_MIN_DISTANCE,
    RETRY_MAX_DISTANCE,
    MAX_RETRIES,
    hashString,
    seededShuffle,
    defaultState,
    safeState,
    flattenTerms,
    buildSession,
    currentEntry,
    answerKnown,
    answerUnknown,
    correctKnown,
    confirmMeaning,
    advance,
    makeMeaningChoices,
    seenCount,
    masteredCount,
    baseProgress,
  };
});
