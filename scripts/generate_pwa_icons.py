from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
BLUE = "#007AFF"
WHITE = "#FFFFFF"
SYSTEM_GRAY = "#F2F2F7"


def render(size: int, destination: str) -> None:
    scale = 4
    canvas = size * scale
    ratio = canvas / 512
    image = Image.new("RGB", (canvas, canvas), BLUE)
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((0, 0, canvas - 1, canvas - 1), radius=112 * ratio, fill=BLUE)

    bars = [
        (92, 230, 136, 282),
        (163, 160, 207, 352),
        (234, 188, 278, 324),
        (305, 122, 349, 390),
        (376, 230, 420, 282),
    ]
    for left, top, right, bottom in bars:
        draw.rectangle(tuple(round(value * ratio) for value in (left, top, right, bottom)), fill=WHITE)

    center = round(327 * ratio)
    radius = round(28 * ratio)
    draw.ellipse((center - radius, round(256 * ratio) - radius, center + radius, round(256 * ratio) + radius), fill=SYSTEM_GRAY)

    image = image.resize((size, size), Image.Resampling.LANCZOS)
    image.save(ROOT / destination, format="PNG", optimize=True)


if __name__ == "__main__":
    render(180, "apple-touch-icon.png")
    render(192, "icon-192.png")
    render(512, "icon-512.png")
