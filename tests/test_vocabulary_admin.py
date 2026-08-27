from __future__ import annotations

import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import build_listening  # noqa: E402
import import_wrong_words  # noqa: E402


class VocabularyAdminTests(unittest.TestCase):
    def test_plural_intake_merges_into_base_card(self) -> None:
        base = [{
            "id": "curtain", "term": "curtain", "meaning": "窗帘",
            "modes": ["spelling"], "numberVariants": ["curtains"],
        }]
        merged = {}
        imported = import_wrong_words.merge_intake({
            "term": "curtains", "meaning": "窗帘", "mode": "recognition",
        }, merged, base, "2026-08-27")
        self.assertEqual(imported, "curtain")
        self.assertEqual(merged["curtain"]["term"], "curtain")
        self.assertEqual(merged["curtain"]["reportedCount"], 1)

    def test_certain_and_certains_share_one_card(self) -> None:
        base = [{"id": "certain", "term": "certain", "meaning": "确定的", "modes": ["recognition"]}]
        merged = {}
        import_wrong_words.merge_intake({
            "term": "certains", "meaning": "确定的", "mode": "recognition",
        }, merged, base, "2026-08-27")
        self.assertEqual(list(merged), ["certain"])

    def test_repeated_manual_report_increments_count(self) -> None:
        merged = {"colossal": import_wrong_words.clean({
            "term": "colossal", "meaning": "巨大的", "mode": "recognition",
            "reportedCount": 2, "addedAt": "2026-08-20",
        })}
        import_wrong_words.merge_intake({
            "term": "colossal", "meaning": "巨大的", "mode": "recognition",
        }, merged, [], "2026-08-27")
        self.assertEqual(merged["colossal"]["reportedCount"], 3)
        self.assertEqual(merged["colossal"]["addedAt"], "2026-08-20")

    def test_override_can_archive_and_restore(self) -> None:
        known = {"curtain": {"id": "curtain", "term": "curtain", "meaning": "窗帘", "modes": ["spelling"]}}
        overrides = {}
        import_wrong_words.update_override(overrides, "curtain", {"op": "archive"}, known, "2026-08-27")
        self.assertTrue(overrides["curtain"]["archived"])
        import_wrong_words.update_override(overrides, "curtain", {"op": "restore"}, known, "2026-08-27")
        self.assertFalse(overrides["curtain"]["archived"])

    def test_build_applies_patch_without_changing_snapshot(self) -> None:
        rows = [{
            "term": "curtain", "meaning": "窗帘", "note": "家居词",
            "section": "P2 + P3 必会看懂词", "category": "住房",
        }]
        items, audit = build_listening.build(rows, 4, [], [{
            "id": "curtain", "meaning": "窗帘；帘子", "modes": ["recognition", "spelling"],
            "updatedAt": "2026-08-27",
        }])
        self.assertEqual(items[0]["meaning"], "窗帘；帘子")
        self.assertEqual(items[0]["modes"], ["recognition", "spelling"])
        self.assertEqual(audit["overrideEntries"], 1)


if __name__ == "__main__":
    unittest.main()
