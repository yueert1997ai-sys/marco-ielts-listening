(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.Vocab807Priority = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const VALID_TIERS = new Set(["core", "important", "extended"]);

  function normalise(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[’‘]/g, "'")
      .replace(/\s+/g, " ");
  }

  function parseSource(sourceText) {
    const sectionByTerm = {};
    const ordered = [];
    let section = "__prelude__";
    for (const rawLine of String(sourceText || "").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      if (line.startsWith("#")) {
        section = line.slice(1).trim() || "__unlabelled__";
        continue;
      }
      const key = normalise(line);
      if (!key || Object.prototype.hasOwnProperty.call(sectionByTerm, key)) continue;
      sectionByTerm[key] = section;
      ordered.push({ key, term: line, section });
    }
    return { sectionByTerm, ordered };
  }

  function validateRules(rules) {
    if (!rules || typeof rules !== "object") throw new Error("807 优先级规则缺失");
    if (!VALID_TIERS.has(rules.defaultTier)) throw new Error("807 默认优先级无效");
    for (const tier of Object.values(rules.sectionTiers || {})) {
      if (!VALID_TIERS.has(tier)) throw new Error(`807 分类包含无效层级：${tier}`);
    }
    for (const range of rules.preludeRanges || []) {
      if (!range?.start || !range?.end || !VALID_TIERS.has(range.tier)) throw new Error("807 前置分组规则无效");
    }
  }

  function classify(terms, sourceText, rules) {
    validateRules(rules);
    if (!Array.isArray(terms) || !terms.length) throw new Error("807 词表为空");

    const parsed = parseSource(sourceText);
    const knownKeys = new Set(terms.map(normalise));
    const tierByTerm = {};
    const sectionByTerm = {};

    for (const term of terms) {
      const key = normalise(term);
      const section = parsed.sectionByTerm[key] || "__missing__";
      sectionByTerm[key] = section;
      tierByTerm[key] = section === "__prelude__"
        ? rules.defaultTier
        : (rules.sectionTiers?.[section] || rules.defaultTier);
    }

    for (const range of rules.preludeRanges || []) {
      const start = normalise(range.start);
      const end = normalise(range.end);
      let active = false;
      let closed = false;
      for (const entry of parsed.ordered) {
        if (entry.section !== "__prelude__") continue;
        if (entry.key === start) active = true;
        if (active && knownKeys.has(entry.key)) tierByTerm[entry.key] = range.tier;
        if (active && entry.key === end) {
          closed = true;
          break;
        }
      }
      if (!active || !closed) throw new Error(`807 前置分组锚点失效：${range.label || range.start}`);
    }

    const unknownOverrides = [];
    function applyOverrides(list, tier) {
      for (const rawTerm of list || []) {
        const key = normalise(rawTerm);
        if (!knownKeys.has(key)) {
          unknownOverrides.push(rawTerm);
          continue;
        }
        tierByTerm[key] = tier;
      }
    }

    applyOverrides(rules.extendedOverrides, "extended");
    applyOverrides(rules.importantOverrides, "important");
    applyOverrides(rules.coreOverrides, "core");

    const missingFromSource = terms.filter(term => !parsed.sectionByTerm[normalise(term)]);
    const counts = { core: 0, important: 0, extended: 0 };
    for (const term of terms) counts[tierByTerm[normalise(term)]] += 1;

    return {
      tierByTerm,
      sectionByTerm,
      counts,
      missingFromSource,
      unknownOverrides,
      tier(term) {
        return tierByTerm[normalise(term)] || rules.defaultTier;
      },
      section(term) {
        return sectionByTerm[normalise(term)] || "__missing__";
      },
    };
  }

  return { normalise, parseSource, classify };
});
