"""Build a small, auditable listening deck from the Feishu document snapshot."""

from __future__ import annotations

import html
import json
import re
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "source" / "feishu_listening.json"
CUSTOM_SOURCE = ROOT / "source" / "custom_words.json"
OVERRIDE_SOURCE = ROOT / "source" / "vocabulary_overrides.json"
OUTPUT = ROOT / "data" / "listening.json"
AUDIT = ROOT / "data" / "audit.json"

SECTION_MODES = {
    "P1 + P4 必会听写词": {"spelling"},
    "P2 + P3 必会看懂词": {"recognition"},
    "高频短语 / Chunk": {"recognition"},
    "常见第二义": {"recognition"},
}
SPELL_MARKERS = ("拼写", "复数", "词形", "声音转拼写")
RECOGNITION_MARKERS = (
    "选项", "看懂", "第二义", "短语", "组合", "加工", "地图", "基础", "语义", "陌生词", "听义"
)


def text_of(node: ET.Element) -> str:
    value = "".join(node.itertext())
    return re.sub(r"\s+", " ", html.unescape(value)).strip()


def normalise_term(value: str) -> str:
    value = value.replace("＝", "=").replace("’", "'")
    return re.sub(r"\s+", " ", value).strip()


def split_spelling_forms(term: str) -> list[str]:
    if " / " not in term:
        return [term]
    forms = [normalise_term(item) for item in term.split(" / ")]
    return [item for item in forms if re.fullmatch(r"[A-Za-z][A-Za-z '\-]*", item)] or [term]


IRREGULAR_PLURALS = {
    "children": "child",
    "feet": "foot",
    "geese": "goose",
    "men": "man",
    "mice": "mouse",
    "people": "person",
    "teeth": "tooth",
    "women": "woman",
}


def singular_candidates(term: str) -> set[str]:
    """Return conservative singular candidates for comparison only."""
    prefix, separator, word = term.lower().rpartition(" ")
    stem_prefix = f"{prefix}{separator}" if separator else ""
    candidates: set[str] = set()
    if word in IRREGULAR_PLURALS:
        candidates.add(stem_prefix + IRREGULAR_PLURALS[word])
    if word.endswith("ies") and len(word) > 3:
        candidates.add(stem_prefix + word[:-3] + "y")
    if word.endswith("ves") and len(word) > 3:
        candidates.add(stem_prefix + word[:-3] + "f")
        candidates.add(stem_prefix + word[:-3] + "fe")
    if word.endswith("es") and len(word) > 2:
        candidates.add(stem_prefix + word[:-2])
        candidates.add(stem_prefix + word[:-1])
    if word.endswith("s") and not word.endswith("ss") and len(word) > 1:
        candidates.add(stem_prefix + word[:-1])
    return candidates


def number_pair(first: str, second: str) -> tuple[str, str] | None:
    """Return (singular, plural) when two forms only differ by number."""
    first_normalised = first.lower()
    second_normalised = second.lower()
    if first_normalised in singular_candidates(second):
        return first, second
    if second_normalised in singular_candidates(first):
        return second, first
    return None


def training_forms(term: str, mode: str) -> list[tuple[str, list[str]]]:
    """Collapse number variants while preserving true spelling alternatives."""
    forms = split_spelling_forms(term)
    if len(forms) == 2:
        pair = number_pair(forms[0], forms[1])
        if pair:
            singular, plural = pair
            return [(singular, [plural])]
    if mode == "spelling":
        return [(form, []) for form in forms]
    return [(term, [])]


def key_for(term: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", term.lower()).strip("-")


def find_number_canonical(merged: dict[str, dict], term: str) -> dict | None:
    term_key = key_for(term)
    return next((candidate for candidate in merged.values()
                 if term_key in {key_for(variant) for variant in candidate.get("numberVariants", [])}), None)


def parse_rows(content: str) -> list[dict]:
    root = ET.fromstring(f"<root>{content}</root>")
    rows: list[dict] = []
    section = ""
    category = ""
    for node in root:
        if node.tag == "h1":
            section = text_of(node)
            category = ""
            continue
        if node.tag == "h2":
            category = text_of(node)
            continue
        if node.tag != "table" or section not in {*SECTION_MODES, "我的真实错词"}:
            continue
        tbody = node.find("tbody")
        if tbody is None:
            continue
        for tr in tbody.findall("tr"):
            cells = [text_of(td) for td in tr.findall("td")]
            if len(cells) < 3 or not cells[0] or not cells[1]:
                continue
            rows.append({
                "term": normalise_term(cells[0]),
                "meaning": cells[1],
                "note": cells[2],
                "section": section,
                "category": category or ("我的真实错词" if section == "我的真实错词" else section),
            })
    return rows


def infer_error_modes(row: dict, existing: set[str]) -> set[str]:
    note = row["note"]
    modes = set(existing)
    if any(marker in note for marker in SPELL_MARKERS):
        modes.add("spelling")
    if any(marker in note for marker in RECOGNITION_MARKERS):
        modes.add("recognition")
    return modes or {"recognition"}


def build(
    rows: list[dict], revision: int, custom_rows: list[dict] | None = None,
    overrides: list[dict] | None = None,
) -> tuple[list[dict], dict]:
    merged: dict[str, dict] = {}
    real_errors: set[str] = set()
    real_error_rows = 0

    # Main sections establish the training purpose.
    for row in rows:
        if row["section"] == "我的真实错词":
            continue
        for mode in SECTION_MODES.get(row["section"], set()):
            for term, number_variants in training_forms(row["term"], mode):
                canonical = find_number_canonical(merged, term)
                if canonical:
                    number_variants = [*number_variants, term]
                    term = canonical["term"]
                key = key_for(term)
                if not key:
                    continue
                item = merged.setdefault(key, {
                    "id": key,
                    "term": term,
                    "meaning": row["meaning"],
                    "note": row["note"],
                    "category": row["category"],
                    "sections": [],
                    "modes": [],
                    "isRealError": False,
                    "acceptedAnswers": [term],
                    "numberVariants": [],
                })
                for variant in number_variants:
                    if variant not in item["numberVariants"]:
                        item["numberVariants"].append(variant)
                if mode not in item["modes"]:
                    item["modes"].append(mode)
                if row["section"] not in item["sections"]:
                    item["sections"].append(row["section"])

    # Real errors are never discarded and inherit their main-section modes.
    for row in rows:
        if row["section"] != "我的真实错词":
            continue
        real_error_rows += 1
        spelling_entries = training_forms(row["term"], "spelling")
        spelling_forms = [term for term, _ in spelling_entries]
        inherited = set()
        for form in spelling_forms:
            inherited.update(merged.get(key_for(form), {}).get("modes", []))
        modes = infer_error_modes(row, inherited)
        for mode in sorted(modes):
            for term, number_variants in training_forms(row["term"], mode):
                canonical = find_number_canonical(merged, term)
                if canonical:
                    number_variants = [*number_variants, term]
                    term = canonical["term"]
                key = key_for(term)
                if not key:
                    continue
                item = merged.setdefault(key, {
                    "id": key,
                    "term": term,
                    "meaning": row["meaning"],
                    "note": row["note"],
                    "category": "我的真实错词",
                    "sections": [],
                    "modes": [],
                    "isRealError": True,
                    "acceptedAnswers": [term],
                    "numberVariants": [],
                })
                for variant in number_variants:
                    if variant not in item["numberVariants"]:
                        item["numberVariants"].append(variant)
                item["isRealError"] = True
                item["errorNote"] = row["note"]
                item["meaning"] = row["meaning"]
                if mode not in item["modes"]:
                    item["modes"].append(mode)
                if "我的真实错词" not in item["sections"]:
                    item["sections"].append("我的真实错词")
                real_errors.add(key)

    # Personal additions are stored separately from the Feishu snapshot so
    # Codex, ChatGPT issue intake, and future source refreshes can share them.
    for row in custom_rows or []:
        term = normalise_term(str(row.get("term", "")))
        meaning = str(row.get("meaning", "")).strip()
        modes = sorted(set(row.get("modes") or []))
        if not term or not meaning or not modes or any(mode not in {"spelling", "recognition"} for mode in modes):
            raise SystemExit(f"Invalid custom vocabulary entry: {row}")
        key = key_for(term)
        if not key:
            raise SystemExit(f"Invalid custom vocabulary term: {term}")
        canonical = find_number_canonical(merged, term)
        if canonical:
            key = canonical["id"]
            number_variants = [term]
            term = canonical["term"]
        else:
            number_variants = []
        item = merged.setdefault(key, {
            "id": key,
            "term": term,
            "meaning": meaning,
            "note": row.get("reason") or "个人错词",
            "category": row.get("category") or "我的同步错词",
            "sections": [],
            "modes": [],
            "isRealError": True,
            "acceptedAnswers": [term],
            "numberVariants": [],
        })
        for variant in number_variants:
            if variant != item["term"] and variant not in item["numberVariants"]:
                item["numberVariants"].append(variant)
        item["meaning"] = meaning
        item["isRealError"] = True
        item["errorNote"] = row.get("reason") or "个人错词"
        item["userAddedAt"] = row.get("addedAt")
        item["sourceType"] = "user"
        if row.get("phonetic"):
            item["phonetic"] = row["phonetic"]
        if row.get("reportedCount"):
            item["reportedCount"] = int(row["reportedCount"])
        if row.get("lastReportedAt"):
            item["lastReportedAt"] = row["lastReportedAt"]
        for mode in modes:
            if mode not in item["modes"]:
                item["modes"].append(mode)
        if "我的同步错词" not in item["sections"]:
            item["sections"].append("我的同步错词")
        real_errors.add(key)

    archived_entries = 0
    applied_overrides = 0
    for override in overrides or []:
        target_id = str(override.get("id") or "")
        if not target_id:
            raise SystemExit(f"Invalid vocabulary override: {override}")
        item = merged.get(target_id)
        if override.get("archived"):
            if item:
                merged.pop(target_id)
                archived_entries += 1
            continue
        if not item:
            continue
        for field in ("meaning", "category", "phonetic"):
            if field in override:
                value = str(override[field]).strip()
                if not value and field != "phonetic":
                    raise SystemExit(f"Override cannot clear {field}: {target_id}")
                if value:
                    item[field] = value
                elif field in item:
                    item.pop(field)
        note = override.get("reason", override.get("note"))
        if note is not None:
            item["note"] = str(note).strip()
            if item.get("isRealError"):
                item["errorNote"] = item["note"]
        if "modes" in override:
            modes = sorted(set(override.get("modes") or []))
            if not modes or any(mode not in {"spelling", "recognition"} for mode in modes):
                raise SystemExit(f"Invalid override modes: {target_id}")
            item["modes"] = modes
        item["adminUpdatedAt"] = override.get("updatedAt")
        applied_overrides += 1

    items = sorted(merged.values(), key=lambda item: (not item["isRealError"], item["term"].lower()))
    for item in items:
        item["modes"].sort()
        item["sourceRevision"] = revision
        item["audioText"] = item["term"]
        item["audioPath"] = f"audio/{item['id']}.mp3"
        if item["numberVariants"]:
            item["numberVariants"].sort(key=str.lower)
        else:
            item.pop("numberVariants")

    activities = Counter(mode for item in items for mode in item["modes"])
    audit = {
        "sourceRevision": revision,
        "sourceRows": len(rows),
        "uniqueEntries": len(items),
        "realErrorRows": real_error_rows,
        "realErrorEntries": len(real_errors),
        "customEntries": len(custom_rows or []),
        "overrideEntries": applied_overrides,
        "archivedEntries": archived_entries,
        "activities": dict(sorted(activities.items())),
        "sectionRows": dict(sorted(Counter(row["section"] for row in rows).items())),
        "untraceableEntries": 0,
        "duplicateIds": len(items) - len({item["id"] for item in items}),
        "numberVariantAliases": sum(len(item.get("numberVariants", [])) for item in items),
    }
    return items, audit


def validate(items: list[dict], audit: dict) -> None:
    if audit["realErrorRows"] < 46:
        raise SystemExit(f"Expected at least 46 real-error source rows, found {audit['realErrorRows']}")
    if audit["duplicateIds"]:
        raise SystemExit("Duplicate item IDs found")
    ids = {item["id"] for item in items}
    alias_ids = {key_for(alias) for item in items for alias in item.get("numberVariants", [])}
    if ids & alias_ids:
        raise SystemExit(f"Number variant was kept as a separate challenge: {sorted(ids & alias_ids)}")
    if audit["activities"].get("spelling", 0) < 200:
        raise SystemExit("Spelling deck is unexpectedly small")
    if audit["activities"].get("recognition", 0) < 200:
        raise SystemExit("Recognition deck is unexpectedly small")
    for item in items:
        if not item["term"] or not item["meaning"] or not item["modes"]:
            raise SystemExit(f"Incomplete entry: {item}")
        if "spelling" in item["modes"]:
            if item["acceptedAnswers"] != [item["term"]]:
                raise SystemExit(f"Spelling answer was loosened: {item['term']}")
            if "/" in item["term"]:
                raise SystemExit(f"Unsplit spelling form: {item['term']}")


def main() -> None:
    payload = json.loads(SOURCE.read_text(encoding="utf-8"))
    document = payload["data"]["document"]
    revision = int(document["revision_id"])
    rows = parse_rows(document["content"])
    custom_rows = json.loads(CUSTOM_SOURCE.read_text(encoding="utf-8")) if CUSTOM_SOURCE.exists() else []
    overrides = json.loads(OVERRIDE_SOURCE.read_text(encoding="utf-8")) if OVERRIDE_SOURCE.exists() else []
    items, audit = build(rows, revision, custom_rows, overrides)
    validate(items, audit)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
    AUDIT.write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"ok": True, **audit}, ensure_ascii=False))


if __name__ == "__main__":
    main()
