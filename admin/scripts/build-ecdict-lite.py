"""Build a compact browser lookup file from the MIT-licensed ECDICT CSV."""

from __future__ import annotations

import argparse
import csv
import gzip
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT = ROOT / "admin" / "public" / "data" / "ecdict-lite.json"
PROJECT_DATA = ROOT / "data" / "listening.json"
MAX_COMPRESSED_BYTES = 20 * 1024 * 1024


def key_for(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def integer(value: str, fallback: int = 10**9) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def compact_text(value: str, limit: int) -> str:
    lines = [re.sub(r"\s+", " ", line).strip() for line in str(value or "").splitlines()]
    text = "；".join(line for line in lines if line)
    return text[:limit].rstrip("；")


def exchange_aliases(value: str) -> list[str]:
    aliases = []
    for part in str(value or "").split("/"):
        _, separator, word = part.partition(":")
        if separator and word:
            aliases.extend(item.strip() for item in word.split(",") if item.strip())
    return aliases


def selection_score(row: dict, project_terms: set[str]) -> int | None:
    word_key = key_for(row.get("word", ""))
    if word_key in project_terms:
        return 0
    tags = set(str(row.get("tag") or "").lower().split())
    if "ielts" in tags:
        return 1
    if tags & {"cet4", "cet6", "gk", "zk", "gre", "toefl"}:
        return 2
    if integer(row.get("oxford", "0"), 0) > 0 or integer(row.get("collins", "0"), 0) >= 2:
        return 3
    frequency = min(integer(row.get("bnc", "")), integer(row.get("frq", "")))
    if frequency <= 30000:
        return 4
    return None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="Path to ECDICT ecdict.csv")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--max-entries", type=int, default=60000)
    args = parser.parse_args()

    project_items = json.loads(PROJECT_DATA.read_text(encoding="utf-8"))
    project_terms = {
        key_for(value)
        for item in project_items
        for value in [item.get("term", ""), *(item.get("numberVariants") or [])]
        if value
    }
    candidates: list[tuple[int, int, dict]] = []
    with Path(args.input).open(encoding="utf-8", errors="replace", newline="") as source:
        for index, row in enumerate(csv.DictReader(source)):
            word = str(row.get("word") or "").strip()
            translation = compact_text(row.get("translation", ""), 220)
            if not word or not translation or len(word) > 70 or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9 '&.\-]*", word):
                continue
            score = selection_score(row, project_terms)
            if score is None:
                continue
            frequency = min(integer(row.get("bnc", "")), integer(row.get("frq", "")))
            candidates.append((score, frequency, {
                "word": word,
                "translation": translation,
                "phonetic": compact_text(row.get("phonetic", ""), 80),
                "tags": compact_text(row.get("tag", ""), 80),
                "aliases": exchange_aliases(row.get("exchange", "")),
            }))

    candidates.sort(key=lambda item: (item[0], item[1], item[2]["word"].lower()))
    selected = candidates[: args.max_entries]
    entries: dict[str, dict] = {}
    aliases: dict[str, str] = {}
    for _, _, item in selected:
        entry_key = key_for(item["word"])
        if not entry_key or entry_key in entries:
            continue
        entry = {key: value for key, value in item.items() if key != "aliases" and value}
        entries[entry_key] = entry
        for alias in item["aliases"]:
            alias_key = key_for(alias)
            if alias_key and alias_key != entry_key:
                aliases.setdefault(alias_key, entry_key)

    missing_project = sorted(project_terms - entries.keys() - aliases.keys())
    if missing_project:
        print(json.dumps({"warning": "project terms absent from ECDICT", "count": len(missing_project), "sample": missing_project[:20]}))

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps({
        "version": 1,
        "source": "ECDICT",
        "license": "MIT",
        "entries": entries,
        "aliases": aliases,
    }, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    compressed_size = len(gzip.compress(payload, compresslevel=9))
    if compressed_size > MAX_COMPRESSED_BYTES:
        raise SystemExit(f"ECDICT lite exceeds 20MB compressed: {compressed_size}")
    output.write_bytes(payload)
    print(json.dumps({
        "ok": True, "entries": len(entries), "aliases": len(aliases),
        "bytes": len(payload), "gzipBytes": compressed_size,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
