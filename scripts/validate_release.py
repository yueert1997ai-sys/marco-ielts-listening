"""Fail the release when source traceability, spelling strictness, or audio is incomplete."""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ITEMS = json.loads((ROOT / "data" / "listening.json").read_text(encoding="utf-8"))
AUDIT = json.loads((ROOT / "data" / "audit.json").read_text(encoding="utf-8"))
MANIFEST = json.loads((ROOT / "audio" / "manifest.json").read_text(encoding="utf-8"))

REQUIRED_ERRORS = {
    "litter", "meal", "midday", "beginner", "bilingual", "waitress", "reference", "mild",
    "string", "wax", "lead", "prescription", "pharmacy", "relief", "disbelief", "gratitude",
    "homesickness", "spectator", "excessive sweating", "fellow students", "neglecting",
    "reorganising shifts", "equipment", "make their own", "mass-produced", "purpose", "bend",
    "entrance", "beyond", "alongside", "carpet", "electrician", "oven", "curtain", "vacuum",
    "thorough", "retention", "morale", "resentful", "preferential",
    "get to grips with", "stalled", "colossal", "interest rates", "bolder move", "intrinsic",
}


def fail(message: str) -> None:
    raise SystemExit(message)


def main() -> None:
    if AUDIT.get("sourceRows", 0) < 749 or AUDIT.get("realErrorRows", 0) < 46:
        fail(f"Unexpected Feishu source counts: {AUDIT}")
    if AUDIT.get("untraceableEntries") or AUDIT.get("duplicateIds"):
        fail("Untraceable or duplicate vocabulary entries found")

    ids = {item["id"] for item in ITEMS}
    errors = {item["term"] for item in ITEMS if item.get("isRealError")}
    missing_errors = sorted(REQUIRED_ERRORS - errors)
    if missing_errors:
        fail(f"Missing real-error vocabulary: {missing_errors}")
    if len(ids) != len(ITEMS):
        fail("Duplicate item IDs found")
    aliases = {alias.lower() for item in ITEMS for alias in item.get("numberVariants", [])}
    duplicate_number_forms = sorted(item["term"] for item in ITEMS if item["term"].lower() in aliases)
    if duplicate_number_forms:
        fail(f"Singular/plural forms remain separate challenges: {duplicate_number_forms}")

    spelling = [item for item in ITEMS if "spelling" in item["modes"]]
    recognition = [item for item in ITEMS if "recognition" in item["modes"]]
    if len(spelling) != AUDIT["activities"]["spelling"] or len(recognition) != AUDIT["activities"]["recognition"]:
        fail("Activity counts do not match the audit")

    missing_audio = []
    for item in ITEMS:
        if item["acceptedAnswers"] != [item["term"]]:
            fail(f"Loose spelling answer detected: {item['term']}")
        path = ROOT / item["audioPath"]
        if not path.exists() or path.stat().st_size < 500:
            missing_audio.append(item["term"])
            continue
        header = path.read_bytes()[:3]
        if header != b"ID3" and not (header and header[0] == 0xFF):
            fail(f"Invalid MP3 header: {path.name}")
    if missing_audio:
        fail(f"Missing audio for {len(missing_audio)} items: {missing_audio[:10]}")
    if MANIFEST.get("count") != len(ITEMS) or len(MANIFEST.get("files", [])) != len(ITEMS):
        fail("Audio manifest is incomplete")

    for required in ("index.html", "app.js", "style.css", "sw.js", "manifest.webmanifest", "icon.svg"):
        if not (ROOT / required).exists():
            fail(f"Missing app shell file: {required}")

    print(json.dumps({
        "ok": True,
        "entries": len(ITEMS),
        "spelling": len(spelling),
        "recognition": len(recognition),
        "realErrorRows": AUDIT["realErrorRows"],
        "realErrorEntries": AUDIT["realErrorEntries"],
        "audioFiles": MANIFEST["count"],
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
