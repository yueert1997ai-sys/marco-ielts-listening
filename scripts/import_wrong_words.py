"""Import legacy wrong-word packages and v2 admin operations."""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "source" / "custom_words.json"
OVERRIDES = ROOT / "source" / "vocabulary_overrides.json"
BUILT_DATA = ROOT / "data" / "listening.json"
ALLOWED_ISSUE_AUTHOR = "yueert1997ai-sys"
ALLOWED_PATCH_FIELDS = {"meaning", "category", "modes", "reason", "note", "phonetic", "partOfSpeech"}
MAX_VOCABULARY_WORDS = 6


def key_for(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def modes_for(value: object) -> list[str]:
    values = value if isinstance(value, list) else re.split(r"[,+/，、\s]+", str(value or ""))
    result: set[str] = set()
    for raw in values:
        mode = str(raw).strip().lower()
        if mode in {"spelling", "听写", "拼写", "听力"}:
            result.add("spelling")
        if mode in {"recognition", "识词", "看义", "阅读", "识义"}:
            result.add("recognition")
        if mode in {"both", "两类", "全部"}:
            result.update({"spelling", "recognition"})
    return sorted(result)


def extract_payload(text: str) -> object:
    value = text.strip()
    fenced = re.search(r"```(?:json)?\s*(.*?)```", value, flags=re.S | re.I)
    if fenced:
        value = fenced.group(1).strip()
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        rows = []
        for line in value.splitlines():
            if not line.strip():
                continue
            cells = re.split(r"\s*[|｜\t]\s*", line.strip())
            if len(cells) < 3:
                raise SystemExit(f"Cannot parse line: {line}")
            rows.append({"term": cells[0], "meaning": cells[1], "mode": cells[2], "reason": " | ".join(cells[3:])})
        return rows


def singular_candidates(term: str) -> set[str]:
    irregular = {
        "children": "child", "feet": "foot", "geese": "goose", "men": "man",
        "mice": "mouse", "people": "person", "teeth": "tooth", "women": "woman",
    }
    prefix, separator, word = term.lower().rpartition(" ")
    stem_prefix = f"{prefix}{separator}" if separator else ""
    candidates: set[str] = set()
    if word in irregular:
        candidates.add(stem_prefix + irregular[word])
    if word.endswith("ies") and len(word) > 3:
        candidates.add(stem_prefix + word[:-3] + "y")
    if word.endswith("ves") and len(word) > 3:
        candidates.update({stem_prefix + word[:-3] + "f", stem_prefix + word[:-3] + "fe"})
    if word.endswith("es") and len(word) > 2:
        candidates.update({stem_prefix + word[:-2], stem_prefix + word[:-1]})
    if word.endswith("s") and not word.endswith("ss") and len(word) > 1:
        candidates.add(stem_prefix + word[:-1])
    return candidates


def clean(raw: dict, *, today: str | None = None) -> dict:
    term = str(raw.get("term") or raw.get("word") or "").strip()
    meaning = str(raw.get("meaning") or raw.get("translation") or "").strip()
    modes = modes_for(raw.get("modes") or raw.get("mode") or raw.get("type"))
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9 '&\-]*", term):
        raise SystemExit(f"Invalid English term: {term!r}")
    if len(term.split()) > MAX_VOCABULARY_WORDS:
        raise SystemExit(f"Full sentences cannot be added to the vocabulary deck: {term!r}")
    if not meaning or not modes:
        raise SystemExit(f"Missing meaning or mode: {raw}")
    item = {
        "id": key_for(term),
        "term": term,
        "meaning": meaning,
        "modes": modes,
        "reason": str(raw.get("reason") or raw.get("note") or "个人错词").strip(),
        "category": str(raw.get("category") or "我的同步错词").strip(),
        "addedAt": str(raw.get("addedAt") or today or date.today().isoformat()),
    }
    phonetic = str(raw.get("phonetic") or "").strip()
    if phonetic:
        item["phonetic"] = phonetic
    part_of_speech = str(raw.get("partOfSpeech") or raw.get("pos") or "").strip()
    if part_of_speech:
        item["partOfSpeech"] = part_of_speech
    reported_count = int(raw.get("reportedCount") or 0)
    if reported_count:
        item["reportedCount"] = reported_count
    last_reported = str(raw.get("lastReportedAt") or "").strip()
    if last_reported:
        item["lastReportedAt"] = last_reported
    variants = [str(value).strip() for value in (raw.get("numberVariants") or []) if str(value).strip()]
    if variants:
        item["numberVariants"] = sorted(set(variants), key=str.lower)
    return item


def load_json(path: Path, fallback: object) -> object:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else fallback


def known_index(base_items: list[dict], custom_items: list[dict]) -> dict[str, dict]:
    index: dict[str, dict] = {}
    for item in [*base_items, *custom_items]:
        for value in [item.get("id"), item.get("term"), *(item.get("numberVariants") or [])]:
            if value:
                index[key_for(str(value))] = item
    return index


def resolve_known(term: str, index: dict[str, dict]) -> dict | None:
    term_key = key_for(term)
    if term_key in index:
        return index[term_key]
    for candidate in singular_candidates(term):
        match = index.get(key_for(candidate))
        if match:
            return match
    return None


def merge_intake(raw: dict, merged: dict[str, dict], base_items: list[dict], today: str) -> str:
    incoming = clean(raw, today=today)
    incoming_key = key_for(incoming["term"])
    reverse_existing = next((item for item in merged.values()
                             if incoming_key in {key_for(candidate) for candidate in singular_candidates(str(item.get("term") or ""))}), None)
    if reverse_existing:
        previous = merged.pop(str(reverse_existing.get("id") or key_for(reverse_existing["term"])))
        canonical_id = incoming["id"]
        canonical_term = incoming["term"]
    else:
        index = known_index(base_items, list(merged.values()))
        known = resolve_known(incoming["term"], index)
        canonical_id = str(known.get("id")) if known else incoming["id"]
        canonical_term = str(known.get("term")) if known else incoming["term"]
        previous = merged.get(canonical_id)
    if previous:
        incoming["meaning"] = incoming["meaning"] or previous["meaning"]
        incoming["modes"] = sorted(set(previous["modes"]) | set(incoming["modes"]))
        incoming["addedAt"] = previous.get("addedAt") or incoming["addedAt"]
        incoming["reportedCount"] = int(previous.get("reportedCount") or 1) + 1
        if previous.get("phonetic") and not incoming.get("phonetic"):
            incoming["phonetic"] = previous["phonetic"]
        if previous.get("partOfSpeech") and not incoming.get("partOfSpeech"):
            incoming["partOfSpeech"] = previous["partOfSpeech"]
        variants = sorted(set(previous.get("numberVariants") or []) | set(incoming.get("numberVariants") or []), key=str.lower)
        if variants:
            incoming["numberVariants"] = variants
    else:
        incoming["reportedCount"] = 1
    incoming["id"] = canonical_id
    incoming["term"] = canonical_term
    incoming["lastReportedAt"] = today
    merged[canonical_id] = incoming
    return canonical_id


def update_override(
    overrides: dict[str, dict], target_id: str, operation: dict, known: dict[str, dict], today: str
) -> str:
    target = known.get(key_for(target_id))
    canonical_id = str(target.get("id")) if target else key_for(target_id)
    if not canonical_id:
        raise SystemExit(f"Invalid override target: {target_id!r}")
    current = dict(overrides.get(canonical_id) or {"id": canonical_id})
    if target and not current.get("snapshot"):
        current["snapshot"] = {
            key: target.get(key) for key in ("id", "term", "meaning", "category", "modes", "sourceType")
            if target.get(key) is not None
        }
    op = str(operation.get("op") or operation.get("action") or "").lower()
    if op == "archive":
        current["archived"] = True
    elif op == "restore":
        current["archived"] = False
    elif op in {"patch", "update"}:
        patch = operation.get("patch") if isinstance(operation.get("patch"), dict) else operation
        for field in ALLOWED_PATCH_FIELDS:
            if field not in patch:
                continue
            value = patch[field]
            if field == "modes":
                value = modes_for(value)
                if not value:
                    raise SystemExit("An override must keep at least one training mode")
            elif not isinstance(value, str):
                raise SystemExit(f"Invalid override field {field}: {value!r}")
            current[field] = value.strip() if isinstance(value, str) else value
    else:
        raise SystemExit(f"Unsupported vocabulary operation: {op!r}")
    current["updatedAt"] = today
    overrides[canonical_id] = current
    return canonical_id


def read_input(args: argparse.Namespace) -> str:
    if args.github_event:
        event = json.loads(Path(args.github_event).read_text(encoding="utf-8"))
        author = event.get("issue", {}).get("user", {}).get("login")
        if author != ALLOWED_ISSUE_AUTHOR:
            raise SystemExit(f"Issue author is not allowed: {author}")
        return str(event.get("issue", {}).get("body") or "")
    if args.input:
        return Path(args.input).read_text(encoding="utf-8")
    return sys.stdin.read()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", help="JSON/pipe-delimited vocabulary package")
    parser.add_argument("--github-event", help="GitHub issue event JSON")
    args = parser.parse_args()
    payload = extract_payload(read_input(args))
    today = date.today().isoformat()
    existing = load_json(OUTPUT, [])
    base_items = load_json(BUILT_DATA, [])
    existing_overrides = load_json(OVERRIDES, [])
    if not isinstance(existing, list) or not isinstance(base_items, list) or not isinstance(existing_overrides, list):
        raise SystemExit("Vocabulary sources must be JSON arrays")
    merged = {item.get("id") or key_for(item["term"]): clean(item) for item in existing}
    overrides = {str(item["id"]): dict(item) for item in existing_overrides if item.get("id")}
    imported: list[str] = []
    modified: list[str] = []

    if isinstance(payload, dict) and int(payload.get("version") or 1) >= 2:
        operations = payload.get("operations")
        if not isinstance(operations, list) or not operations:
            raise SystemExit("Vocabulary operation package has no operations")
        for operation in operations:
            if not isinstance(operation, dict):
                raise SystemExit(f"Invalid operation: {operation!r}")
            op = str(operation.get("op") or operation.get("action") or "intake").lower()
            if op in {"intake", "upsert", "mark_error"}:
                imported.append(merge_intake(operation, merged, base_items, today))
            else:
                current_index = known_index(base_items, list(merged.values()))
                target_id = str(operation.get("id") or operation.get("targetId") or "")
                modified.append(update_override(overrides, target_id, operation, current_index, today))
    else:
        entries = payload.get("entries", [payload]) if isinstance(payload, dict) else payload
        if not isinstance(entries, list) or not entries:
            raise SystemExit("Vocabulary package has no entries")
        for raw in entries:
            imported.append(merge_intake(raw, merged, base_items, today))

    values = sorted(merged.values(), key=lambda item: item["term"].lower())
    OUTPUT.write_text(json.dumps(values, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    override_values = sorted(overrides.values(), key=lambda item: item["id"])
    OVERRIDES.write_text(json.dumps(override_values, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "ok": True,
        "imported": sorted(set(imported)),
        "modified": sorted(set(modified)),
        "total": len(values),
        "overrides": len(override_values),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
