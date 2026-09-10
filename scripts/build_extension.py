#!/usr/bin/env python3
"""Build unpacked and ZIP bundles for Chromium and Gecko browsers."""
from __future__ import annotations

import json
import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "extension"
DIST = ROOT / "dist"
FILES = [
    "background.js",
    "content.js",
    "tasks.html",
    "tasks.css",
    "tasks.js",
    "options.html",
    "debug-content.js",
    "page-hook.js",
    "debug.html",
    "debug.css",
    "debug.js",
    "exam.html",
    "exam.css",
    "exam.js",
    "popup.html",
    "popup.css",
    "popup.js",
]


def build(browser: str, manifest: dict) -> None:
    target = DIST / browser
    archive = DIST / f"fuckcdz-{browser}.zip"
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True)
    for name in FILES:
        shutil.copy2(SOURCE / "src" / name, target / name)
    shutil.copytree(SOURCE / "icons", target / "icons")
    (target / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    if archive.exists():
        archive.unlink()
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
        for path in sorted(target.rglob("*")):
            if path.is_file():
                bundle.write(path, path.relative_to(target))
    print(f"built {browser}: {target} and {archive}")


def main() -> None:
    base = json.loads((SOURCE / "manifest.base.json").read_text(encoding="utf-8"))
    chromium = dict(base)
    chromium["name"] = "FuckCDZ (Chromium)"
    gecko = dict(base)
    gecko["name"] = "FuckCDZ (Gecko)"
    gecko["manifest_version"] = 2
    gecko.pop("action", None)
    gecko["browser_action"] = {
        "default_title": "FuckCDZ",
        "default_popup": "popup.html",
        "default_icon": {
            "16": "icons/icon-16.png",
            "32": "icons/icon-32.png",
            "48": "icons/icon-48.png",
            "96": "icons/icon-96.png",
        },
    }
    gecko.pop("host_permissions", None)
    gecko["permissions"] = [
        *gecko.get("permissions", []),
        "https://school.mos.ru/*",
        "https://dnevnik.mos.ru/*",
        "https://uchebnik.mos.ru/*",
    ]
    gecko["background"] = {"scripts": ["background.js"]}
    gecko["web_accessible_resources"] = ["page-hook.js"]
    gecko["browser_specific_settings"] = {
        "gecko": {
            "id": "fuckcdz@quadrotez.local",
            "strict_min_version": "109.0",
        }
    }
    build("chromium", chromium)
    build("gecko", gecko)


if __name__ == "__main__":
    main()
