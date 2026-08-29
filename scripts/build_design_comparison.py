"""Build reproducible v2.13.0 design-QA comparison images."""

from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "docs" / "design-qa" / "v2.13.0"
REFERENCE_SOURCE = EVIDENCE / "reference-source.png"
IMPLEMENTATION = EVIDENCE / "implementation.png"
TARGET_SIZE = (390, 844)
GUTTER = 20


def normalize(image: Image.Image) -> Image.Image:
    return image.convert("RGB").resize(TARGET_SIZE, Image.Resampling.LANCZOS)


def side_by_side(left: Image.Image, right: Image.Image) -> Image.Image:
    canvas = Image.new("RGB", (TARGET_SIZE[0] * 2 + GUTTER, TARGET_SIZE[1]), "#F2F2F7")
    canvas.paste(left, (0, 0))
    canvas.paste(right, (TARGET_SIZE[0] + GUTTER, 0))
    return canvas


def main() -> None:
    reference = normalize(Image.open(REFERENCE_SOURCE))
    implementation = normalize(Image.open(IMPLEMENTATION))
    reference.save(EVIDENCE / "reference.png", optimize=True)
    side_by_side(reference, implementation).save(EVIDENCE / "comparison.png", optimize=True)

    focus_height = 650
    focused = side_by_side(
        reference.crop((0, 0, TARGET_SIZE[0], focus_height)),
        implementation.crop((0, 0, TARGET_SIZE[0], focus_height)),
    ).crop((0, 0, TARGET_SIZE[0] * 2 + GUTTER, focus_height))
    focused.save(EVIDENCE / "comparison-home-core.png", optimize=True)


if __name__ == "__main__":
    main()
