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

    def test_singular_intake_rekeys_an_existing_plural_custom_card(self) -> None:
        merged = {"calories": import_wrong_words.clean({
            "term": "calories", "meaning": "卡路里；热量", "mode": "recognition",
            "addedAt": "2026-08-26",
        })}
        imported = import_wrong_words.merge_intake({
            "term": "calorie", "meaning": "卡路里；热量", "mode": "recognition",
        }, merged, [], "2026-08-31")
        self.assertEqual(imported, "calorie")
        self.assertEqual(list(merged), ["calorie"])
        self.assertEqual(merged["calorie"]["term"], "calorie")
        self.assertEqual(merged["calorie"]["addedAt"], "2026-08-26")
        self.assertEqual(merged["calorie"]["reportedCount"], 2)

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

    def test_manual_intake_preserves_explicit_part_of_speech(self) -> None:
        merged = {"melt": import_wrong_words.clean({
            "term": "melt", "meaning": "融化；熔化；使融化", "mode": "recognition",
            "partOfSpeech": "动词", "addedAt": "2026-08-31",
        })}
        import_wrong_words.merge_intake({
            "term": "melt", "meaning": "融化；熔化；使融化", "mode": "recognition",
        }, merged, [], "2026-09-01")
        self.assertEqual(merged["melt"]["partOfSpeech"], "动词")

    def test_manual_intake_rejects_full_sentences(self) -> None:
        with self.assertRaisesRegex(SystemExit, "Full sentences cannot be added"):
            import_wrong_words.clean({
                "term": "Large pans of sap called evaporators are heated by means of a fire",
                "meaning": "装有树液的大锅用火加热",
                "mode": "recognition",
            })

    def test_build_rejects_full_sentences_from_any_source(self) -> None:
        rows = [{
            "term": "Large pans of sap called evaporators are heated by means of a fire",
            "meaning": "装有树液的大锅用火加热", "note": "整句",
            "section": "P2 + P3 必会看懂词", "category": "误录",
        }]
        with self.assertRaisesRegex(SystemExit, "full sentence"):
            items, audit = build_listening.build(rows, 4, [], [])
            build_listening.validate(items, audit)

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

    def test_build_adds_part_of_speech_from_local_dictionary(self) -> None:
        rows = [{
            "term": "curtain", "meaning": "窗帘", "note": "家居词",
            "section": "P2 + P3 必会看懂词", "category": "住房",
        }]
        dictionary = {"entries": {"curtain": {"translation": "n. 窗帘；vt. 遮蔽"}}, "aliases": {}}
        items, audit = build_listening.build(rows, 4, [], [], dictionary)
        self.assertEqual(items[0]["partOfSpeech"], "名词 / 动词")
        self.assertEqual(audit["partOfSpeechEntries"], 1)

    def test_build_canonicalises_an_inflected_override_and_keeps_the_alias(self) -> None:
        rows = [
            {
                "term": "neglect", "meaning": "忽视；疏于照顾", "note": "—",
                "section": "P2 + P3 必会看懂词", "category": "动作",
            },
            {
                "term": "neglecting", "meaning": "忽视；疏于照顾", "note": "真实卡点",
                "section": "我的真实错词", "category": "动作",
            },
        ]
        items, audit = build_listening.build(rows, 4, [], [{
            "id": "neglecting", "canonicalTerm": "neglect", "partOfSpeech": "动词",
            "updatedAt": "2026-09-01",
        }])
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["term"], "neglect")
        self.assertEqual(items[0]["numberVariants"], ["neglecting"])
        self.assertTrue(items[0]["isRealError"])
        self.assertEqual(audit["overrideEntries"], 1)

    def test_intake_preserves_known_inflection_aliases(self) -> None:
        existing = import_wrong_words.clean({
            "term": "dispose", "meaning": "处理；处置", "mode": "recognition",
            "numberVariants": ["disposed"], "addedAt": "2026-08-31",
        })
        merged = {"dispose": existing}
        import_wrong_words.merge_intake({
            "term": "disposed", "meaning": "处理；处置", "mode": "recognition",
        }, merged, [existing], "2026-09-01")
        self.assertEqual(list(merged), ["dispose"])
        self.assertEqual(merged["dispose"]["numberVariants"], ["disposed"])


if __name__ == "__main__":
    unittest.main()
