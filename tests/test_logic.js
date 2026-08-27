const assert = require("assert");
const logic = require("../app.js");
const directions = require("../data/directions.json");

let tests = 0;
function test(name, fn) {
  try { fn(); tests += 1; }
  catch (error) { error.message = `${name}: ${error.message}`; throw error; }
}

const items = [
  { id: "carpet", term: "carpet", meaning: "地毯", modes: ["spelling", "recognition"], isRealError: true, category: "住房", acceptedAnswers: ["carpet"] },
  ...Array.from({ length: 30 }, (_, index) => ({
    id: `s${index}`, term: `spell${index}`, meaning: `拼写${index}`, modes: ["spelling"], isRealError: false, category: "日常", acceptedAnswers: [`spell${index}`],
  })),
  ...Array.from({ length: 30 }, (_, index) => ({
    id: `r${index}`, term: `read${index}`, meaning: `看义${index}`, modes: ["recognition"], isRealError: false, category: "学校", acceptedAnswers: [`read${index}`],
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
test("retry is inserted five to ten places later", () => {
  const daily = { date: "2026-08-23", queue: Array.from({ length: 20 }, (_, i) => ({ key: `x${i}`, isRetry: false })), retryCount: {} };
  const index = logic.insertRetry(daily, "carpet:spelling");
  assert(index >= 5 && index <= 10); assert.equal(daily.queue[index].key, "carpet:spelling");
});
test("only one pending retry per item", () => {
  const daily = { date: "2026-08-23", queue: [], retryCount: {} };
  logic.insertRetry(daily, "carpet:spelling"); logic.insertRetry(daily, "carpet:spelling");
  assert.equal(daily.queue.filter((entry) => entry.key === "carpet:spelling").length, 1);
});
test("choices contain target and four unique meanings", () => {
  const activity = activities.find((item) => item.key === "carpet:recognition");
  const choices = logic.buildChoices(activity, activities);
  assert.equal(choices.length, 4); assert.equal(new Set(choices).size, 4); assert(choices.includes("地毯"));
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
test("quick pass feedback stays brief but visible", () => {
  assert(logic.QUICK_PASS_DELAY_MS >= 450 && logic.QUICK_PASS_DELAY_MS <= 650);
  assert(logic.QUESTION_TRANSITION_MS >= 140 && logic.QUESTION_TRANSITION_MS <= 240);
});
test("result note has no dangling separator when source note is empty", () => {
  assert.equal(logic.formatResultNote("", "fail", "learning"), "已加入高频复习");
  assert.equal(logic.formatResultNote("—", "fail", "learning"), "已加入高频复习");
  assert.equal(logic.formatResultNote("", "fail", "review"), "已放回复习队列");
  assert.equal(logic.formatResultNote("双写错误", "fail", "learning"), "双写错误 · 已加入高频复习");
});
test("different published version triggers an update", () => assert(logic.hasVersionUpdate("v2.11.0", "v2.11.1")));
test("matching published version does not trigger an update", () => assert.equal(logic.hasVersionUpdate("v2.11.1", "v2.11.1"), false));
test("intervals match spec", () => assert.deepEqual(logic.INTERVALS, [1, 3, 7, 14, 30, 60]));
test("visible app version matches this release", () => assert.equal(logic.APP_VERSION, "v2.11.1"));
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
  });
  logic.migrateNumberVariantState(state, source);
  assert.deepEqual(state.daily.baseKeys, ["curtain:spelling"]);
  assert.equal(state.daily.queue.length, 1);
  assert.equal(state.progress["curtain:spelling"].attempts, 3);
  assert.equal(state.progress["curtain:spelling"].stage, 3);
  assert.equal(state.progress["curtain:spelling"].due, "2026-08-24");
  assert(!state.progress["curtains:spelling"]);
  assert.deepEqual(state.starred, { curtain: true });
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

console.log(JSON.stringify({ ok: true, tests }));
