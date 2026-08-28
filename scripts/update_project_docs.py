from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CHANGELOG_MARKER = "<!-- CHANGELOG_ENTRIES -->"
STATUS_START = "<!-- VOCAB_STATUS_START -->"
STATUS_END = "<!-- VOCAB_STATUS_END -->"


def load_json(path: Path) -> dict | list:
    return json.loads(path.read_text(encoding="utf-8"))


def operation_count(title: str) -> str:
    match = re.search(r"(\d+)\s*项", title)
    return f"{match.group(1)} 项词库操作" if match else "一批错词操作"


def update_changelog(issue: dict, version: str, audit: dict) -> None:
    path = ROOT / "CHANGELOG.md"
    text = path.read_text(encoding="utf-8")
    issue_number = int(issue["number"])
    marker = f"<!-- vocabulary-issue:{issue_number} -->"
    if marker in text:
        return
    date = str(issue.get("created_at") or "")[:10] or "日期未知"
    title = str(issue.get("title") or "词库同步")
    count = operation_count(title)
    entry = (
        f"- {date} `[词库]` Issue #{issue_number}：同步{count}，构建后 "
        f"{audit['uniqueEntries']} 张主卡（听写 {audit['activities']['spelling']} / "
        f"识词 {audit['activities']['recognition']}）；训练端版本保持 `{version}`。 {marker}"
    )
    if CHANGELOG_MARKER not in text:
        raise SystemExit("CHANGELOG.md is missing the insertion marker")
    path.write_text(text.replace(CHANGELOG_MARKER, f"{CHANGELOG_MARKER}\n{entry}", 1), encoding="utf-8")


def update_handoff(issue: dict, version: str, admin_version: str, audit: dict) -> None:
    path = ROOT / "docs" / "HANDOFF.md"
    text = path.read_text(encoding="utf-8")
    date = str(issue.get("created_at") or "")[:10] or "日期未知"
    issue_number = int(issue["number"])
    block = "\n".join([
        STATUS_START,
        f"- 训练端程序版本：`{version}`",
        f"- 后台程序版本：`v{admin_version}`",
        f"- 正式词库：{audit['uniqueEntries']} 张主卡；听写 {audit['activities']['spelling']} 项；识词 {audit['activities']['recognition']} 项",
        f"- 个人错词：{audit['customEntries']} 条；基础词覆盖：{audit['overrideEntries']} 条；已停用：{audit['archivedEntries']} 条",
        f"- 最后自动词库同步：{date}，GitHub Issue #{issue_number}",
        STATUS_END,
    ])
    pattern = re.compile(re.escape(STATUS_START) + r".*?" + re.escape(STATUS_END), re.DOTALL)
    updated, replacements = pattern.subn(block, text, count=1)
    if replacements != 1:
        raise SystemExit("docs/HANDOFF.md is missing one vocabulary status block")
    path.write_text(updated, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Update GitHub handoff docs after a vocabulary issue build")
    parser.add_argument("--github-event", required=True, type=Path)
    args = parser.parse_args()

    event = load_json(args.github_event)
    issue = event.get("issue") if isinstance(event, dict) else None
    if not isinstance(issue, dict) or "number" not in issue:
        raise SystemExit("GitHub event does not contain an issue")

    version = str(load_json(ROOT / "version.json")["version"])
    admin_version = str(load_json(ROOT / "admin" / "package.json")["version"])
    audit = load_json(ROOT / "data" / "audit.json")
    update_changelog(issue, version, audit)
    update_handoff(issue, version, admin_version, audit)


if __name__ == "__main__":
    main()
