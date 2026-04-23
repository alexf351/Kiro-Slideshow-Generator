#!/usr/bin/env python3
"""Bake blurred mascot backgrounds into the engine HTML.

Scans app/public/ for files named {tier}-kiro[-{variant}].{webp,png} for
each tier (bronze, silver, gold, platinum, diamond, iridescent), applies a
heavy Gaussian blur on the full-res source, downscales to 800px, and
JPEG-encodes. All results are written as a regenerated MASCOTS object in
kiro_slideshow_engine_v3.html.

Key naming in MASCOTS:
    base variant   -> {tier}                     e.g. "bronze"
    other variants -> {tier}-{variant}           e.g. "bronze-celebrating"

The base-is-tier-only convention preserves backward compat with JSON that
uses mascot: "bronze" (implicit base).

Blur is pre-rendered into the JPEG because html2canvas strips CSS
filter:blur on export.

Run from repo root:  python3 scripts/bake_mascots.py
Deps:                pip install Pillow
"""

import base64
import io
import re
import sys
from pathlib import Path

from PIL import Image, ImageFilter

REPO = Path(__file__).resolve().parent.parent
ENGINE = REPO / "kiro_slideshow_engine_v3.html"
SOURCE_DIR = REPO / "app" / "public"
TIERS = ["bronze", "silver", "gold", "platinum", "diamond", "iridescent"]

TARGET_SIZE = 800
BLUR_RADIUS_ON_SOURCE = 35
JPEG_QUALITY = 82


def scan_variants(tier: str) -> dict[str, Path]:
    out: dict[str, Path] = {}
    for p in sorted(SOURCE_DIR.iterdir()):
        name = p.name
        if not (name.endswith(".webp") or name.endswith(".png")):
            continue
        if not name.startswith(f"{tier}-kiro"):
            continue
        stem = p.stem
        if stem == f"{tier}-kiro":
            out["base"] = p
        elif stem.startswith(f"{tier}-kiro-"):
            variant = stem[len(f"{tier}-kiro-"):]
            out[variant] = p
    return out


def bake_one(path: Path) -> str:
    im = Image.open(path)
    bg = Image.new("RGB", im.size, (0, 0, 0))
    if im.mode == "RGBA":
        bg.paste(im, mask=im.split()[3])
    else:
        bg.paste(im.convert("RGB"))
    blurred = bg.filter(ImageFilter.GaussianBlur(radius=BLUR_RADIUS_ON_SOURCE))
    blurred = blurred.resize((TARGET_SIZE, TARGET_SIZE), Image.LANCZOS)
    buf = io.BytesIO()
    blurred.save(buf, format="JPEG", quality=JPEG_QUALITY, optimize=True)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def main():
    # Collect all tier/variant entries and bake them
    entries: list[tuple[str, str]] = []  # (mascot_key, base64_string)
    for tier in TIERS:
        variants = scan_variants(tier)
        if "base" not in variants:
            print(f"[!] {tier}: no base file found at {tier}-kiro.webp/png", file=sys.stderr)
            sys.exit(1)
        # Base first (key = tier), then other variants in alpha order
        ordered = ["base"] + sorted(v for v in variants if v != "base")
        for variant in ordered:
            key = tier if variant == "base" else f"{tier}-{variant}"
            b64 = bake_one(variants[variant])
            entries.append((key, b64))
            print(f"[ok] {key}: {len(b64)} b64 chars")

    # Regenerate MASCOTS object wholesale
    lines = ["const MASCOTS = {"]
    for key, b64 in entries:
        lines.append(f'  "{key}": "data:image/jpeg;base64,{b64}",')
    lines.append("};")
    new_block = "\n".join(lines)

    html = ENGINE.read_text()
    pattern = re.compile(r"const MASCOTS = \{[^}]*\};", re.DOTALL)
    if not pattern.search(html):
        print("[!] could not find existing MASCOTS block", file=sys.stderr)
        sys.exit(1)
    html = pattern.sub(new_block, html, count=1)
    ENGINE.write_text(html)
    print(f"wrote {ENGINE.name} with {len(entries)} mascot entries")


if __name__ == "__main__":
    main()
