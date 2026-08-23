const assert = require("assert");
const logic = require("../app.js");

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
test("plural remains significant", () => assert.notEqual(logic.normaliseAnswer("carpet"), logic.normaliseAnswer("carpets")));
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
test("real errors come first", () => {
  const deck = logic.createDailyDeck(activities, {}, "2026-08-23");
  assert(deck.indexOf("carpet:spelling") < 2);
  assert(deck.indexOf("carpet:recognition") < 2);
});
test("overdue beats unseen", () => {
  const progress = { "s20:spelling": { stage: 2, due: "2026-08-20" } };
  const deck = logic.createDailyDeck(activities, progress, "2026-08-23");
  assert.equal(deck[0], "s20:spelling");
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
test("response limit is six seconds", () => assert.equal(logic.RESPONSE_LIMIT_MS, 6000));
test("intervals match spec", () => assert.deepEqual(logic.INTERVALS, [1, 3, 7, 14, 30, 60]));
test("spelling answer stays hidden after first error", () => assert.equal(logic.shouldRevealAnswer("spelling", "fail", 1), false));
test("spelling answer reveals after third error", () => assert.equal(logic.shouldRevealAnswer("spelling", "fail", 3), true));
test("recognition answer reveals immediately", () => assert.equal(logic.shouldRevealAnswer("recognition", "fail", 1), true));

console.log(JSON.stringify({ ok: true, tests }));
