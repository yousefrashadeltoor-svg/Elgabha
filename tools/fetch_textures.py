#!/usr/bin/env python3
"""Download curated CC0 textures from Poly Haven (1K JPG) for the Frontline 1943 map.

Poly Haven assets are CC0 (public domain). Attribution is recorded in
docs/ASSET_REGISTRY.md and shown in the in-game Credits screen.
"""
import json
import os
import subprocess
import sys

UA = "Frontline1943/1.0 (browser game asset pipeline)"
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "assets", "textures")

# id -> (map keys we want)
TEXTURES = {
    "brown_mud": ["Diffuse", "nor_gl", "arm"],
    "snow_02": ["Diffuse", "nor_gl", "arm"],
    "withered_grass": ["Diffuse", "nor_gl", "arm"],
    "gravel": ["Diffuse", "nor_gl", "arm"],
    "dirt": ["Diffuse", "nor_gl", "arm"],
    "brick_wall_001": ["Diffuse", "nor_gl", "arm"],
    "damaged_plaster": ["Diffuse", "nor_gl", "arm"],
    "wood_planks": ["Diffuse", "nor_gl", "arm"],
    "concrete": ["Diffuse", "nor_gl", "arm"],
    "rusty_metal": ["Diffuse", "nor_gl", "arm"],
    "dark_rock": ["Diffuse", "nor_gl", "arm"],
    "clay_roof_tiles": ["Diffuse", "nor_gl", "arm"],
    "forest_floor": ["Diffuse", "nor_gl", "arm"],
    "rubble": ["Diffuse", "nor_gl", "arm"],
}

SUFFIX = {"Diffuse": "diff", "nor_gl": "nor", "arm": "arm"}


def api(path):
    r = subprocess.run(
        ["curl", "-s", "-H", f"User-Agent: {UA}", f"https://api.polyhaven.com/{path}"],
        capture_output=True, text=True, check=True,
    )
    return json.loads(r.stdout)


def pick(files, key):
    """Return the 1k jpg url for a map key, falling back to 2k."""
    node = files.get(key)
    if not node:
        return None
    for res in ("1k", "2k"):
        if res in node and "jpg" in node[res]:
            return node[res]["jpg"]["url"]
    return None


def main():
    os.makedirs(OUT, exist_ok=True)
    registry = []
    for tid, keys in TEXTURES.items():
        try:
            files = api(f"files/{tid}")
        except Exception as e:  # noqa: BLE001
            print(f"!! {tid}: metadata failed: {e}", file=sys.stderr)
            continue
        for key in keys:
            url = pick(files, key)
            if not url:
                print(f"   {tid}/{key}: no 1k jpg", file=sys.stderr)
                continue
            dest = os.path.join(OUT, f"{tid}_{SUFFIX[key]}.jpg")
            if os.path.exists(dest) and os.path.getsize(dest) > 1000:
                print(f"   {tid}/{key}: cached")
                continue
            subprocess.run(
                ["curl", "-sL", "-H", f"User-Agent: {UA}", "-o", dest, url], check=True
            )
            print(f"   {tid}/{key}: {os.path.getsize(dest)//1024} KB")
        registry.append({"id": tid, "license": "CC0", "source": "Poly Haven",
                         "url": f"https://polyhaven.com/a/{tid}"})
    with open(os.path.join(OUT, "registry.json"), "w") as f:
        json.dump(registry, f, indent=2)
    print(f"\nDone: {len(registry)} textures -> {OUT}")


if __name__ == "__main__":
    main()
