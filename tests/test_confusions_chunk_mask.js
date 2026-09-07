const assert = require("assert");
const fs = require("fs");
const path = require("path");
const logic = require("../confusions/logic.js");

function exactTermPattern(term) {
  const escaped = String(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9])${escaped}(?=$|[^A-Za-z0-9])`, "i");
}

assert.equal(logic.maskChunkTerm("distinctive feature", "distinctive"), "___ feature");
assert.equal(logic.maskChunkTerm("distinct groups", "distinct"), "___ groups");
assert.equal(logic.maskChunkTerm("prospective students", "prospective"), "___ students");
assert.equal(logic.maskChunkTerm("Distinctive feature", "distinctive"), "___ feature");
assert.equal(logic.maskChunkTerm("distinctive feature", "distinct"), "distinctive feature");
assert.equal(logic.maskChunkTerm("a prospective student", "prospective"), "a ___ student");

const data = JSON.parse(fs.readFileSync(path.join(__dirname, "../confusions/data/confusions.json"), "utf8"));
for (const group of data.groups) {
  for (const term of group.terms) {
    const masked = logic.maskChunkTerm(term.chunk, term.term);
    assert.equal(exactTermPattern(term.term).test(masked), false, `${term.term} still leaks through ${masked}`);
  }
}

console.log(JSON.stringify({ ok: true, tests: 7, termsChecked: data.termCount }));
