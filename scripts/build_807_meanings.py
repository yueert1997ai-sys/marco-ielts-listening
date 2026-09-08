"""Build the offline 807 glossary without changing dictation terms or progress IDs."""
import csv
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MARKER = re.compile(r"(?:^|[\n；])\s*(abbr|adj|adv|prep|conj|pron|num|art|aux|int|vt|vi|pl|n|v|a|ad)\.", re.I)
LABEL = {"a": "adj", "ad": "adv", "pl": "n. pl"}


def build():
    terms = json.loads((ROOT / "807/data/terms.json").read_text(encoding="utf-8"))["terms"]
    dictionary = json.loads((ROOT / "admin/public/data/ecdict-lite.json").read_text(encoding="utf-8"))["entries"]
    with (ROOT / "source/807_meaning_overrides.tsv").open(encoding="utf-8", newline="") as stream:
        rows = list(csv.DictReader(stream, delimiter="\t"))
    overrides = {row["term"]: row for row in rows}
    assert len(overrides) == len(rows), "Duplicate overrides"
    assert set(overrides) <= set(terms), "Override not in 807 snapshot"
    entries = {}
    for term in terms:
        if term in overrides:
            row = overrides[term]
            entry = {"pos": row["pos"], "meaning": row["meaning"], "source": "project override"}
        else:
            translation = dictionary.get(term, {}).get("translation", "").replace("\\n", "\n").strip()
            labels = list(dict.fromkeys(LABEL.get(pos.lower(), pos.lower()) + "." for pos in MARKER.findall(translation)))
            entry = {"pos": " / ".join(labels), "meaning": translation, "source": "ECDICT (MIT)"}
        if not entry["pos"] or not re.search(r"[\u3400-\u9fff]", entry["meaning"]):
            raise ValueError(f"Missing Chinese meaning/POS: {term}")
        entries[term] = entry
    return {"version": 1, "source": "ECDICT (MIT); source/807_meaning_overrides.tsv", "count": len(entries), "entries": entries}


if __name__ == "__main__":
    result = build()
    (ROOT / "807/data/meanings.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"807 glossary: {result['count']} terms with Chinese meanings and POS")
