"""Validate every mapped MP3 by fully decoding it, not just checking headers."""
import concurrent.futures
import json
import pathlib
import shutil
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]
mapping = json.loads((ROOT / "module-audio/manifest.json").read_text(encoding="utf-8"))["items"]
ffmpeg = shutil.which("ffmpeg") or r"D:\Tools\ffmpeg\bin\ffmpeg.exe"

def validate(path):
    target = ROOT / path
    if not target.exists() or target.stat().st_size < 500:
        return path + ": missing/empty"
    result = subprocess.run([ffmpeg, "-v", "error", "-i", str(target), "-f", "null", "-"], capture_output=True)
    return path + ": " + result.stderr.decode(errors="replace") if result.returncode or result.stderr else None

with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
    errors = [error for error in pool.map(validate, set(mapping.values())) if error]
print(json.dumps({"mapped": len(mapping), "decoded": len(set(mapping.values())) - len(errors), "errors": errors}, ensure_ascii=False))
raise SystemExit(bool(errors))
