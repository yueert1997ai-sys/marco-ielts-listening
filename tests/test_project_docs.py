from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import check_docs_sync  # noqa: E402
import update_project_docs  # noqa: E402


class ProjectDocsTests(unittest.TestCase):
    def test_change_requires_changelog(self) -> None:
        self.assertEqual(
            check_docs_sync.validate_change_set({"app.js"}),
            ["本次改动未同步 CHANGELOG.md"],
        )
        self.assertEqual(check_docs_sync.validate_change_set({"app.js", "CHANGELOG.md"}), [])

    def test_state_change_requires_handoff(self) -> None:
        errors = check_docs_sync.validate_change_set({"source/custom_words.json", "CHANGELOG.md"})
        self.assertIn("版本、数据或发布流程发生变化，但未同步 docs/HANDOFF.md", errors)

    def test_vocabulary_doc_update_is_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "docs").mkdir()
            (root / "CHANGELOG.md").write_text("# Log\n\n<!-- CHANGELOG_ENTRIES -->\n", encoding="utf-8")
            (root / "docs" / "HANDOFF.md").write_text(
                "before\n<!-- VOCAB_STATUS_START -->\nold\n<!-- VOCAB_STATUS_END -->\nafter\n",
                encoding="utf-8",
            )
            issue = {"number": 9, "title": "[词库管理] 2026-08-28 3项", "created_at": "2026-08-28T01:00:00Z"}
            audit = {
                "uniqueEntries": 700,
                "customEntries": 55,
                "overrideEntries": 6,
                "archivedEntries": 1,
                "activities": {"spelling": 280, "recognition": 480},
            }
            with mock.patch.object(update_project_docs, "ROOT", root):
                update_project_docs.update_changelog(issue, "v2.11.1", audit)
                update_project_docs.update_changelog(issue, "v2.11.1", audit)
                update_project_docs.update_handoff(issue, "v2.11.1", "1.0.0", audit)
            changelog = (root / "CHANGELOG.md").read_text(encoding="utf-8")
            handoff = (root / "docs" / "HANDOFF.md").read_text(encoding="utf-8")
            self.assertEqual(changelog.count("vocabulary-issue:9"), 1)
            self.assertIn("700 张主卡", handoff)
            self.assertIn("GitHub Issue #9", handoff)


if __name__ == "__main__":
    unittest.main()
