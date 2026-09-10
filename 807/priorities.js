(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.Vocab807Priority = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const VALID_TIERS = new Set(["core", "important", "extended"]);
  const TIER_RANK = { extended: 1, important: 2, core: 3 };

  function normalise(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[’‘]/g, "'")
      .replace(/\s+/g, " ");
  }

  function strongerTier(current, candidate) {
    if (!VALID_TIERS.has(current)) return candidate;
    if (!VALID_TIERS.has(candidate)) return current;
    return TIER_RANK[candidate] > TIER_RANK[current] ? candidate : current;
  }

  function parseSource(sourceText) {
    const sectionByTerm = {};
    const sectionsByTerm = {};
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
      if (!key) continue;
      if (!sectionsByTerm[key]) sectionsByTerm[key] = [];
      if (!sectionsByTerm[key].includes(section)) sectionsByTerm[key].push(section);
      if (!Object.prototype.hasOwnProperty.call(sectionByTerm, key)) {
        sectionByTerm[key] = section;
        ordered.push({ key, term: line, section });
      }
    }
    return { sectionByTerm, sectionsByTerm, ordered };
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

  function tierForSection(section, rules) {
    if (section === "__prelude__") return rules.defaultTier;
    return rules.sectionTiers?.[section] || rules.defaultTier;
  }

  function nextUnseenTier(terms, allowedTiers, tierOf, seen) {
    for (const tier of allowedTiers || []) {
      if (terms.some(term => tierOf(term) === tier && !seen(term))) return tier;
    }
    return null;
  }

  function classify(terms, sourceText, rules) {
    validateRules(rules);
    if (!Array.isArray(terms) || !terms.length) throw new Error("807 词表为空");

    const parsed = parseSource(sourceText);
    const knownKeys = new Set(terms.map(normalise));
    const tierByTerm = {};
    const sectionByTerm = {};
    const sectionsByTerm = {};

    for (const term of terms) {
      const key = normalise(term);
      const sections = parsed.sectionsByTerm[key] || [];
      sectionByTerm[key] = parsed.sectionByTerm[key] || "__missing__";
      sectionsByTerm[key] = sections.slice();
      let tier = null;
      for (const section of sections) tier = strongerTier(tier, tierForSection(section, rules));
      tierByTerm[key] = tier || rules.defaultTier;
    }

    for (const range of rules.preludeRanges || []) {
      const start = normalise(range.start);
      const end = normalise(range.end);
      let active = false;
      let closed = false;
      for (const entry of parsed.ordered) {
        if (entry.section !== "__prelude__") continue;
        if (entry.key === start) active = true;
        if (active && knownKeys.has(entry.key)) tierByTerm[entry.key] = strongerTier(tierByTerm[entry.key], range.tier);
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

    const missingFromSource = terms.filter(term => !(parsed.sectionsByTerm[normalise(term)] || []).length);
    const counts = { core: 0, important: 0, extended: 0 };
    for (const term of terms) counts[tierByTerm[normalise(term)]] += 1;

    return {
      tierByTerm,
      sectionByTerm,
      sectionsByTerm,
      counts,
      missingFromSource,
      unknownOverrides,
      tier(term) {
        return tierByTerm[normalise(term)] || rules.defaultTier;
      },
      section(term) {
        return sectionByTerm[normalise(term)] || "__missing__";
      },
      sections(term) {
        return (sectionsByTerm[normalise(term)] || []).slice();
      },
    };
  }

  return { normalise, parseSource, classify, nextUnseenTier };
});
