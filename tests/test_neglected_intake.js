const assert = require('assert');
const items = require('../data/listening.json');
const word = items.find(item => item.id === 'neglect');
assert(word.isRealError && word.modes.includes('recognition'));
assert(word.numberVariants.includes('neglected'));
assert(word.errorNote.includes('neglected') && word.errorNote.includes('被忽视的'));
assert(word.errorNote.includes('真实卡点：加工慢'));
assert(!items.some(item => item.term === 'neglected'));
console.log('neglected intake: passed');
