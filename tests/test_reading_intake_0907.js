const assert = require('assert');
const logic = require('../app.js');
const items = require('../data/listening.json');
const entries = require('../source/intakes/2026-09-07-reading-errors.json').entries;
const archive = logic.seedErrorArchive({}, items, {}, '2026-09-07');
for (const [index, entry] of entries.entries()) {
  const matches = items.filter(item => item.term === entry.term);
  assert.equal(matches.length, 1, `${entry.term}: duplicate/missing`);
  assert(matches[0].isRealError);
  assert(matches[0].modes.includes('recognition'));
  assert.equal(archive[matches[0].id].priority, index < 7 ? 'S' : 'A', entry.term);
}
assert(!items.some(item => item.term === 'assessed'));
assert(items.find(item => item.term === 'condition').meaning.includes('疾病'));
console.log(JSON.stringify({ok:true,words:11,S:7,A:4,total:items.length}));
