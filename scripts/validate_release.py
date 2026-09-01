"""Fail the release when source traceability, spelling strictness, or audio is incomplete."""

from __future__ import annotations

import json
import re
import struct
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ITEMS = json.loads((ROOT / "data" / "listening.json").read_text(encoding="utf-8"))
DIRECTIONS = json.loads((ROOT / "data" / "directions.json").read_text(encoding="utf-8"))
AUDIT = json.loads((ROOT / "data" / "audit.json").read_text(encoding="utf-8"))
OVERRIDES = json.loads((ROOT / "source" / "vocabulary_overrides.json").read_text(encoding="utf-8"))
MANIFEST = json.loads((ROOT / "audio" / "manifest.json").read_text(encoding="utf-8"))
DIRECTION_MANIFEST = json.loads((ROOT / "audio" / "directions-manifest.json").read_text(encoding="utf-8"))

REQUIRED_ERRORS = {
    "litter", "meal", "midday", "beginner", "bilingual", "waitress", "reference", "mild",
    "string", "wax", "lead", "prescription", "pharmacy", "relief", "disbelief", "gratitude",
    "homesickness", "spectator", "excessive sweating", "fellow students", "neglect",
    "reorganising shifts", "equipment", "make their own", "mass-produced", "purpose", "bend",
    "entrance", "beyond", "alongside", "carpet", "electrician", "oven", "curtain", "vacuum",
    "thorough", "retention", "morale", "resentful", "preferential",
    "get to grips with", "stalled", "colossal", "interest rates", "bolder move", "intrinsic",
}


def fail(message: str) -> None:
    raise SystemExit(message)


def key_for(value: str) -> str:
    return "-".join(filter(None, re.split(r"[^a-z0-9]+", value.lower())))


def png_size(path: Path) -> tuple[int, int]:
    header = path.read_bytes()[:24]
    if header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
        fail(f"Invalid PNG icon: {path.name}")
    return struct.unpack(">II", header[16:24])


def main() -> None:
    if AUDIT.get("sourceRows", 0) < 749 or AUDIT.get("realErrorRows", 0) < 46:
        fail(f"Unexpected Feishu source counts: {AUDIT}")
    if AUDIT.get("untraceableEntries") or AUDIT.get("duplicateIds"):
        fail("Untraceable or duplicate vocabulary entries found")

    ids = {item["id"] for item in ITEMS}
    errors = {item["term"] for item in ITEMS if item.get("isRealError")}
    archived = {item["id"] for item in OVERRIDES if item.get("archived")}
    missing_errors = sorted(term for term in REQUIRED_ERRORS if term not in errors and key_for(term) not in archived)
    if missing_errors:
        fail(f"Missing real-error vocabulary: {missing_errors}")
    if len(ids) != len(ITEMS):
        fail("Duplicate item IDs found")
    aliases = {alias.lower() for item in ITEMS for alias in item.get("numberVariants", [])}
    duplicate_number_forms = sorted(item["term"] for item in ITEMS if item["term"].lower() in aliases)
    if duplicate_number_forms:
        fail(f"Inflected forms remain separate challenges: {duplicate_number_forms}")
    prohibited_inflections = {"disposed", "erected", "neglecting", "resurfaced", "standardised", "tethered"}
    remaining_inflections = sorted(prohibited_inflections & ids)
    if remaining_inflections:
        fail(f"Rule inflections remain separate challenges: {remaining_inflections}")

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

    expected_directions = {
        "north", "northeast", "east", "southeast",
        "south", "southwest", "west", "northwest",
    }
    if {item.get("id") for item in DIRECTIONS} != expected_directions:
        fail("Direction data must contain the eight compass directions")
    expected_positions = {(row, column) for row in range(3) for column in range(3)} - {(1, 1)}
    if {(item.get("row"), item.get("column")) for item in DIRECTIONS} != expected_positions:
        fail("Direction coordinates must fill the eight cells around the centre")
    missing_direction_audio = []
    for item in DIRECTIONS:
        path = ROOT / item["audioPath"]
        if not path.exists() or path.stat().st_size < 500:
            missing_direction_audio.append(item["term"])
            continue
        header = path.read_bytes()[:3]
        if header != b"ID3" and not (header and header[0] == 0xFF):
            fail(f"Invalid direction MP3 header: {path.name}")
    if missing_direction_audio:
        fail(f"Missing direction audio: {missing_direction_audio}")
    if DIRECTION_MANIFEST.get("count") != len(DIRECTIONS) or len(DIRECTION_MANIFEST.get("files", [])) != len(DIRECTIONS):
        fail("Direction audio manifest is incomplete")

    for required in (
        "index.html", "app.js", "style.css", "sw.js", "manifest.webmanifest", "version.json", "icon.svg",
        "vendor/phosphor/phosphor-regular.css", "vendor/phosphor/Phosphor.woff2", "vendor/phosphor/LICENSE",
        "apple-touch-icon.png", "icon-192.png", "icon-512.png",
    ):
        if not (ROOT / required).exists():
            fail(f"Missing app shell file: {required}")

    version = json.loads((ROOT / "version.json").read_text(encoding="utf-8")).get("version")
    if not version or any(version not in (ROOT / filename).read_text(encoding="utf-8")
                          for filename in ("index.html", "app.js", "sw.js")):
        fail("Visible app version is inconsistent across the release")

    styles = (ROOT / "style.css").read_text(encoding="utf-8").lower()
    index = (ROOT / "index.html").read_text(encoding="utf-8").lower()
    service_worker = (ROOT / "sw.js").read_text(encoding="utf-8")
    web_manifest = json.loads((ROOT / "manifest.webmanifest").read_text(encoding="utf-8"))
    required_tokens = ("#f2f2f7", "#ffffff", "#6c6c70", "#007aff", "#34c759", "#ff3b30")
    if any(token not in styles for token in required_tokens) or "color-scheme: dark" in styles:
        fail("The iOS light theme token contract is incomplete")
    if "vendor/phosphor/phosphor-regular.css" not in index or "vendor/phosphor/phosphor-regular.css" not in service_worker:
        fail("The offline Phosphor icon stylesheet is not wired into the app shell and cache")
    if web_manifest.get("theme_color", "").lower() != "#f2f2f7" or web_manifest.get("background_color", "").lower() != "#f2f2f7":
        fail("The PWA manifest must use the light system grouped background")
    if 'CACHE = "ielts-listening-v33"' not in service_worker:
        fail("Unexpected Service Worker cache version")
    expected_icon_sizes = {
        "apple-touch-icon.png": (180, 180),
        "icon-192.png": (192, 192),
        "icon-512.png": (512, 512),
    }
    for filename, expected_size in expected_icon_sizes.items():
        if png_size(ROOT / filename) != expected_size:
            fail(f"Unexpected PWA icon dimensions: {filename}")

    print(json.dumps({
        "ok": True,
        "entries": len(ITEMS),
        "spelling": len(spelling),
        "recognition": len(recognition),
        "realErrorRows": AUDIT["realErrorRows"],
        "realErrorEntries": AUDIT["realErrorEntries"],
        "audioFiles": MANIFEST["count"],
        "directionAudioFiles": DIRECTION_MANIFEST["count"],
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
