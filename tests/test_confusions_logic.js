const assert = require("assert");
const fs = require("fs");
const path = require("path");
const logic = require("../confusions/logic.js");

const data = JSON.parse(fs.readFileSync(path.join(__dirname, "../confusions/data/confusions.json"), "utf8"));
const groups = data.groups;
let tests = 0;
function test(name, run) {
  try { run(); tests += 1; }
  catch (error) { error.message = `${name}: ${error.message}`; throw error; }
}

test("data contains 32 groups and 84 unique terms", () => {
  assert.equal(groups.length, 32);
  const terms = groups.flatMap((group) => group.terms.map((term) => term.term));
  assert.equal(terms.length, 84);
  assert.equal(new Set(terms).size, 84);
  assert(groups.every((group) => group.terms.length >= 2));
  assert(groups.every((group) => group.terms.every((term) => term.sentence.split("___").length === 2)));
});

test("all distractors come from the expected group", () => {
  groups.forEach((group) => group.terms.forEach((expected) => {
    const allowed = new Set(group.terms.map((term) => term.term));
    const choices = logic.makeChoices(group, expected, `choices:${group.id}:${expected.term}`);
    assert(choices.some((choice) => choice.term === expected.term));
    assert(choices.every((choice) => allowed.has(choice.term)));
    assert(choices.length >= 2 && choices.length <= 4);
  }));
});

test("cold test contains 12 unique groups with exact type quotas", () => {
  const deck = logic.buildColdTest(groups, logic.defaultState(), "cold-seed");
  assert.equal(deck.length, 12);
  assert.equal(new Set(deck.map((question) => question.groupId)).size, 12);
  const counts = deck.reduce((result, question) => ({ ...result, [question.type]: (result[question.type] || 0) + 1 }), {});
  assert.deepEqual(counts, { "en-zh": 3, "zh-en": 3, sentence: 6 });
});

test("timeouts and response times are recorded from one answer", () => {
  const question = logic.buildColdTest(groups, logic.defaultState(), "timeout")[0];
  const timeout = logic.answerQuestion(question, null, 99999, "2026-08-31T00:00:00.000Z");
  assert.equal(timeout.timedOut, true);
  assert.equal(timeout.selected, null);
  assert.equal(timeout.responseMs, question.timeLimitMs);
  const selected = logic.answerQuestion(question, question.expected, 321.8, "2026-08-31T00:00:01.000Z");
  assert.equal(selected.correct, true);
  assert.equal(selected.responseMs, 322);
});

test("median handles odd and even samples", () => {
  assert.equal(logic.median([3, 1, 2]), 2);
  assert.equal(logic.median([4, 1, 3, 2]), 2.5);
  assert.equal(logic.median([]), null);
});

test("cold test records pairwise confusion and first-attempt score", () => {
  const deck = logic.buildColdTest(groups, logic.defaultState(), "pairs");
  const answers = deck.map((question, index) => logic.answerQuestion(
    question,
    index === 0 ? question.choices.find((choice) => choice.term !== question.expected).term : question.expected,
    500,
    `2026-08-31T00:00:${String(index).padStart(2, "0")}.000Z`,
  ));
  const result = logic.recordColdTest(logic.defaultState(), answers, "2026-08-31T00:00:00.000Z");
  assert.equal(result.summary.score, 11);
  const wrong = answers[0];
  assert.equal(result.state.confusionPairs[`${wrong.expected}->${wrong.selected}`].count, 1);
  assert.equal(result.state.groupStats[wrong.groupId].attempts, 1);
  assert.equal(result.state.groupStats[wrong.groupId].testAccuracy, 0);
});

test("learning and reinforcement never create cold-test statistics", () => {
  let state = logic.markGroupFamiliar(logic.defaultState(), groups[0].id, "2026-08-31T00:00:00.000Z");
  assert.equal(state.learning[groups[0].id].status, "familiar");
  assert.deepEqual(state.groupStats, {});
  assert.equal(state.testHistory.length, 0);
  state = logic.recordReinforcement(state, "cold-1", [{ expected: "compose", correct: true }], "2026-08-31T00:00:01.000Z");
  assert.equal(state.reinforcement.length, 1);
  assert.deepEqual(state.groupStats, {});
  assert.equal(state.testHistory.length, 0);
  assert.deepEqual(state.confusionPairs, {});
});

test("group status follows high-risk learning and stable rules", () => {
  const outcome = (correct, type, responseMs, expected = "a", selected = null) => ({ correct, type, responseMs, expected, selected });
  assert.equal(logic.computeGroupStatus([]), "untested");
  assert.equal(logic.computeGroupStatus([outcome(false, "en-zh", 2500, "a", "b")]), "high-risk");
  assert.equal(logic.computeGroupStatus([
    outcome(true, "en-zh", 1200), outcome(true, "sentence", 3000),
  ]), "learning");
  assert.equal(logic.computeGroupStatus([
    outcome(true, "en-zh", 1200), outcome(true, "sentence", 3000), outcome(true, "zh-en", 1600),
  ]), "stable");
  assert.equal(logic.computeGroupStatus([
    outcome(true, "en-zh", 1200), outcome(false, "sentence", 3000, "a", "b"), outcome(false, "zh-en", 1600, "a", "b"),
  ]), "high-risk");
});

test("state recovery keeps module-local collections", () => {
  const state = logic.safeState({ learning: { x: { status: "familiar" } }, testHistory: "bad", groupStats: null });
  assert.equal(state.schemaVersion, 1);
  assert.equal(state.learning.x.status, "familiar");
  assert.deepEqual(state.testHistory, []);
  assert.deepEqual(state.groupStats, {});
  assert.equal(logic.STORAGE_KEY, "marcoIeltsConfusions.v1");
});

console.log(JSON.stringify({ ok: true, tests }));
