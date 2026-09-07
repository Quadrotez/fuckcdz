from collections import deque
from pathlib import Path
from PIL import Image


def main():
    root = Path(__file__).resolve().parents[1]
    source = root / "assets" / "mesh-tasks-logo-source.png"
    out = root / "extension" / "icons"
    out.mkdir(parents=True, exist_ok=True)
    image = Image.open(source).convert("RGBA")
    pixels = image.load()
    width, height = image.size
    queue = deque()
    visited = set()
    for x in range(width):
        queue.extend(((x, 0), (x, height - 1)))
    for y in range(height):
        queue.extend(((0, y), (width - 1, y)))
    while queue:
        x, y = queue.popleft()
        if (x, y) in visited or not (0 <= x < width and 0 <= y < height):
            continue
        visited.add((x, y))
        r, g, b, _ = pixels[x, y]
        if min(r, g, b) < 235:
            continue
        pixels[x, y] = (255, 255, 255, 0)
        queue.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
    for size in (16, 32, 48, 96, 128):
        image.resize((size, size), Image.Resampling.LANCZOS).save(out / f"icon-{size}.png", optimize=True)
    print(f"prepared icons in {out}")


if __name__ == "__main__":
    main()
