"""Generate compact British-English MP3 audio for every vocabulary entry."""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

import edge_tts


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "listening.json"
OUT = ROOT / "audio"
VOICE = "en-GB-SoniaNeural"


async def generate(item: dict, semaphore: asyncio.Semaphore, overwrite: bool) -> tuple[str, str]:
    path = OUT / f"{item['id']}.mp3"
    if path.exists() and path.stat().st_size > 500 and not overwrite:
        return item["id"], "cached"
    async with semaphore:
        for attempt in range(1, 6):
            try:
                communicate = edge_tts.Communicate(item["audioText"], VOICE, rate="-8%")
                await asyncio.wait_for(communicate.save(str(path)), timeout=30)
                if path.exists() and path.stat().st_size > 500:
                    return item["id"], "generated"
            except Exception:
                if path.exists():
                    path.unlink()
                if attempt == 5:
                    return item["id"], "failed"
                await asyncio.sleep(attempt * 1.5)
    return item["id"], "failed"


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int)
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()
    items = json.loads(DATA.read_text(encoding="utf-8"))
    if args.limit:
        items = items[: args.limit]
    OUT.mkdir(parents=True, exist_ok=True)
    semaphore = asyncio.Semaphore(2)
    results = await asyncio.gather(*(generate(item, semaphore, args.overwrite) for item in items))
    counts = {status: sum(1 for _, value in results if value == status) for status in {value for _, value in results}}
    successful = [item for item in items if (OUT / f"{item['id']}.mp3").exists() and (OUT / f"{item['id']}.mp3").stat().st_size > 500]
    manifest = {"voice": VOICE, "count": len(successful), "files": [item["audioPath"] for item in successful]}
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"ok": True, **counts, "total": len(items)}, ensure_ascii=False))
    if counts.get("failed"):
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(main())
