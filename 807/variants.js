/* Reviewed equivalences only: no fuzzy matching, plural or tense stripping. */
(function (root) {
  const groups = [
    ["colour", "color"], ["colours", "colors"], ["centre", "center"], ["centres", "centers"],
    ["theatre", "theater"], ["theatres", "theaters"], ["metre", "meter"], ["metres", "meters"],
    ["litre", "liter"], ["litres", "liters"], ["travelling", "traveling"], ["travelled", "traveled"],
    ["traveller", "traveler"], ["organisation", "organization"], ["organise", "organize"],
    ["programme", "program"], ["catalogue", "catalog"], ["neighbour", "neighbor"],
    ["favour", "favor"], ["favourite", "favorite"], ["labour", "labor"], ["behaviour", "behavior"],
    ["jewellery", "jewelry"], ["grey", "gray"], ["aeroplane", "airplane"]
  ];
  const homophones = [["principal", "principle"], ["weather", "whether"], ["stationary", "stationery"], ["flour", "flower"], ["fare", "fair"], ["sight", "site"], ["sale", "sail"], ["week", "weak"], ["weight", "wait"], ["hear", "here"], ["peace", "piece"], ["right", "write"], ["sea", "see"], ["whole", "hole"], ["mail", "male"], ["meat", "meet"]];
  const normalize = text => String(text || "").trim().toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ");
  function check(expected, typed) {
    const a = normalize(expected), b = normalize(typed);
    if (a === b) return { correct: true, reason: "" };
    for (const [entries, reason] of [[groups, "英美拼写变体"], [homophones, "孤立听词无法区分的同音词"]]) {
      if (entries.some(group => group.includes(a) && group.includes(b))) return { correct: true, reason };
    }
    return { correct: false, reason: "" };
  }
  const api = { check, groups, homophones };
  if (typeof module !== "undefined") module.exports = api;
  root.DictationVariants = api;
})(typeof window === "undefined" ? globalThis : window);
