"""Fetch the Feishu vocabulary document into a reproducible local snapshot."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "source" / "feishu_listening.json"
DOC_TOKEN = "PMXRdM6RFouDlwxRZsWc3phPndf"


def main() -> int:
    env = os.environ.copy()
    env["LARKSUITE_CLI_NO_UPDATE_NOTIFIER"] = "1"
    env["LARKSUITE_CLI_NO_SKILLS_NOTIFIER"] = "1"
    command = [
        "lark-cli.cmd",
        "docs",
        "+fetch",
        "--as",
        "user",
        "--doc",
        DOC_TOKEN,
        "--doc-format",
        "xml",
        "--detail",
        "simple",
    ]
    result = subprocess.run(
        command,
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        shell=sys.platform == "win32",
        check=False,
    )
    if result.returncode:
        raise SystemExit(result.stderr or result.stdout)
    payload = json.loads(result.stdout)
    if payload.get("ok") is not True or payload.get("identity") != "user":
        raise SystemExit(f"Unexpected Feishu response: {payload}")
    document = payload.get("data", {}).get("document", {})
    if document.get("document_id") != DOC_TOKEN or not document.get("content"):
        raise SystemExit("Feishu response did not contain the expected document")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        "ok": True,
        "path": str(OUT.relative_to(ROOT)),
        "revision": document.get("revision_id"),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
