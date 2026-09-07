const assert = require("assert");
const fs = require("fs");
const path = require("path");
const logic = require("../confusions/logic.js");

function exactTermPattern(term) {
  const escaped = String(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9])${escaped}(?=$|[^A-Za-z0-9])`, "i");
}

const STOPWORDS = new Set([
  "a", "an", "the", "to", "of", "as", "from", "that", "with", "on", "in", "for", "by", "and", "or",
  "be", "is", "are", "was", "were", "will", "can", "may", "should", "each", "other", "someone", "their",
  "about", "after", "before", "into", "across", "among", "within", "over", "under", "through", "than",
]);

function semanticCues(masked) {
  return (String(masked).toLowerCase().match(/[a-z]+(?:-[a-z]+)?/g) || [])
    .filter((token) => !STOPWORDS.has(token));
}

assert.equal(logic.maskChunkTerm("distinctive visual feature", "distinctive"), "___ visual feature");
assert.equal(logic.maskChunkTerm("distinct categories", "distinct"), "___ categories");
assert.equal(logic.maskChunkTerm("prospective students seeking information", "prospective"), "___ students seeking information");
assert.equal(logic.maskChunkTerm("Distinctive visual feature", "distinctive"), "___ visual feature");
assert.equal(logic.maskChunkTerm("distinctive feature", "distinct"), "distinctive feature");
assert.equal(logic.maskChunkTerm("a prospective student", "prospective"), "a ___ student");

const data = JSON.parse(fs.readFileSync(path.join(__dirname, "../confusions/data/confusions.json"), "utf8"));
const maskedPrompts = new Map();
for (const group of data.groups) {
  for (const term of group.terms) {
    const masked = logic.maskChunkTerm(term.chunk, term.term);
    assert.notEqual(masked, term.chunk, `${term.term} is not present as an exact maskable term in: ${term.chunk}`);
    assert.equal(exactTermPattern(term.term).test(masked), false, `${term.term} still leaks through ${masked}`);
    assert(semanticCues(masked).length >= 2, `${term.term} leaves too little semantic information after masking: ${masked}`);
    const key = masked.toLowerCase();
    assert(!maskedPrompts.has(key), `${term.term} duplicates masked prompt used by ${maskedPrompts.get(key)}: ${masked}`);
    maskedPrompts.set(key, term.term);
  }
}

console.log(JSON.stringify({ ok: true, tests: 10, termsChecked: data.termCount, uniqueMaskedPrompts: maskedPrompts.size }));
