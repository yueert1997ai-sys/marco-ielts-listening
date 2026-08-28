from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REQUIRED_FILES = [
    ROOT / "CLAUDE.md",
    ROOT / "AGENTS.md",
    ROOT / "README.md",
    ROOT / "CHANGELOG.md",
    ROOT / "docs" / "HANDOFF.md",
]
STATEFUL_PATHS = {
    "version.json",
    "admin/package.json",
    "admin/wrangler.jsonc",
    "admin/schema.sql",
    ".github/workflows/sync-wrong-words.yml",
}
STATEFUL_PREFIXES = ("source/", "data/")


def git(*args: str) -> list[str]:
    result = subprocess.run(
        ["git", *args], cwd=ROOT, check=True, text=True,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    return [line.strip() for line in result.stdout.splitlines() if line.strip()]


def changed_files(base: str | None, head: str | None) -> set[str]:
    if base and head and set(base) != {"0"}:
        return set(git("diff", "--name-only", base, head))
    if head:
        return set(git("diff-tree", "--root", "--no-commit-id", "--name-only", "-r", head))
    changed = set(git("diff", "--name-only", "HEAD"))
    changed.update(git("diff", "--cached", "--name-only"))
    changed.update(git("ls-files", "--others", "--exclude-standard"))
    return changed


def validate_structure() -> list[str]:
    errors = [f"缺少必备文件：{path.relative_to(ROOT)}" for path in REQUIRED_FILES if not path.exists()]
    agents = ROOT / "AGENTS.md"
    if agents.exists() and (not agents.is_symlink() or agents.readlink() != Path("CLAUDE.md")):
        errors.append("AGENTS.md 必须是指向 CLAUDE.md 的软链接，避免多份规则分叉")
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    for required_link in ("CLAUDE.md", "docs/HANDOFF.md", "CHANGELOG.md"):
        if required_link not in readme:
            errors.append(f"README.md 缺少交接入口：{required_link}")
    return errors


def validate_change_set(changed: set[str]) -> list[str]:
    errors: list[str] = []
    if not changed:
        return errors
    if any(path != "CHANGELOG.md" for path in changed) and "CHANGELOG.md" not in changed:
        errors.append("本次改动未同步 CHANGELOG.md")
    state_changed = any(path in STATEFUL_PATHS or path.startswith(STATEFUL_PREFIXES) for path in changed)
    if state_changed and "docs/HANDOFF.md" not in changed:
        errors.append("版本、数据或发布流程发生变化，但未同步 docs/HANDOFF.md")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description="Check multi-agent documentation handoff rules")
    parser.add_argument("--base")
    parser.add_argument("--head")
    args = parser.parse_args()

    changed = changed_files(args.base, args.head)
    errors = validate_structure() + validate_change_set(changed)
    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        if changed:
            print("Changed files:", *sorted(changed), sep="\n  ", file=sys.stderr)
        return 1
    print(f"Documentation sync check passed ({len(changed)} changed files).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
