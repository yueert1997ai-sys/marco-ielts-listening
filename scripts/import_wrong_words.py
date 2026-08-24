"""Import a GPT/Codex vocabulary package into the shared custom word source."""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "source" / "custom_words.json"
ALLOWED_ISSUE_AUTHOR = "yueert1997ai-sys"


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


def clean(raw: dict) -> dict:
    term = str(raw.get("term") or raw.get("word") or "").strip()
    meaning = str(raw.get("meaning") or raw.get("translation") or "").strip()
    modes = modes_for(raw.get("modes") or raw.get("mode") or raw.get("type"))
    if not re.fullmatch(r"[A-Za-z][A-Za-z '\-]*", term):
        raise SystemExit(f"Invalid English term: {term!r}")
    if not meaning or not modes:
        raise SystemExit(f"Missing meaning or mode: {raw}")
    return {
        "id": key_for(term),
        "term": term,
        "meaning": meaning,
        "modes": modes,
        "reason": str(raw.get("reason") or raw.get("note") or "个人错词").strip(),
        "category": str(raw.get("category") or "我的同步错词").strip(),
        "addedAt": str(raw.get("addedAt") or date.today().isoformat()),
    }


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
    if isinstance(payload, dict):
        payload = payload.get("entries", [payload])
    if not isinstance(payload, list) or not payload:
        raise SystemExit("Vocabulary package has no entries")

    existing = json.loads(OUTPUT.read_text(encoding="utf-8")) if OUTPUT.exists() else []
    merged = {item.get("id") or key_for(item["term"]): clean(item) for item in existing}
    imported = []
    for raw in payload:
        item = clean(raw)
        previous = merged.get(item["id"])
        if previous:
            item["modes"] = sorted(set(previous["modes"]) | set(item["modes"]))
        merged[item["id"]] = item
        imported.append(item["id"])

    values = sorted(merged.values(), key=lambda item: item["term"].lower())
    OUTPUT.write_text(json.dumps(values, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"ok": True, "imported": imported, "total": len(values)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
