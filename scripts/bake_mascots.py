#!/usr/bin/env python3
"""Bake blurred mascot backgrounds into the engine HTML.

Reads the sharp tier .webp files from app/public/ and replaces the base64
MASCOTS entries in kiro_slideshow_engine_v3.html with heavily-blurred JPEG
equivalents.

Blur is pre-rendered into the JPEG because html2canvas strips CSS
filter:blur on export. The sharp source assets live in app/public/ and are
never referenced directly by the engine — only the baked output is.

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
BLUR_RADIUS_ON_SOURCE = 100
JPEG_QUALITY = 82


def bake_tier(tier: str) -> str:
    src = SOURCE_DIR / f"{tier}-kiro.webp"
    im = Image.open(src)
    bg = Image.new("RGB", im.size, (0, 0, 0))
    if im.mode == "RGBA":
        bg.paste(im, mask=im.split()[3])
    else:
        bg.paste(im)
    blurred = bg.filter(ImageFilter.GaussianBlur(radius=BLUR_RADIUS_ON_SOURCE))
    blurred = blurred.resize((TARGET_SIZE, TARGET_SIZE), Image.LANCZOS)
    buf = io.BytesIO()
    blurred.save(buf, format="JPEG", quality=JPEG_QUALITY, optimize=True)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def main():
    html = ENGINE.read_text()
    for tier in TIERS:
        b64 = bake_tier(tier)
        pat = re.compile(rf'"{tier}":\s*"data:image/jpeg;base64,[A-Za-z0-9+/=]+"')
        new = f'"{tier}": "data:image/jpeg;base64,{b64}"'
        if not pat.search(html):
            print(f"[!] {tier}: existing entry not found, aborting", file=sys.stderr)
            sys.exit(1)
        html = pat.sub(new, html, count=1)
        print(f"[ok] {tier}: {len(b64)} b64 chars")
    ENGINE.write_text(html)
    print(f"wrote {ENGINE.name}")


if __name__ == "__main__":
    main()
