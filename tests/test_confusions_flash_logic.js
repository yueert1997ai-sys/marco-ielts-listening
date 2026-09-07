const assert = require("assert");
const fs = require("fs");
const path = require("path");
const logic = require("../confusions/flash-logic.js");

const payload = JSON.parse(fs.readFileSync(path.join(__dirname, "../confusions/data/confusions.json"), "utf8"));
const groups = payload.groups;
const terms = logic.flattenTerms(groups);
let tests = 0;

function test(name, run) {
  try { run(); tests += 1; }
  catch (error) { error.message = `${name}: ${error.message}`; throw error; }
}

test("flash bank uses the 84 independent Confusions terms", () => {
  assert.equal(terms.length, 84);
  assert.equal(new Set(terms.map((term) => term.term)).size, 84);
  assert.equal(logic.STORAGE_KEY, "marcoIeltsConfusionsFlash.v1");
});

test("a new flash session contains 20 unique base terms", () => {
  const state = logic.buildSession(groups, logic.defaultState(), "session");
  assert.equal(state.session.baseTerms.length, 20);
  assert.equal(new Set(state.session.baseTerms).size, 20);
  assert.deepEqual(logic.baseProgress(state), { done: 0, total: 20 });
});

test("unseen terms are prioritised before previously brushed terms", () => {
  const old = logic.defaultState();
  terms.slice(0, 30).forEach((term) => {
    old.stats[term.term] = { attempts: 2, known: 2, unknown: 0, lapses: 0, mastery: 2, streak: 2, lastSeen: "2026-09-07T00:00:00.000Z" };
  });
  const state = logic.buildSession(groups, old, "unseen-first");
  assert(state.session.baseTerms.every((term) => !old.stats[term]));
});

test("known answers raise mastery and reveal immediately", () => {
  let state = logic.buildSession(groups, logic.defaultState(), "known");
  const term = logic.currentEntry(state).term;
  state = logic.answerKnown(state, "2026-09-07T00:00:00.000Z");
  assert.equal(state.session.phase, "reveal");
  assert.equal(state.stats[term].known, 1);
  assert.equal(state.stats[term].mastery, 1);
  assert.deepEqual(logic.baseProgress(state), { done: 1, total: 20 });
});

test("unknown answers remain unknown after the meaning check and schedule spaced retry when possible", () => {
  let state = logic.buildSession(groups, logic.defaultState(), "unknown");
  const term = logic.currentEntry(state).term;
  state = logic.answerUnknown(state, "2026-09-07T00:00:00.000Z");
  assert.equal(state.session.phase, "meaning");
  assert.equal(state.stats[term].unknown, 1);
  assert.equal(state.stats[term].lapses, 1);
  assert.equal(state.stats[term].mastery, 0);
  assert.equal(state.session.pending.retryScheduled, true);
  assert(state.session.queue.some((entry, index) => index >= 8 && entry.term === term && entry.isRetry));
});

test("meaning choices contain the answer without duplicate Chinese meanings", () => {
  terms.forEach((expected) => {
    const choices = logic.makeMeaningChoices(groups, expected.term, `meaning:${expected.term}`);
    assert(choices.some((choice) => choice.term === expected.term));
    assert.equal(new Set(choices.map((choice) => choice.meaning)).size, choices.length);
    assert(choices.length >= 2 && choices.length <= 4);
  });
});

test("meaning confirmation cannot convert unknown into known", () => {
  let state = logic.buildSession(groups, logic.defaultState(), "meaning-confirm");
  const termName = logic.currentEntry(state).term;
  const term = terms.find((candidate) => candidate.term === termName);
  state = logic.answerUnknown(state);
  state = logic.confirmMeaning(state, term.meaning, term.meaning);
  assert.equal(state.session.pending.known, false);
  assert.equal(state.session.pending.meaningCorrect, true);
  assert.equal(state.stats[termName].known, 0);
  assert.equal(state.session.phase, "reveal");
});

test("advance preserves the session and moves to the next question", () => {
  let state = logic.buildSession(groups, logic.defaultState(), "advance");
  state = logic.answerKnown(state);
  state = logic.advance(state);
  assert.equal(state.session.cursor, 1);
  assert.equal(state.session.phase, "question");
  assert(logic.currentEntry(state));
});

test("seen and mastered counters are separate", () => {
  const state = logic.defaultState();
  state.stats.a = { attempts: 1, mastery: 1 };
  state.stats.b = { attempts: 2, mastery: 2 };
  assert.equal(logic.seenCount(state), 2);
  assert.equal(logic.masteredCount(state), 1);
});

console.log(JSON.stringify({ ok: true, tests, termsChecked: terms.length }));
