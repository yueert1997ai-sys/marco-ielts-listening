(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ConfusionsLogic = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const STORAGE_KEY = "marcoIeltsConfusions.v1";
  const VERSION = "v1.1.0";
  const QUESTION_COUNT = 12;
  const RECENT_WINDOW = 20;
  const MIN_STABLE_ATTEMPTS = 3;
  const COLD_TEST_PACES = ["standard", "relaxed"];
  const TYPE_LIMITS = {
    "en-zh": 2500,
    "zh-en": 2500,
    sentence: 5000,
  };

  function nowIso() {
    return new Date().toISOString();
  }

  function hashString(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
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

  function median(values) {
    const numbers = values.filter(Number.isFinite).sort((first, second) => first - second);
    if (!numbers.length) return null;
    const middle = Math.floor(numbers.length / 2);
    return numbers.length % 2 ? numbers[middle] : (numbers[middle - 1] + numbers[middle]) / 2;
  }

  function defaultState() {
    return {
      schemaVersion: 1,
      settings: { coldTestPace: "standard" },
      learning: {},
      testHistory: [],
      termStats: {},
      groupStats: {},
      confusionPairs: {},
      reinforcement: [],
    };
  }

  function safeObject(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  function safeState(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return defaultState();
    return {
      schemaVersion: 1,
      settings: {
        coldTestPace: COLD_TEST_PACES.includes(raw.settings?.coldTestPace)
          ? raw.settings.coldTestPace
          : "standard",
      },
      learning: safeObject(raw.learning),
      testHistory: Array.isArray(raw.testHistory) ? raw.testHistory : [],
      termStats: safeObject(raw.termStats),
      groupStats: safeObject(raw.groupStats),
      confusionPairs: safeObject(raw.confusionPairs),
      reinforcement: Array.isArray(raw.reinforcement) ? raw.reinforcement : [],
    };
  }

  function flattenTerms(groups) {
    return groups.flatMap((group) => group.terms.map((term) => ({ ...term, groupId: group.id })));
  }

  function pairKey(expected, selected) {
    return `${expected}->${selected}`;
  }

  function computeGroupStatus(outcomes) {
    const recent = (Array.isArray(outcomes) ? outcomes : []).slice(-RECENT_WINDOW);
    if (!recent.length) return "untested";
    const correct = recent.filter((outcome) => outcome.correct).length;
    const accuracy = correct / recent.length;
    const pairCounts = {};
    recent.forEach((outcome) => {
      if (!outcome.correct && outcome.selected) {
        const key = pairKey(outcome.expected, outcome.selected);
        pairCounts[key] = (pairCounts[key] || 0) + 1;
      }
    });
    if (accuracy < 0.7 || Object.values(pairCounts).some((count) => count >= 2)) return "high-risk";

    const quickTimes = recent.filter((outcome) => outcome.type !== "sentence").map((outcome) => outcome.responseMs);
    const sentenceTimes = recent.filter((outcome) => outcome.type === "sentence").map((outcome) => outcome.responseMs);
    const noRepeatedPair = Object.values(pairCounts).every((count) => count < 2);
    if (recent.length >= MIN_STABLE_ATTEMPTS
      && accuracy >= 0.9
      && quickTimes.length > 0
      && sentenceTimes.length > 0
      && median(quickTimes) <= TYPE_LIMITS["en-zh"]
      && median(sentenceTimes) <= TYPE_LIMITS.sentence
      && noRepeatedPair) return "stable";
    return "learning";
  }

  function statusCounts(groups, state) {
    return groups.reduce((counts, group) => {
      const status = computeGroupStatus(state.groupStats[group.id]?.recentOutcomes);
      counts[status] += 1;
      return counts;
    }, { "high-risk": 0, learning: 0, stable: 0, untested: 0 });
  }

  function selectLearningGroups(groups, state, count = 5, seed = nowIso()) {
    const rank = { unseen: 0, "high-risk": 1, learning: 2, untested: 3, stable: 4 };
    return [...groups]
      .sort((first, second) => {
        const firstStatus = state.learning[first.id]?.status === "familiar"
          ? computeGroupStatus(state.groupStats[first.id]?.recentOutcomes)
          : "unseen";
        const secondStatus = state.learning[second.id]?.status === "familiar"
          ? computeGroupStatus(state.groupStats[second.id]?.recentOutcomes)
          : "unseen";
        if (rank[firstStatus] !== rank[secondStatus]) return rank[firstStatus] - rank[secondStatus];
        const firstSeen = state.learning[first.id]?.completedAt || "";
        const secondSeen = state.learning[second.id]?.completedAt || "";
        if (firstSeen !== secondSeen) return firstSeen.localeCompare(secondSeen);
        return hashString(`${seed}:${first.id}`) - hashString(`${seed}:${second.id}`);
      })
      .slice(0, count);
  }

  function commonEdgeLength(first, second, fromEnd = false) {
    const left = fromEnd ? [...first].reverse() : [...first];
    const right = fromEnd ? [...second].reverse() : [...second];
    let length = 0;
    while (length < left.length && length < right.length && left[length] === right[length]) length += 1;
    return length;
  }

  function wordBigrams(value) {
    const normalized = String(value).toLowerCase();
    const result = new Set();
    for (let index = 0; index < normalized.length - 1; index += 1) result.add(normalized.slice(index, index + 2));
    return result;
  }

  function learningSimilarity(candidate, targets) {
    const candidateTerm = candidate.term.toLowerCase();
    const candidateBigrams = wordBigrams(candidateTerm);
    return Math.max(...targets.map((target) => {
      const targetTerm = target.term.toLowerCase();
      const targetBigrams = wordBigrams(targetTerm);
      const sharedBigrams = [...candidateBigrams].filter((bigram) => targetBigrams.has(bigram)).length;
      const samePartOfSpeech = candidate.partOfSpeech === target.partOfSpeech ? 12 : 0;
      return samePartOfSpeech
        + commonEdgeLength(candidateTerm, targetTerm) * 3
        + commonEdgeLength(candidateTerm, targetTerm, true) * 2
        + sharedBigrams;
    }));
  }

  function buildLearningPool(group, groups, seed, minimum = 4) {
    const targets = [...group.terms];
    if (targets.length >= minimum) return targets;
    const targetTerms = new Set(targets.map((term) => term.term));
    const candidates = flattenTerms(groups)
      .filter((term) => !targetTerms.has(term.term))
      .sort((first, second) => {
        const scoreDifference = learningSimilarity(second, targets) - learningSimilarity(first, targets);
        if (scoreDifference) return scoreDifference;
        return hashString(`${seed}:${first.term}`) - hashString(`${seed}:${second.term}`);
      });
    return [...targets, ...candidates.slice(0, Math.max(0, minimum - targets.length))];
  }

  function selectTerm(group, state, seed) {
    return [...group.terms].sort((first, second) => {
      const firstSeen = state.termStats[first.term]?.lastTested || "";
      const secondSeen = state.termStats[second.term]?.lastTested || "";
      if (firstSeen !== secondSeen) return firstSeen.localeCompare(secondSeen);
      return hashString(`${seed}:${first.term}`) - hashString(`${seed}:${second.term}`);
    })[0];
  }

  function makeChoices(group, expected, seed) {
    const others = seededShuffle(group.terms.filter((term) => term.term !== expected.term), `${seed}:distractors`)
      .slice(0, 3);
    return seededShuffle([expected, ...others], `${seed}:choices`)
      .map((term) => ({ term: term.term, meaning: term.meaning, partOfSpeech: term.partOfSpeech }));
  }

  function makeQuestion(group, expected, type, seed) {
    return {
      id: `${seed}:${group.id}:${expected.term}:${type}`,
      groupId: group.id,
      groupLabel: group.label,
      type,
      expected: expected.term,
      prompt: type === "en-zh" ? expected.term : (type === "zh-en" ? expected.meaning : expected.sentence),
      partOfSpeech: expected.partOfSpeech,
      chunk: expected.chunk,
      timeLimitMs: TYPE_LIMITS[type],
      choices: makeChoices(group, expected, seed),
    };
  }

  function makeLearningQuestion(group, expected, type, pool, seed) {
    const question = makeQuestion(group, expected, type, seed);
    question.choices = seededShuffle(pool, `${seed}:learning-choices`)
      .map((term) => ({ term: term.term, meaning: term.meaning, partOfSpeech: term.partOfSpeech }));
    return question;
  }

  function buildColdTest(groups, state, seed = `${Date.now()}`, pace = "standard") {
    if (groups.length < QUESTION_COUNT) throw new Error("Cold test requires at least 12 groups");
    const safePace = COLD_TEST_PACES.includes(pace) ? pace : "standard";
    const timeMultiplier = safePace === "relaxed" ? 2 : 1;
    const priority = { "high-risk": 0, untested: 1, learning: 2, stable: 3 };
    const selectedGroups = [...groups]
      .sort((first, second) => {
        const firstStatus = computeGroupStatus(state.groupStats[first.id]?.recentOutcomes);
        const secondStatus = computeGroupStatus(state.groupStats[second.id]?.recentOutcomes);
        if (priority[firstStatus] !== priority[secondStatus]) return priority[firstStatus] - priority[secondStatus];
        const firstTested = state.groupStats[first.id]?.lastTested || "";
        const secondTested = state.groupStats[second.id]?.lastTested || "";
        if (firstTested !== secondTested) return firstTested.localeCompare(secondTested);
        return hashString(`${seed}:${first.id}`) - hashString(`${seed}:${second.id}`);
      })
      .slice(0, QUESTION_COUNT);
    const types = seededShuffle([
      "en-zh", "en-zh", "en-zh",
      "zh-en", "zh-en", "zh-en",
      "sentence", "sentence", "sentence", "sentence", "sentence", "sentence",
    ], `${seed}:types`);
    return selectedGroups.map((group, index) => {
      const expected = selectTerm(group, state, `${seed}:${group.id}`);
      const question = makeQuestion(group, expected, types[index], `${seed}:${index}`);
      return { ...question, pace: safePace, timeLimitMs: question.timeLimitMs * timeMultiplier };
    });
  }

  function answerQuestion(question, selected, elapsedMs, timestamp = nowIso()) {
    const timedOut = !selected;
    const responseMs = timedOut
      ? question.timeLimitMs
      : Math.max(0, Math.min(Math.round(elapsedMs), question.timeLimitMs));
    return {
      questionId: question.id,
      groupId: question.groupId,
      type: question.type,
      expected: question.expected,
      selected: selected || null,
      correct: selected === question.expected,
      timedOut,
      responseMs,
      timeLimitMs: question.timeLimitMs,
      pace: COLD_TEST_PACES.includes(question.pace) ? question.pace : "standard",
      timestamp,
    };
  }

  function appendLimited(values, value, limit) {
    return [...(Array.isArray(values) ? values : []), value].slice(-limit);
  }

  function recordColdTest(rawState, answers, startedAt, completedAt = nowIso()) {
    const state = safeState(rawState);
    const testId = `cold-${Date.parse(completedAt) || Date.now()}`;
    const cleanAnswers = answers.map((answer) => ({ ...answer }));
    cleanAnswers.forEach((answer) => {
      const term = state.termStats[answer.expected] || {
        attempts: 0, correct: 0, responseTimes: [], sentenceResponseTimes: [], recentOutcomes: [], lastTested: null,
      };
      term.attempts += 1;
      if (answer.correct) term.correct += 1;
      term.responseTimes = appendLimited(term.responseTimes, answer.responseMs, 100);
      if (answer.type === "sentence") {
        term.sentenceResponseTimes = appendLimited(term.sentenceResponseTimes, answer.responseMs, 100);
      }
      term.recentOutcomes = appendLimited(term.recentOutcomes, answer, RECENT_WINDOW);
      term.lastTested = answer.timestamp;
      state.termStats[answer.expected] = term;

      const group = state.groupStats[answer.groupId] || {
        attempts: 0, correct: 0, testAccuracy: 0, recentOutcomes: [], lastTested: null, status: "untested",
      };
      group.attempts = (group.attempts || 0) + 1;
      if (answer.correct) group.correct = (group.correct || 0) + 1;
      else group.correct = group.correct || 0;
      group.testAccuracy = group.correct / group.attempts;
      group.recentOutcomes = appendLimited(group.recentOutcomes, answer, RECENT_WINDOW);
      group.lastTested = answer.timestamp;
      group.status = computeGroupStatus(group.recentOutcomes);
      state.groupStats[answer.groupId] = group;

      if (!answer.correct && answer.selected) {
        const key = pairKey(answer.expected, answer.selected);
        const pair = state.confusionPairs[key] || {
          expected: answer.expected, selected: answer.selected, count: 0, lastOccurred: null,
        };
        pair.count += 1;
        pair.lastOccurred = answer.timestamp;
        state.confusionPairs[key] = pair;
      }
    });

    const summary = {
      id: testId,
      source: "cold-test",
      startedAt,
      completedAt,
      score: cleanAnswers.filter((answer) => answer.correct).length,
      total: cleanAnswers.length,
      medianResponseMs: median(cleanAnswers.map((answer) => answer.responseMs)),
      pace: cleanAnswers.some((answer) => answer.pace === "relaxed") ? "relaxed" : "standard",
      answers: cleanAnswers,
    };
    state.testHistory = appendLimited(state.testHistory, summary, 100);
    return { state, summary };
  }

  function markGroupFamiliar(rawState, groupId, completedAt = nowIso()) {
    const state = safeState(rawState);
    state.learning[groupId] = { status: "familiar", completedAt, source: "learning" };
    return state;
  }

  function recordReinforcement(rawState, testId, attempts, startedAt, completedAt = nowIso()) {
    const state = safeState(rawState);
    state.reinforcement = appendLimited(state.reinforcement, {
      id: `reinforcement-${Date.parse(completedAt) || Date.now()}`,
      source: "reinforcement",
      testId,
      startedAt,
      completedAt,
      attempts: attempts.map((attempt) => ({ ...attempt })),
    }, 100);
    return state;
  }

  function testConfusionPairs(answers) {
    const pairs = {};
    answers.forEach((answer) => {
      if (!answer.correct && answer.selected) {
        const key = pairKey(answer.expected, answer.selected);
        pairs[key] = (pairs[key] || 0) + 1;
      }
    });
    return pairs;
  }

  return {
    STORAGE_KEY,
    VERSION,
    QUESTION_COUNT,
    RECENT_WINDOW,
    MIN_STABLE_ATTEMPTS,
    COLD_TEST_PACES,
    TYPE_LIMITS,
    defaultState,
    safeState,
    hashString,
    seededShuffle,
    median,
    flattenTerms,
    computeGroupStatus,
    statusCounts,
    selectLearningGroups,
    buildLearningPool,
    makeChoices,
    makeQuestion,
    makeLearningQuestion,
    buildColdTest,
    answerQuestion,
    recordColdTest,
    markGroupFamiliar,
    recordReinforcement,
    testConfusionPairs,
  };
});
