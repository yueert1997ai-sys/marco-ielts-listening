from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = json.loads((ROOT / "source" / "confusions.json").read_text(encoding="utf-8"))
RUNTIME = json.loads((ROOT / "confusions" / "data" / "confusions.json").read_text(encoding="utf-8"))


def fail(message: str) -> None:
    raise SystemExit(message)


def main() -> None:
    groups = RUNTIME.get("groups", [])
    terms = [term for group in groups for term in group.get("terms", [])]
    if len(groups) != 32 or len(terms) != 84:
        fail("Confusions runtime must contain exactly 32 groups and 84 terms")
    if RUNTIME.get("generatedFrom") != "source/confusions.json":
        fail("Confusions runtime is missing source traceability")
    if RUNTIME.get("groups") != SOURCE.get("groups"):
        fail("Confusions runtime is out of sync with its source")
    if any(len(group.get("terms", [])) < 2 for group in groups):
        fail("Every confusion group must contain at least two members")
    if any(term.get("sentence", "").count("___") != 1 for term in terms):
        fail("Every confusion term must have one cloze sentence")

    version = json.loads((ROOT / "confusions" / "version.json").read_text(encoding="utf-8")).get("version")
    if version != "v1.0.1":
        fail("Unexpected Confusions version")
    for filename in ("index.html", "style.css", "logic.js", "app.js", "sw.js"):
        if not (ROOT / "confusions" / filename).exists():
            fail(f"Missing Confusions shell file: {filename}")
    index = (ROOT / "confusions" / "index.html").read_text(encoding="utf-8")
    app = (ROOT / "confusions" / "app.js").read_text(encoding="utf-8")
    logic = (ROOT / "confusions" / "logic.js").read_text(encoding="utf-8")
    child_sw = (ROOT / "confusions" / "sw.js").read_text(encoding="utf-8")
    root_sw = (ROOT / "sw.js").read_text(encoding="utf-8")
    if any(version not in text for text in (index, logic, child_sw)):
        fail("Confusions version is inconsistent across its shell")
    if "marcoIeltsListening.v1" in app or "marcoIeltsListening.v1" in logic:
        fail("Confusions code must not reference Listening localStorage")
    if 'marcoIeltsConfusions.v1' not in logic:
        fail("Confusions storage key is missing")
    if 'CACHE_PREFIX = "ielts-confusions-"' not in child_sw or "ielts-listening-" in child_sw:
        fail("Confusions Service Worker cache scope is not isolated")
    if 'CACHE_PREFIX = "ielts-listening-"' not in root_sw or 'pathname.includes("/confusions/")' not in root_sw:
        fail("Listening Service Worker does not isolate Confusions requests")
    if 'href="./confusions/"' not in (ROOT / "app.js").read_text(encoding="utf-8"):
        fail("Listening homepage is missing the Confusions entry")

    listening = json.loads((ROOT / "data" / "listening.json").read_text(encoding="utf-8"))
    if not isinstance(listening, list) or not listening:
        fail("Listening runtime must remain a non-empty card list")
    if any(not item.get("id") or not item.get("term") or not item.get("modes") for item in listening):
        fail("Listening runtime contains an invalid card")
    if any(set(item) & {"chunk", "sentence", "confusionGroupId"} for item in listening):
        fail("Confusions-only fields leaked into Listening runtime")
    print(json.dumps({"ok": True, "version": version, "groups": len(groups), "terms": len(terms), "listeningCards": len(listening)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
