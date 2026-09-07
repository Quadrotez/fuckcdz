from pathlib import Path
from PIL import Image


def main():
    root = Path(__file__).resolve().parents[1]
    source = root / "assets" / "mesh-tasks-logo-source.png"
    out = root / "extension" / "icons"
    out.mkdir(parents=True, exist_ok=True)
    image = Image.open(source).convert("RGBA")
    pixels = image.load()
    for y in range(image.height):
        for x in range(image.width):
            r, g, b, _ = pixels[x, y]
            if r > 245 and g > 245 and b > 245:
                pixels[x, y] = (255, 255, 255, 0)
    for size in (16, 32, 48, 96, 128):
        image.resize((size, size), Image.Resampling.LANCZOS).save(out / f"icon-{size}.png", optimize=True)
    print(f"prepared icons in {out}")


if __name__ == "__main__":
    main()
