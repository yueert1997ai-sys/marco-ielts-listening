from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "source" / "confusions.json"
OUTPUT = ROOT / "confusions" / "data" / "confusions.json"
REQUIRED_TERM_FIELDS = ("term", "partOfSpeech", "meaning", "chunk", "sentence")


def fail(message: str) -> None:
    raise SystemExit(message)


def main() -> None:
    payload = json.loads(SOURCE.read_text(encoding="utf-8"))
    groups = payload.get("groups")
    if payload.get("version") != 1 or not isinstance(groups, list):
        fail("Confusion source must use schema version 1")
    if len(groups) != 32:
        fail(f"Expected 32 confusion groups, found {len(groups)}")

    group_ids: set[str] = set()
    terms: set[str] = set()
    normalised_groups: list[dict[str, object]] = []
    for group in groups:
        group_id = str(group.get("id", "")).strip()
        label = str(group.get("label", "")).strip()
        members = group.get("terms")
        if not group_id or group_id in group_ids:
            fail(f"Invalid or duplicate group id: {group_id!r}")
        if not label or not isinstance(members, list) or len(members) < 2:
            fail(f"Group {group_id} must have a label and at least two members")
        group_ids.add(group_id)

        normalised_terms: list[dict[str, str]] = []
        for member in members:
            cleaned = {field: str(member.get(field, "")).strip() for field in REQUIRED_TERM_FIELDS}
            if any(not value for value in cleaned.values()):
                fail(f"Group {group_id} has an incomplete member: {member}")
            term_key = cleaned["term"].lower()
            if term_key in terms:
                fail(f"Duplicate confusion term: {cleaned['term']}")
            if cleaned["sentence"].count("___") != 1:
                fail(f"Sentence for {cleaned['term']} must contain exactly one ___ placeholder")
            terms.add(term_key)
            normalised_terms.append(cleaned)

        normalised_groups.append({"id": group_id, "label": label, "terms": normalised_terms})

    if len(terms) != 84:
        fail(f"Expected 84 confusion terms, found {len(terms)}")

    runtime = {
        "schemaVersion": 1,
        "generatedFrom": "source/confusions.json",
        "groupCount": len(normalised_groups),
        "termCount": len(terms),
        "groups": normalised_groups,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(runtime, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"ok": True, "groups": len(normalised_groups), "terms": len(terms)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
