const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Priority = require("../807/priorities.js");

const root = path.resolve(__dirname, "..");
const terms = JSON.parse(fs.readFileSync(path.join(root, "807/data/terms.json"), "utf8")).terms;
const rules = JSON.parse(fs.readFileSync(path.join(root, "807/data/priority-rules.json"), "utf8"));
const source = fs.readFileSync(path.join(root, "source/807.txt"), "utf8");
const result = Priority.classify(terms, source, rules);

assert.strictEqual(terms.length, 1854, "807 固定词表数量变化时必须重新审计优先级");
assert.deepStrictEqual(result.missingFromSource, [], "所有去重词项都必须能回溯到 source/807.txt");
assert.deepStrictEqual(result.unknownOverrides, [], "优先级 override 不允许写不存在的词");
assert.strictEqual(result.counts.core + result.counts.important + result.counts.extended, 1854);
assert.deepStrictEqual(
  result.counts,
  { core: 551, important: 742, extended: 561 },
  "807 分级数量变化时必须重新审计规则、文档和训练主线",
);

const expected = {
  physical: "core",
  expense: "core",
  postcode: "core",
  accommodation: "core",
  reservation: "core",
  disease: "core",
  metal: "core",
  raw: "core",
  litre: "core",
  animal: "important",
  agriculture: "important",
  performance: "important",
  kaleidoscope: "extended",
  "Baked Earth": "extended",
  "one quarter": "core",
  century: "core",
  instrument: "core",
  domestic: "important",
  "food processing": "important",
};
for (const [term, tier] of Object.entries(expected)) {
  assert.strictEqual(result.tier(term), tier, `${term} 应为 ${tier}`);
}

assert(result.sections("century").includes("其他重要词汇"));
assert(result.sections("century").includes("基础词汇"));
assert(result.sections("domestic").includes("其他重要词汇"));
assert(result.sections("domestic").includes("最新补充"));

console.log(`807 priority counts: core=${result.counts.core}, important=${result.counts.important}, extended=${result.counts.extended}`);
