const assert = require("assert");
const logic = require("../app.js");
const directions = require("../data/directions.json");

let tests = 0;
function test(name, fn) {
  try { fn(); tests += 1; }
  catch (error) { error.message = `${name}: ${error.message}`; throw error; }
}

const items = [
  { id: "carpet", term: "carpet", meaning: "地毯", partOfSpeech: "名词", modes: ["spelling", "recognition"], isRealError: true, sourceType: "user", category: "住房", acceptedAnswers: ["carpet"] },
  ...Array.from({ length: 30 }, (_, index) => ({
    id: `s${index}`, term: `spell${index}`, meaning: `拼写${index}`, modes: ["spelling"], isRealError: false, category: "日常", acceptedAnswers: [`spell${index}`],
  })),
  ...Array.from({ length: 30 }, (_, index) => ({
    id: `r${index}`, term: `read${index}`, meaning: `看义${index}`, partOfSpeech: "名词", modes: ["recognition"], isRealError: false, category: "学校", acceptedAnswers: [`read${index}`],
  })),
];
const activities = logic.makeActivities(items);

test("answer ignores case and outer whitespace", () => assert.equal(logic.normaliseAnswer(" Carpet "), "carpet"));
test("answer collapses internal whitespace", () => assert.equal(logic.normaliseAnswer("first   name"), "first name"));
test("hyphens remain significant", () => assert.notEqual(logic.normaliseAnswer("mass produced"), logic.normaliseAnswer("mass-produced")));
test("a plural typo remains significant within one spelling card", () => assert.notEqual(logic.normaliseAnswer("carpet"), logic.normaliseAnswer("carpets")));
test("activities split modes", () => assert(activities.some((item) => item.key === "carpet:spelling") && activities.some((item) => item.key === "carpet:recognition")));
test("daily deck is exactly 50", () => assert.equal(logic.createDailyDeck(activities, {}, "2026-08-23").length, 50));
test("daily deck has 25 spelling", () => {
  const deck = logic.createDailyDeck(activities, {}, "2026-08-23");
  assert.equal(deck.filter((key) => key.endsWith(":spelling")).length, 25);
});
test("daily deck has 25 recognition", () => {
  const deck = logic.createDailyDeck(activities, {}, "2026-08-23");
  assert.equal(deck.filter((key) => key.endsWith(":recognition")).length, 25);
});
test("real errors are selected before ordinary unseen words", () => {
  const deck = logic.createDailyDeck(activities, {}, "2026-08-23");
  assert(deck.includes("carpet:spelling"));
  assert(deck.includes("carpet:recognition"));
});
test("overdue beats unseen", () => {
  const progress = { "s20:spelling": { stage: 2, due: "2026-08-20" } };
  const deck = logic.createDailyDeck(activities, progress, "2026-08-23");
  assert(deck.includes("s20:spelling"));
});
test("daily deck order is stable within one day", () => assert.deepEqual(
  logic.createDailyDeck(activities, {}, "2026-08-23"),
  logic.createDailyDeck(activities, {}, "2026-08-23")
));
test("daily deck order changes across days", () => assert.notDeepEqual(
  logic.createDailyDeck(activities, {}, "2026-08-23"),
  logic.createDailyDeck(activities, {}, "2026-08-24")
));
test("new-word deck excludes every previously seen activity", () => {
  const progress = { "s0:spelling": { attempts: 1 }, "r0:recognition": { attempts: 1 }, "carpet:spelling": { attempts: 1 } };
  const deck = logic.createLearningDeck(activities, progress, "2026-08-25");
  assert.equal(deck.length, 50);
  assert(deck.every((key) => !progress[key]));
  assert.equal(deck.filter((key) => key.endsWith(":spelling")).length, 25);
  assert.equal(deck.filter((key) => key.endsWith(":recognition")).length, 25);
});
test("an unfinished confidence check remains eligible as a new word next day", () => {
  const progress = { "r0:recognition": { attempts: 1, passes: 1, stage: 0, pendingConfirmation: true } };
  const deck = logic.createLearningDeck(activities, progress, "2026-08-26");
  assert(deck.includes("r0:recognition"));
});
test("review deck contains only due activities with prior errors", () => {
  const progress = {
    "s0:spelling": { lapses: 4, due: "2026-08-24" },
    "s1:spelling": { lapses: 1, due: "2026-08-25" },
    "r0:recognition": { lapses: 5, due: "2026-08-26" },
    "r1:recognition": { lapses: 0, due: "2026-08-24" },
    "r2:recognition": { lapses: 3, due: "2026-08-25" },
  };
  const deck = logic.createReviewDeck(activities, progress, "2026-08-25");
  assert.deepEqual([...deck].sort(), ["r2:recognition", "s0:spelling", "s1:spelling"]);
  assert.deepEqual(logic.createReviewDeck(activities, progress, "2026-08-25", 1), ["s0:spelling"]);
});
test("personal error training contains only manually added activities", () => {
  const deck = logic.createErrorTrainingDeck(activities, "2026-08-25");
  assert.deepEqual([...deck].sort(), ["carpet:recognition", "carpet:spelling"]);
  const nonPersonal = logic.makeActivities([
    { id: "base-error", term: "base error", meaning: "基础错词", modes: ["recognition"], isRealError: true },
  ]);
  assert.deepEqual(logic.createErrorTrainingDeck(nonPersonal, "2026-08-25"), []);
});
test("starred training contains every mode of starred words and nothing else", () => {
  const starred = { carpet: true, s0: true, r0: true };
  const deck = logic.createStarredTrainingDeck(activities, "starred-seed", starred);
  assert.deepEqual([...deck].sort(), ["carpet:recognition", "carpet:spelling", "r0:recognition", "s0:spelling"]);
  assert.deepEqual(deck, logic.createStarredTrainingDeck(activities, "starred-seed", starred));
});
test("a new starred round can use a different random order", () => {
  const starred = Object.fromEntries(items.slice(0, 12).map((item) => [item.id, true]));
  const first = logic.createStarredTrainingDeck(activities, "round-one", starred);
  const alternatives = Array.from({ length: 6 }, (_, index) => logic.createStarredTrainingDeck(activities, `round-${index + 2}`, starred));
  assert(alternatives.some((deck) => JSON.stringify(deck) !== JSON.stringify(first)));
});
test("personal error training is a third queue independent from learning and due review", () => {
  const state = logic.safeState(null);
  logic.prepareDaily(state, activities, "2026-08-25");
  assert(state.errorDaily.baseKeys.includes("carpet:spelling"));
  assert(state.errorDaily.baseKeys.includes("carpet:recognition"));
  assert.notStrictEqual(state.errorDaily, state.daily);
  assert.notStrictEqual(state.errorDaily, state.reviewDaily);
});
test("starred training is an independent repeatable queue", () => {
  const state = logic.safeState({ starred: { carpet: true } });
  logic.prepareDaily(state, activities, "2026-08-25");
  assert.deepEqual([...state.starredDaily.baseKeys].sort(), ["carpet:recognition", "carpet:spelling"]);
  assert.notStrictEqual(state.starredDaily, state.daily);
  assert.notStrictEqual(state.starredDaily, state.errorDaily);
  const restarted = logic.syncStarredSession(null, "2026-08-25", state.starredDaily.baseKeys);
  assert.equal(restarted.queue.length, 2);
});
test("new learning and high-frequency review are prepared as separate queues", () => {
  const state = logic.safeState({ progress: { "carpet:spelling": { lapses: 6, due: "2026-08-25" } } });
  logic.prepareDaily(state, activities, "2026-08-25");
  assert(!state.daily.baseKeys.includes("carpet:spelling"));
  assert(state.reviewDaily.baseKeys.includes("carpet:spelling"));
});
test("a new learning mistake enters review once without joining the learning queue", () => {
  const review = { baseKeys: [], queue: [], answeredBase: {}, outcomes: {}, retryCount: {}, completed: true };
  assert(logic.enqueueReviewActivity(review, "carpet:spelling"));
  assert(!logic.enqueueReviewActivity(review, "carpet:spelling"));
  assert.deepEqual(review.baseKeys, ["carpet:spelling"]);
  assert.equal(review.queue.length, 1); assert.equal(review.completed, false);
});
test("direction deck contains ten questions and all eight directions", () => {
  const deck = logic.createDirectionDeck(directions, "coverage");
  assert.equal(deck.length, 10);
  assert.equal(new Set(deck.map((item) => item.id)).size, 8);
});
test("direction deck repeats two different directions", () => {
  const deck = logic.createDirectionDeck(directions, "extras");
  const counts = deck.reduce((result, item) => ({ ...result, [item.id]: (result[item.id] || 0) + 1 }), {});
  assert.equal(Object.values(counts).filter((count) => count === 2).length, 2);
});
test("direction deck never repeats a direction immediately", () => {
  for (let index = 0; index < 50; index += 1) {
    const deck = logic.createDirectionDeck(directions, `adjacent-${index}`);
    assert(deck.every((item, itemIndex) => itemIndex === 0 || item.id !== deck[itemIndex - 1].id));
  }
});
test("hard direction deck contains ten diagonal-only questions", () => {
  const deck = logic.createHardDirectionDeck(directions, "hard-coverage");
  const counts = deck.reduce((result, item) => ({ ...result, [item.id]: (result[item.id] || 0) + 1 }), {});
  assert.equal(deck.length, 10);
  assert.deepEqual([...new Set(deck.map((item) => item.id))].sort(), [...logic.HARD_DIRECTION_IDS].sort());
  assert(Object.values(counts).every((count) => count >= 2));
  assert.equal(Object.values(counts).filter((count) => count === 3).length, 2);
});
test("hard direction deck never repeats a direction immediately", () => {
  for (let index = 0; index < 50; index += 1) {
    const deck = logic.createHardDirectionDeck(directions, `hard-adjacent-${index}`);
    assert(deck.every((item, itemIndex) => itemIndex === 0 || item.id !== deck[itemIndex - 1].id));
  }
});
test("direction answer passes at exactly two seconds", () => {
  assert.equal(logic.judgeDirectionAttempt("north", "north", 2000).outcome, "pass");
});
test("direction answer fails when correct but slower than two seconds", () => {
  assert.equal(logic.judgeDirectionAttempt("north", "north", 2000.01).outcome, "slow");
});
test("direction wrong answer and timeout fail", () => {
  assert.equal(logic.judgeDirectionAttempt("north", "south", 800).outcome, "fail");
  assert.equal(logic.judgeDirectionAttempt("north", null, 2000).outcome, "timeout");
});
test("hard direction answer passes at exactly one second", () => {
  assert.equal(logic.judgeDirectionAttempt("northeast", "northeast", 1000, logic.HARD_DIRECTION_RESPONSE_LIMIT_MS).outcome, "pass");
  assert.equal(logic.judgeDirectionAttempt("northeast", "northeast", 1000.01, logic.HARD_DIRECTION_RESPONSE_LIMIT_MS).outcome, "slow");
  assert.equal(logic.judgeDirectionAttempt("northeast", null, 1000, logic.HARD_DIRECTION_RESPONSE_LIMIT_MS).outcome, "timeout");
});
test("direction run only passes with ten passed answers", () => {
  const passed = Array.from({ length: 10 }, () => ({ passed: true }));
  assert(logic.isDirectionRunPassed(passed));
  assert(!logic.isDirectionRunPassed(passed.slice(0, 9)));
  assert(!logic.isDirectionRunPassed([...passed.slice(0, 9), { passed: false }]));
});
test("pass advances one-day interval", () => {
  const record = logic.scheduleReview(null, "pass", "2026-08-23");
  assert.equal(record.stage, 1); assert.equal(record.due, "2026-08-24");
});
test("second pass advances three days", () => {
  const record = logic.scheduleReview({ stage: 1, passes: 1 }, "pass", "2026-08-23");
  assert.equal(record.stage, 2); assert.equal(record.due, "2026-08-26");
});
test("failure resets stage", () => {
  const record = logic.scheduleReview({ stage: 5 }, "fail", "2026-08-23");
  assert.equal(record.stage, 0); assert.equal(record.due, "2026-08-24");
});
test("a missed word returns eight to twelve questions later", () => {
  const daily = { date: "2026-08-23", queue: Array.from({ length: 20 }, (_, i) => ({ key: `x${i}`, isRetry: false })), retryCount: {} };
  const index = logic.insertRetry(daily, "carpet:spelling");
  assert(index >= 8 && index <= 12); assert.equal(daily.queue[index].key, "carpet:spelling");
  assert.equal(daily.queue[index].reason, "retry");
});
test("a confidence check returns fifteen to twenty questions later", () => {
  const daily = { date: "2026-08-23", queue: Array.from({ length: 20 }, (_, i) => ({ key: `x${i}`, isRetry: false })), retryCount: {} };
  const index = logic.insertRetry(daily, "carpet:recognition", {
    reason: "confirm", minDistance: logic.CONFIRM_MIN_DISTANCE, maxDistance: logic.CONFIRM_MAX_DISTANCE, avoidChoiceIndex: 2,
  });
  assert(index >= 15 && index <= 20); assert.equal(daily.queue[index].reason, "confirm");
  assert.equal(daily.queue[index].avoidChoiceIndex, 2);
});
test("only one pending retry per item", () => {
  const daily = { date: "2026-08-23", queue: Array.from({ length: 20 }, (_, i) => ({ key: `x${i}`, isRetry: false })), retryCount: {} };
  logic.insertRetry(daily, "carpet:spelling"); logic.insertRetry(daily, "carpet:spelling");
  assert.equal(daily.queue.filter((entry) => entry.key === "carpet:spelling").length, 1);
});
test("a short retry tail is deferred instead of looping the same few words", () => {
  const daily = { date: "2026-08-23", queue: Array.from({ length: 5 }, (_, i) => ({ key: `miss${i}`, isRetry: true })), retryCount: {} };
  assert.equal(logic.insertRetry(daily, "carpet:spelling"), -1);
  assert.equal(daily.queue.some((entry) => entry.key === "carpet:spelling"), false);
});
test("real-error recognition requires a later confidence check", () => {
  const activity = activities.find((item) => item.key === "carpet:recognition");
  assert(logic.shouldConfirmRecognition({ key: activity.key, isRetry: false }, activity, null, "2026-08-23"));
  assert(!logic.shouldConfirmRecognition({ key: activity.key, isRetry: true }, activity, null, "2026-08-23"));
});
test("first recognition pass can be provisional instead of mastered", () => {
  const activity = activities.find((item) => item.key === "carpet:recognition");
  const decision = logic.reinforcementDecision({ key: activity.key, isRetry: false }, activity, "known", null, 0, "2026-08-23");
  assert.equal(decision.recordOutcome, "practice");
  assert.equal(decision.streak, 1); assert.equal(decision.reason, "confirm");
});
test("fuzzy recognition returns sooner and one later known answer confirms it", () => {
  const activity = activities.find((item) => item.key === "carpet:recognition");
  const fuzzy = logic.reinforcementDecision({ key: activity.key, isRetry: false }, activity, "fuzzy", null, 0, "2026-08-23");
  const recovered = logic.reinforcementDecision({ key: activity.key, isRetry: true, reason: "fuzzy" }, activity, "known", null, 0, "2026-08-23");
  assert.equal(fuzzy.recordOutcome, "fail"); assert.equal(fuzzy.reason, "fuzzy");
  assert.equal(fuzzy.minDistance, 10); assert.equal(fuzzy.maxDistance, 14);
  assert.equal(recovered.recordOutcome, "pass"); assert.equal(recovered.retry, false);
});
test("unknown recognition needs two later known answers", () => {
  const activity = activities.find((item) => item.key === "carpet:recognition");
  const unknown = logic.reinforcementDecision({ key: activity.key, isRetry: false }, activity, "unknown", null, 0, "2026-08-23");
  const firstKnown = logic.reinforcementDecision({ key: activity.key, isRetry: true, reason: "unknown" }, activity, "known", null, 0, "2026-08-23");
  const secondKnown = logic.reinforcementDecision({ key: activity.key, isRetry: true, reason: "confirm" }, activity, "known", null, firstKnown.streak, "2026-08-23");
  assert.equal(unknown.recordOutcome, "fail"); assert.equal(unknown.reason, "unknown");
  assert.equal(firstKnown.recordOutcome, "practice"); assert(firstKnown.retry);
  assert.equal(secondKnown.recordOutcome, "pass"); assert.equal(secondKnown.retry, false);
});
test("a miss needs two consecutive recovery passes", () => {
  const activity = activities.find((item) => item.key === "carpet:spelling");
  const missed = logic.reinforcementDecision({ key: activity.key, isRetry: false }, activity, "fail", null, 0, "2026-08-23");
  const firstRecovery = logic.reinforcementDecision({ key: activity.key, isRetry: true, reason: "retry" }, activity, "pass", null, missed.streak, "2026-08-23");
  const secondRecovery = logic.reinforcementDecision({ key: activity.key, isRetry: true, reason: "confirm" }, activity, "pass", null, firstRecovery.streak, "2026-08-23");
  assert.equal(missed.recordOutcome, "fail"); assert(missed.retry);
  assert.equal(firstRecovery.recordOutcome, "practice"); assert(firstRecovery.retry);
  assert.equal(secondRecovery.recordOutcome, "pass"); assert.equal(secondRecovery.retry, false);
});
test("practice pass is counted without advancing the memory stage", () => {
  const record = logic.recordPracticePass({ stage: 0, attempts: 1, passes: 0, lapses: 1 }, "2026-08-23", true);
  assert.equal(record.stage, 0); assert.equal(record.attempts, 2); assert.equal(record.passes, 1);
  assert.equal(record.due, "2026-08-24");
  assert.equal(record.pendingConfirmation, true);
});
test("mastery clears a pending confidence flag", () => {
  const record = logic.scheduleReview({ stage: 0, pendingConfirmation: true }, "pass", "2026-08-23");
  assert.equal(record.pendingConfirmation, false); assert.equal(record.stage, 1);
});
test("choices contain target and four unique meanings", () => {
  const activity = activities.find((item) => item.key === "carpet:recognition");
  const choices = logic.buildChoices(activity, activities);
  assert.equal(choices.length, 4); assert.equal(new Set(choices).size, 4); assert(choices.includes("地毯"));
});
test("legacy choices never place overlapping Chinese glosses together", () => {
  const overlapActivities = logic.makeActivities([
    { id: "end", term: "end", meaning: "目的；目标", modes: ["recognition"] },
    { id: "aim", term: "aim", meaning: "目标；目的", modes: ["recognition"] },
    { id: "carpet", term: "carpet", meaning: "地毯", modes: ["recognition"] },
    { id: "chair", term: "chair", meaning: "椅子", modes: ["recognition"] },
    { id: "desk", term: "desk", meaning: "书桌", modes: ["recognition"] },
  ]);
  const end = overlapActivities.find((item) => item.key === "end:recognition");
  assert.equal(logic.buildChoices(end, overlapActivities).includes("目标；目的"), false);
});
test("recognition choices expose the matched part of speech", () => {
  const activity = activities.find((item) => item.key === "carpet:recognition");
  assert.equal(logic.partOfSpeechForMeaning(activity, "地毯", activities), "名词");
  assert.equal(logic.partOfSpeechForMeaning(activity, "未知释义", activities), "词性待补");
});
test("recognition part-of-speech labels use compact English abbreviations", () => {
  assert.equal(logic.abbreviatePartOfSpeech("名词"), "n");
  assert.equal(logic.abbreviatePartOfSpeech("形容词"), "adj");
  assert.equal(logic.abbreviatePartOfSpeech("名词 / 动词"), "n/v");
  assert.equal(logic.abbreviatePartOfSpeech("词性待补"), "—");
});
test("same daily deck survives prepare", () => {
  const state = logic.prepareDaily(logic.safeState(null), activities, "2026-08-23");
  const first = state.daily;
  logic.prepareDaily(state, activities, "2026-08-23");
  assert.strictEqual(state.daily, first);
});
test("new day creates new state", () => {
  const state = logic.prepareDaily(logic.safeState(null), activities, "2026-08-23");
  logic.prepareDaily(state, activities, "2026-08-24");
  assert.equal(state.daily.date, "2026-08-24"); assert.equal(Object.keys(state.daily.answeredBase).length, 0);
});
test("safe state rejects bad progress", () => assert.deepEqual(logic.safeState({ progress: null }).progress, {}));
test("version one state migrates without losing progress", () => {
  const state = logic.safeState({ version: 1, progress: { x: { stage: 2 } } });
  assert.equal(state.version, 3); assert.equal(state.progress.x.stage, 2); assert.deepEqual(state.starred, {});
});
test("response limit is five seconds", () => assert.equal(logic.RESPONSE_LIMIT_MS, 5000));
test("audio plays at a brisk training pace", () => assert.equal(logic.AUDIO_PLAYBACK_RATE, 1.2));
test("only a clean pass auto-advances", () => {
  assert(logic.shouldAutoAdvance("pass"));
  assert.equal(logic.shouldAutoAdvance("slow"), false);
  assert.equal(logic.shouldAutoAdvance("fail"), false);
});
test("quick pass feedback stays long enough to read on a phone", () => {
  assert(logic.QUICK_PASS_DELAY_MS >= 700 && logic.QUICK_PASS_DELAY_MS <= 900);
  assert(logic.SPELLING_MEANING_DELAY_MS >= 1200 && logic.SPELLING_MEANING_DELAY_MS <= 1500);
  assert(logic.QUESTION_TRANSITION_MS >= 140 && logic.QUESTION_TRANSITION_MS <= 240);
});
test("result note has no dangling separator when source note is empty", () => {
  assert.equal(logic.formatResultNote("", "fail", "learning"), "8–14 题后再练，并已加入高频复习");
  assert.equal(logic.formatResultNote("—", "fail", "learning"), "8–14 题后再练，并已加入高频复习");
  assert.equal(logic.formatResultNote("", "fail", "review"), "8–14 题后再练");
  assert.equal(logic.formatResultNote("", "fail", "errors"), "8–14 题后再练，并已加入高频复习");
  assert.equal(logic.formatResultNote("", "fail", "starred"), "8–14 题后再练，并已加入高频复习");
  assert.equal(logic.formatResultNote("双写错误", "fail", "learning"), "双写错误 · 8–14 题后再练，并已加入高频复习");
});
test("different published version triggers an update", () => assert(logic.hasVersionUpdate("v2.11.1", "v2.11.2")));
test("matching published version does not trigger an update", () => assert.equal(logic.hasVersionUpdate("v2.11.2", "v2.11.2"), false));
test("intervals match spec", () => assert.deepEqual(logic.INTERVALS, [1, 3, 7, 14, 30, 60]));
test("visible app version matches release metadata", () => assert.equal(logic.APP_VERSION, require("../version.json").version));
test("direction response limit is two seconds", () => assert.equal(logic.DIRECTION_RESPONSE_LIMIT_MS, 2000));
test("hard direction response limit is one second", () => assert.equal(logic.HARD_DIRECTION_RESPONSE_LIMIT_MS, 1000));
test("hard direction audio plays at one point four speed", () => assert.equal(logic.HARD_DIRECTION_PLAYBACK_RATE, 1.4));
test("direction release preserves the existing training reset", () => assert.equal(logic.TRAINING_RESET_ID, "fresh-start-v2.5.0"));
test("learning-review migration preserves progress and rebuilds only task queues", () => {
  const migrated = logic.applyLearningReviewSplit(logic.safeState({
    progress: { "carpet:spelling": { lapses: 4 } },
    daily: { date: "2026-08-24", queue: [{ key: "carpet:spelling" }] },
    reviewDaily: { date: "2026-08-24", queue: [] },
    starred: { carpet: true },
  }));
  assert.equal(migrated.progress["carpet:spelling"].lapses, 4);
  assert(migrated.starred.carpet); assert.equal(migrated.daily, null); assert.equal(migrated.reviewDaily, null);
  assert.equal(migrated.learningReviewSplitId, logic.LEARNING_REVIEW_SPLIT_ID);
});
test("self-assessment migration removes old short retries without clearing progress", () => {
  const migrated = logic.applySelfAssessmentFlow(logic.safeState({
    progress: { "carpet:recognition": { lapses: 2, due: "2026-09-02" } },
    daily: {
      date: "2026-09-01", baseKeys: ["carpet:recognition", "r0:recognition"],
      queue: [
        { key: "carpet:recognition", isRetry: true, reason: "retry" },
        { key: "r0:recognition", isRetry: false },
      ],
      answeredBase: { "carpet:recognition": true }, outcomes: {}, retryCount: { "carpet:recognition": 2 },
    },
  }));
  assert.equal(migrated.daily.queue.length, 1);
  assert.equal(migrated.daily.queue[0].key, "r0:recognition");
  assert.equal(migrated.progress["carpet:recognition"].lapses, 2);
  assert.deepEqual(migrated.daily.retryCount, {});
  assert.equal(migrated.selfAssessmentFlowId, logic.SELF_ASSESSMENT_FLOW_ID);
});
test("release reset clears training but preserves personal words and stars", () => {
  const reset = logic.applyTrainingReset(logic.safeState({
    progress: { "carpet:spelling": { stage: 3 } },
    daily: { date: "2026-08-24", queue: [{ key: "carpet:spelling" }] },
    streak: 8,
    starred: { carpet: true },
    customItems: [{ id: "retain", term: "retain" }],
  }));
  assert.deepEqual(reset.progress, {}); assert.equal(reset.daily, null); assert.equal(reset.streak, 0);
  assert(reset.starred.carpet); assert.equal(reset.customItems[0].id, "retain");
  assert.equal(reset.trainingResetId, logic.TRAINING_RESET_ID);
});
test("release reset only runs once", () => {
  const current = logic.applyTrainingReset(logic.safeState(null));
  current.progress["carpet:spelling"] = { stage: 1 };
  assert.equal(logic.applyTrainingReset(current).progress["carpet:spelling"].stage, 1);
});
test("a new deck nonce changes the fresh test selection", () => assert.notDeepEqual(
  logic.createDailyDeck(activities, {}, "2026-08-24", {}, { deckNonce: "first", prioritiseRealErrors: false }),
  logic.createDailyDeck(activities, {}, "2026-08-24", {}, { deckNonce: "second", prioritiseRealErrors: false })
));
test("spelling answer reveals after first error", () => assert.equal(logic.shouldRevealAnswer("spelling", "fail", 1), true));
test("spelling answer still reveals after repeated errors", () => assert.equal(logic.shouldRevealAnswer("spelling", "fail", 3), true));
test("recognition answer reveals immediately", () => assert.equal(logic.shouldRevealAnswer("recognition", "fail", 1), true));
test("browse all contains every source item", () => assert.equal(logic.createBrowseDeck(items, "all", "seed").length, items.length));
test("browse spelling only contains spelling items", () => assert(logic.createBrowseDeck(items, "spelling", "seed").every((item) => item.modes.includes("spelling"))));
test("browse recognition only contains recognition items", () => assert(logic.createBrowseDeck(items, "recognition", "seed").every((item) => item.modes.includes("recognition"))));
test("browse errors only contains real errors", () => assert(logic.createBrowseDeck(items, "errors", "seed").every((item) => item.isRealError)));
test("browse starred only contains marked words", () => assert.deepEqual(
  logic.createBrowseDeck(items, "starred", "seed", { carpet: true }).map((item) => item.id), ["carpet"]
));
test("browse order is deterministic for the same seed", () => assert.deepEqual(
  logic.createBrowseDeck(items, "all", "same").map((item) => item.id),
  logic.createBrowseDeck(items, "all", "same").map((item) => item.id)
));
test("GPT JSON package is classified into both modes", () => {
  const parsed = logic.parseWrongWordInput('[{"term":"retain","meaning":"保留","mode":"both","reason":"听错也不认识"}]');
  assert.deepEqual(parsed[0].modes.sort(), ["recognition", "spelling"]);
});
test("pipe-delimited package is accepted", () => {
  const parsed = logic.parseWrongWordInput("accommodation | 住宿 | 听写 | 双写错误");
  assert.equal(parsed[0].id, "accommodation"); assert.deepEqual(parsed[0].modes, ["spelling"]);
});
test("numbered casual paste strips numbering and HTML spaces", () => {
  const known = [
    { id: "juggle", term: "juggle", meaning: "同时应付", modes: ["recognition"] },
    { id: "rural", term: "rural", meaning: "乡村的", modes: ["recognition"] },
  ];
  const parsed = logic.parseWrongWordDrafts("1. juggle&#x20;\n\n2) rural&#x20;", known);
  assert.deepEqual(parsed.map((item) => item.term), ["juggle", "rural"]);
  assert.deepEqual(parsed.map((item) => item.meaning), ["同时应付", "乡村的"]);
});
test("casual paste splits adjacent known words but preserves a known phrase", () => {
  const known = [
    { id: "fast-paced", term: "fast-paced", meaning: "节奏快的", modes: ["recognition"] },
    { id: "permanent", term: "permanent", meaning: "长期的", modes: ["recognition"] },
    { id: "low-profit-margins", term: "low profit margins", meaning: "低利润率", modes: ["recognition"] },
  ];
  const parsed = logic.parseWrongWordDrafts("3. fast-paced permanent\n11. low profit margins", known);
  assert.deepEqual(parsed.map((item) => item.term), ["fast-paced", "permanent", "low profit margins"]);
});
test("casual paste uses inline Chinese and keeps usage hints out of the meaning", () => {
  const known = [{ id: "round", term: "round", meaning: "圆的；球形的", modes: ["recognition"] }];
  const parsed = logic.parseWrongWordDrafts("postpone推迟\nround 作为形容词", known);
  assert.equal(parsed[0].meaning, "推迟");
  assert.equal(parsed[1].meaning, "圆的；球形的");
  assert(parsed[1].reason.includes("作为形容词"));
});
test("unknown casual paste remains a preview draft needing a meaning", () => {
  const parsed = logic.parseWrongWordDrafts("new vocabulary phrase", []);
  assert.equal(parsed[0].term, "new vocabulary phrase"); assert.equal(parsed[0].meaning, "");
});
test("numeric-leading vocabulary phrase is accepted", () => {
  const parsed = logic.parseWrongWordInput('[{"term":"12-month maternity cover contract","meaning":"产假替岗合同","mode":"recognition"}]');
  assert.equal(parsed[0].id, "12-month-maternity-cover-contract");
});
test("full sentences are rejected by structured and casual vocabulary intake", () => {
  const sentence = "Large pans of sap called evaporators are heated by means of a fire";
  assert.throws(() => logic.parseWrongWordInput(JSON.stringify([{
    term: sentence, meaning: "装有树液的大锅用火加热", mode: "recognition",
  }])), /完整句子不能加入词库/);
  assert.throws(() => logic.parseWrongWordDrafts(sentence, []), /完整句子不能加入词库/);
});
test("legacy local full sentences are removed without breaking startup", () => {
  const merged = logic.mergeCustomItems(items, [{
    term: "Large pans of sap called evaporators are heated by means of a fire",
    meaning: "装有树液的大锅用火加热", mode: "recognition",
  }]);
  assert.equal(merged.some((item) => item.term.startsWith("Large pans of sap")), false);
});
test("custom word merges with an existing item", () => {
  const merged = logic.mergeCustomItems(items, [{ term: "carpet", meaning: "地毯", mode: "both", reason: "又错了" }]);
  const carpet = merged.find((item) => item.id === "carpet");
  assert(carpet.isRealError); assert.deepEqual(carpet.modes.sort(), ["recognition", "spelling"]);
});
test("plural progress and today's queue migrate to the singular card", () => {
  const source = [{
    id: "curtain", term: "curtain", meaning: "窗帘", modes: ["spelling"],
    numberVariants: ["curtains"], acceptedAnswers: ["curtain"],
  }];
  const state = logic.safeState({
    version: 2,
    progress: {
      "curtain:spelling": { stage: 1, attempts: 1, passes: 1, lapses: 0, due: "2026-08-25" },
      "curtains:spelling": { stage: 3, attempts: 2, passes: 1, lapses: 1, due: "2026-08-24" },
    },
    starred: { curtains: true },
    daily: {
      baseKeys: ["curtain:spelling", "curtains:spelling"],
      queue: [
        { key: "curtain:spelling", isRetry: false },
        { key: "curtains:spelling", isRetry: false },
      ],
      answeredBase: {}, outcomes: {}, retryCount: {},
    },
    starredDaily: {
      baseKeys: ["curtains:spelling"],
      queue: [{ key: "curtains:spelling", isRetry: false }],
      answeredBase: {}, outcomes: {}, retryCount: {},
    },
  });
  logic.migrateNumberVariantState(state, source);
  assert.deepEqual(state.daily.baseKeys, ["curtain:spelling"]);
  assert.equal(state.daily.queue.length, 1);
  assert.equal(state.progress["curtain:spelling"].attempts, 3);
  assert.equal(state.progress["curtain:spelling"].stage, 3);
  assert.equal(state.progress["curtain:spelling"].due, "2026-08-24");
  assert(!state.progress["curtains:spelling"]);
  assert.deepEqual(state.starred, { curtain: true });
  assert.deepEqual(state.starredDaily.baseKeys, ["curtain:spelling"]);
});
test("a locally added plural merges into the published singular item", () => {
  const source = [{
    id: "curtain", term: "curtain", meaning: "窗帘", modes: ["spelling"],
    numberVariants: ["curtains"], acceptedAnswers: ["curtain"],
  }];
  const merged = logic.mergeCustomItems(source, [
    { term: "curtains", meaning: "窗帘", mode: "recognition", reason: "不重复考复数" },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, "curtain");
  assert.deepEqual(merged[0].modes.sort(), ["recognition", "spelling"]);
});
test("browse page size is twenty", () => assert.equal(logic.BROWSE_PAGE_SIZE, 20));

// ===== 永久错词档案（移植自 marco-ielts-cards 已验证实现）=====

test("first error creates an active permanent error record", () => {
  const record = logic.registerErrorWord(null, { source: "listening", sourceDetail: "今日新词·听写答错", errorType: "spelling", causedIeltsError: true }, "2026-09-04");
  assert.equal(logic.isActiveErrorWord(record), true);
  assert.equal(record.wrongCount, 1);
  assert.equal(record.priority, "S");
  assert.equal(record.firstWrongAt, "2026-09-04");
  assert.equal(record.lastWrongAt, "2026-09-04");
  assert.equal(record.reviewStatus, "learning");
});

test("repeated errors update the same record instead of duplicating", () => {
  const first = logic.registerErrorWord(null, { source: "listening", sourceDetail: "听写错", causedIeltsError: true }, "2026-09-04");
  const second = logic.registerErrorWord(first, { source: "vocabulary", sourceDetail: "背新词·不认识", causedIeltsError: true }, "2026-09-05", { stage: 0, due: "2026-09-06" });
  assert.equal(second.wrongCount, 2);
  assert.equal(second.firstWrongAt, "2026-09-04");
  assert.equal(second.lastWrongAt, "2026-09-05");
  assert.equal(second.priority, "S");
  assert.equal(second.nextReviewAt, "2026-09-06");
  assert.equal(second.sources.length, 2);
});

test("consecutive passes raise mastery but never erase error identity", () => {
  let record = logic.registerErrorWord(null, { source: "vocabulary", sourceDetail: "不认识", causedIeltsError: true }, "2026-09-04");
  record = logic.reviewErrorWord(record, "known", "2026-09-05", { stage: 3, due: "2026-09-12" });
  assert.equal(record.isErrorWord, true);
  assert.equal(record.masteryLevel, 3);
  assert.equal(record.reviewStatus, "stable");
  assert.equal(record.wrongCount, 1);
  record = logic.reviewErrorWord(record, "known", "2026-09-12", { stage: 5, due: "2026-10-11" });
  assert.equal(record.reviewStatus, "mastered");
  assert.equal(record.isErrorWord, true);
  assert.equal(logic.isActiveErrorWord(record), true);
});

test("only manual pardon exits the active pool and history is preserved", () => {
  let record = logic.registerErrorWord(null, { source: "listening", sourceDetail: "听写错", causedIeltsError: true }, "2026-09-04");
  record = logic.registerErrorWord(record, { source: "vocabulary", sourceDetail: "又不认识" }, "2026-09-05");
  const pardoned = logic.pardonErrorWord(record, "2026-09-06T08:00:00.000Z");
  assert.equal(logic.isActiveErrorWord(pardoned), false);
  assert.equal(pardoned.pardoned, true);
  assert.equal(pardoned.wrongCount, 2);
  assert.equal(pardoned.firstWrongAt, "2026-09-04");
  assert.equal(pardoned.sources.length, 2);
  assert.equal(pardoned.isErrorWord, true);
});

test("re-error after pardon auto revives as S with history kept", () => {
  let record = logic.registerErrorWord(null, { source: "listening", sourceDetail: "听写错", causedIeltsError: true }, "2026-09-01");
  record = logic.pardonErrorWord(record, "2026-09-02T08:00:00.000Z");
  const revived = logic.registerErrorWord(record, { source: "vocabulary", sourceDetail: "背错词·不认识", causedIeltsError: true }, "2026-09-04", { stage: 0, due: "2026-09-05" });
  assert.equal(logic.isActiveErrorWord(revived), true);
  assert.equal(revived.pardoned, false);
  assert.equal(revived.wrongCount, 2);
  assert.equal(revived.priority, "S");
  assert.equal(revived.masteryLevel, 0);
  assert.equal(revived.nextReviewAt, "2026-09-05");
  assert(revived.pardonHistory.includes("2026-09-02T08:00:00.000Z"));
});

test("error deck orders by due, priority, recency and wrong count", () => {
  const vocabItems = ["due-s", "due-a", "future-s", "future-b"].map((id) => ({ id }));
  const records = logic.sanitizeErrorWordRecords({
    "future-s": { isErrorWord: true, priority: "S", wrongCount: 1, nextReviewAt: "2026-09-10", lastWrongAt: "2026-09-04" },
    "due-a": { isErrorWord: true, priority: "A", wrongCount: 1, nextReviewAt: "2026-09-03", lastWrongAt: "2026-09-01" },
    "due-s": { isErrorWord: true, priority: "S", wrongCount: 3, nextReviewAt: "2026-09-04", lastWrongAt: "2026-09-02" },
    "future-b": { isErrorWord: true, priority: "B", wrongCount: 1, nextReviewAt: "2026-10-01", masteryLevel: 5, reviewStatus: "mastered" },
  });
  const deck = logic.createVocabErrorDeck(vocabItems, records, "2026-09-04", 4);
  assert.deepEqual(deck, ["due-s:vocab", "due-a:vocab", "future-s:vocab", "future-b:vocab"]);
});

test("error deck excludes pardoned and caps at the daily target", () => {
  const vocabItems = Array.from({ length: 25 }, (_, index) => ({ id: `w${index}` }));
  const raw = {};
  vocabItems.forEach((item, index) => {
    raw[item.id] = { isErrorWord: true, priority: "S", wrongCount: 1, nextReviewAt: "2026-09-04" };
    if (index === 0) { raw[item.id].pardoned = true; raw[item.id].isErrorWord = false; }
  });
  const deck = logic.createVocabErrorDeck(vocabItems, raw, "2026-09-04");
  assert.equal(deck.length, logic.ERROR_VOCAB_DAILY_TARGET);
  assert(!deck.includes("w0:vocab"));
});

test("mastered B-level records stay in the active pool", () => {
  const record = logic.sanitizeErrorWordRecords({ x: { isErrorWord: true, priority: "B", wrongCount: 1, masteryLevel: 5, reviewStatus: "mastered" } }).x;
  assert.equal(logic.isActiveErrorWord(record), true);
});

test("seedErrorArchive imports personal error items once with progress lapses", () => {
  const vocabItems = [
    { id: "carpet", term: "carpet", meaning: "地毯", modes: ["spelling", "recognition"], isRealError: true, sourceType: "user", errorNote: "剑桥真题错题" },
    { id: "plain", term: "plain", meaning: "平的", modes: ["recognition"], isRealError: false },
  ];
  const progress = { "carpet:spelling": { stage: 2, lapses: 3, due: "2026-09-06", lastSeen: "2026-09-01" } };
  const seeded = logic.seedErrorArchive({}, vocabItems, progress, "2026-09-04");
  assert.equal(Object.keys(seeded).length, 1);
  assert.equal(seeded.carpet.wrongCount, 3);
  assert.equal(seeded.carpet.priority, "S");
  assert.equal(seeded.carpet.nextReviewAt, "2026-09-06");
  assert.equal(seeded.carpet.masteryLevel, 2);
  const reseeded = logic.seedErrorArchive(seeded, vocabItems, progress, "2026-09-05");
  assert.equal(reseeded.carpet.wrongCount, 3);
});

test("vocab new session reuses the daily recognition subset", () => {
  const progress = {};
  const deck = logic.createLearningDeck(activities, progress, "2026-09-04");
  const recognitionKeys = deck.filter((key) => key.endsWith(":recognition"));
  const session = logic.syncVocabNewSession(null, "2026-09-04", recognitionKeys);
  assert.equal(session.poolId, logic.VOCAB_NEW_POOL_ID);
  assert.equal(session.queue.length, 25);
  const synced = logic.syncVocabNewSession(session, "2026-09-04", recognitionKeys);
  assert.equal(synced, session);
});

test("safeState keeps error archive and vocab sessions", () => {
  const state = logic.safeState({
    errorWords: { carpet: { isErrorWord: true, wrongCount: 2 } },
    vocabNewDaily: { date: "2026-09-04" },
    vocabErrorDaily: { date: "2026-09-04" },
  });
  assert.equal(state.errorWords.carpet.wrongCount, 2);
  assert.equal(state.vocabNewDaily.date, "2026-09-04");
  assert.equal(state.vocabErrorDaily.date, "2026-09-04");
  const fresh = logic.safeState(null);
  assert.deepEqual(fresh.errorWords, {});
  assert.equal(fresh.vocabNewDaily, null);
});

test("mergeErrorWordRecords combines duplicate ids without losing history", () => {
  const first = logic.registerErrorWord(null, { source: "listening", sourceDetail: "听写错" }, "2026-09-01");
  const second = logic.registerErrorWord(null, { source: "vocabulary", sourceDetail: "不认识" }, "2026-09-03");
  const merged = logic.mergeErrorWordRecords(first, second);
  assert.equal(merged.wrongCount, 2);
  assert.equal(merged.firstWrongAt, "2026-09-01");
  assert.equal(merged.lastWrongAt, "2026-09-03");
  assert.equal(merged.sources.length, 2);
});



test("ordinary training miss is not permanently tagged as an IELTS-caused error", () => {
  let record = logic.registerErrorWord(null, { source: "vocabulary", sourceDetail: "背新词·选择不认识", causedIeltsError: false }, "2026-09-04");
  assert.equal(record.causedIeltsError, false);
  record = logic.reviewErrorWord(record, "known", "2026-09-08", { stage: 3, due: "2026-09-15" });
  assert.equal(record.priority, "B");
});

test("pardon immediately removes a word from the existing daily error queue", () => {
  const items = [{ id: "a" }, { id: "b" }];
  const records = logic.sanitizeErrorWordRecords({
    a: { isErrorWord: true, priority: "S", wrongCount: 1, nextReviewAt: "2026-09-04" },
    b: { isErrorWord: true, priority: "S", wrongCount: 1, nextReviewAt: "2026-09-04" },
  });
  let session = logic.syncVocabErrorSession(null, "2026-09-04", logic.createVocabErrorDeck(items, records, "2026-09-04", 2));
  records.a = logic.pardonErrorWord(records.a, "2026-09-04T10:00:00.000Z");
  session = logic.syncVocabErrorSession(session, "2026-09-04", logic.createVocabErrorDeck(items, records, "2026-09-04", 2));
  assert(!session.baseKeys.includes("a:vocab"));
  assert(!session.queue.some((entry) => entry.key === "a:vocab"));
});

test("error vocab progress starts from archive mastery instead of stale vocab state", () => {
  const archive = { masteryLevel: 5, nextReviewAt: "2026-10-01", lastReviewAt: "2026-09-01" };
  const base = logic.progressFromErrorArchive(archive, { stage: 1, due: "2026-09-05", passes: 7 });
  assert.equal(base.stage, 5);
  assert.equal(base.due, "2026-10-01");
  const passed = logic.scheduleReview(base, "pass", "2026-10-01");
  let record = logic.sanitizeErrorWordRecords({ x: { isErrorWord: true, masteryLevel: 5, priority: "B", wrongCount: 1 } }).x;
  record = logic.reviewErrorWord(record, "known", "2026-10-01", passed);
  assert.equal(record.masteryLevel, 5);
  assert.equal(record.reviewStatus, "mastered");
});

test("reactivated error ignores stale high vocab stage and restarts from archive stage", () => {
  const base = logic.progressFromErrorArchive({ masteryLevel: 0, nextReviewAt: "2026-09-05" }, { stage: 5, due: "2026-10-01" });
  assert.equal(base.stage, 0);
  assert.equal(base.due, "2026-09-05");
});

test("backup validation rejects partial sessions and corrupt records", () => {
  assert.throws(() => logic.validateProgressBackup({version:3, progress:{bad:null}}));
  assert.throws(() => logic.validateProgressBackup({version:3, progress:{}, daily:{queue:[]}}));
  assert.throws(() => logic.validateProgressBackup({version:3, progress:{}, customItems:[{term:"carpet",meaning:"",mode:"recognition"}]}));
});

test("restored old backups survive the historical reset migration", () => {
  const raw = {version:1, progress:{"carpet:recognition":{stage:2,lapses:3}},starred:{carpet:true}};
  const restored = logic.prepareImportedState(raw, items, "2026-09-05");
  assert.equal(logic.applyTrainingReset(restored).progress["carpet:recognition"].lapses,3);
  assert(restored.starred.carpet);
  assert.equal(raw.trainingResetId,undefined);
});

test("old pardons regain permanent identity without losing history or stars", () => {
  const state = logic.safeState({starred:{x:true},errorWords:{x:{isErrorWord:false,pardoned:true,wrongCount:4,history:["kept"]}}});
  state.errorWords = logic.seedErrorArchive(state.errorWords,[{id:"x",modes:["recognition"]}],{},"2026-09-05");
  assert(state.errorWords.x.isErrorWord);
  assert(!logic.isActiveErrorWord(state.errorWords.x));
  assert.deepEqual(state.errorWords.x.history,["kept"]);
  assert(state.starred.x);
});

test("archive migration includes static real errors and ordinary legacy misses once", () => {
  const source=[{id:"static",isRealError:true,modes:["recognition"]},{id:"ordinary",modes:["recognition"]}];
  const progress={"ordinary:recognition":{lapses:3},"ordinary:vocab":{lapses:2}};
  const records=logic.seedErrorArchive({},source,progress,"2026-09-05");
  assert.equal(records.static.wrongCount,1);
  assert.equal(records.ordinary.wrongCount,5);
  assert.equal(records.ordinary.firstWrongAt,"");
  assert.equal(logic.seedErrorArchive(records,source,progress,"2026-09-06").ordinary.wrongCount,5);
});

test("archive counts and browsing share all active pardoned and important membership", () => {
  const source=[{id:"a",modes:[]},{id:"b",modes:[]},{id:"c",modes:[]}];
  const records=logic.sanitizeErrorWordRecords({a:{wrongCount:2,priority:"S"},b:{pardoned:true,isErrorWord:false,wrongCount:1},c:{wrongCount:1,priority:"B"}});
  const counts=logic.errorLibraryCounts(source,records,{b:true,c:true});
  assert.equal(counts.all,3);assert.equal(counts.active,2);assert.equal(counts.pardoned,1);
  assert.equal(counts.S,1);assert.equal(counts.B,1);assert.equal(counts.starred,2);
  assert.equal(logic.createBrowseDeck(source,"errors","test",{},records).length,3);
});

console.log(JSON.stringify({ ok: true, tests }));
