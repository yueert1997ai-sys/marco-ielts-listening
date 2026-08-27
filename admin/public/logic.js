export function keyFor(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function singularCandidates(term) {
  const irregular = { children: "child", feet: "foot", geese: "goose", men: "man", mice: "mouse", people: "person", teeth: "tooth", women: "woman" };
  const words = String(term || "").toLowerCase().trim().split(/\s+/);
  const word = words.pop() || "";
  const prefix = words.length ? `${words.join(" ")} ` : "";
  const result = new Set();
  if (irregular[word]) result.add(prefix + irregular[word]);
  if (word.endsWith("ies") && word.length > 3) result.add(prefix + word.slice(0, -3) + "y");
  if (word.endsWith("ves") && word.length > 3) {
    result.add(prefix + word.slice(0, -3) + "f");
    result.add(prefix + word.slice(0, -3) + "fe");
  }
  if (word.endsWith("es") && word.length > 2) {
    result.add(prefix + word.slice(0, -2));
    result.add(prefix + word.slice(0, -1));
  }
  if (word.endsWith("s") && !word.endsWith("ss") && word.length > 1) result.add(prefix + word.slice(0, -1));
  return [...result];
}

export function findCanonical(items, term) {
  const candidates = new Set([keyFor(term), ...singularCandidates(term).map(keyFor)]);
  return items.find((item) => [item.id, item.term, ...(item.numberVariants || [])].map(keyFor).some((value) => candidates.has(value))) || null;
}

export function modesFor(value) {
  if (value === "both") return ["recognition", "spelling"];
  return [value === "spelling" ? "spelling" : "recognition"];
}

export function lookupDictionary(dictionary, term) {
  if (!dictionary?.entries) return null;
  const candidates = [keyFor(term), ...singularCandidates(term).map(keyFor)];
  for (const candidate of candidates) {
    const entry = dictionary.entries[candidate] || dictionary.aliases?.[candidate] && dictionary.entries[dictionary.aliases[candidate]];
    if (entry) return entry;
  }
  return null;
}

export function filterItems(items, query, filter) {
  const needle = String(query || "").trim().toLowerCase();
  return items.filter((item) => {
    if (filter === "base" && item.sourceType === "user") return false;
    if (filter === "errors" && !item.isRealError) return false;
    if (filter === "custom" && item.sourceType !== "user") return false;
    if (filter === "spelling" && !item.modes?.includes("spelling")) return false;
    if (filter === "recognition" && !item.modes?.includes("recognition")) return false;
    if (filter === "archived" && !item.archived) return false;
    if (filter !== "archived" && item.archived) return false;
    if (!needle) return true;
    return [item.term, item.meaning, item.category, ...(item.numberVariants || [])]
      .some((value) => String(value || "").toLowerCase().includes(needle));
  });
}

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  }[character]));
}
