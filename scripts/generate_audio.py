"""Generate compact British-English MP3 audio for every vocabulary entry."""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "listening.json"
DIRECTIONS = ROOT / "data" / "directions.json"
OUT = ROOT / "audio"
VOICE = "en-GB-SoniaNeural"
OFFLINE_VOICE = "macOS Daniel (en-GB)"
OFFLINE_VOICE_IDS = {"dispose", "erect", "resurface", "standardise", "tether"}


async def generate(item: dict, semaphore: asyncio.Semaphore, overwrite: bool) -> tuple[str, str]:
    import edge_tts

    path = ROOT / item.get("audioPath", f"audio/{item['id']}.mp3")
    path.parent.mkdir(parents=True, exist_ok=True)
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
    parser.add_argument("--directions-only", action="store_true")
    parser.add_argument("--manifest-only", action="store_true", help="Refresh manifests without contacting TTS services")
    args = parser.parse_args()
    vocabulary = json.loads(DATA.read_text(encoding="utf-8"))
    directions = json.loads(DIRECTIONS.read_text(encoding="utf-8"))
    items = directions if args.directions_only else [*vocabulary, *directions]
    if args.limit:
        items = items[: args.limit]
    OUT.mkdir(parents=True, exist_ok=True)
    if args.manifest_only:
        results = [
            (item["id"], "cached" if (ROOT / item["audioPath"]).exists() and (ROOT / item["audioPath"]).stat().st_size > 500 else "failed")
            for item in items
        ]
    else:
        semaphore = asyncio.Semaphore(2)
        results = await asyncio.gather(*(generate(item, semaphore, args.overwrite) for item in items))
    counts = {status: sum(1 for _, value in results if value == status) for status in {value for _, value in results}}
    successful = [item for item in vocabulary if (ROOT / item["audioPath"]).exists() and (ROOT / item["audioPath"]).stat().st_size > 500]
    offline_files = [item["audioPath"] for item in successful if item["id"] in OFFLINE_VOICE_IDS]
    manifest = {
        "voice": VOICE if not offline_files else f"{VOICE} + {OFFLINE_VOICE}",
        "offlineVoice": OFFLINE_VOICE if offline_files else None,
        "offlineFiles": offline_files,
        "count": len(successful),
        "files": [item["audioPath"] for item in successful],
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    direction_successful = [item for item in directions if (ROOT / item["audioPath"]).exists() and (ROOT / item["audioPath"]).stat().st_size > 500]
    direction_manifest = {"voice": VOICE, "count": len(direction_successful), "files": [item["audioPath"] for item in direction_successful]}
    (OUT / "directions-manifest.json").write_text(json.dumps(direction_manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"ok": True, **counts, "total": len(items)}, ensure_ascii=False))
    if counts.get("failed"):
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(main())
