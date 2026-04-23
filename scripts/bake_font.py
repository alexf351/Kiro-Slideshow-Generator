#!/usr/bin/env python3
"""Embed the Inter variable font into the engine HTML.

Downloads the Inter variable woff2 once and replaces the Google Fonts
@import (or any prior embedded Inter @font-face) in
kiro_slideshow_engine_v3.html with a self-contained @font-face data URL.
That removes the network dependency so html2canvas never races against a
pending font fetch — matches the self-contained philosophy of the engine.

Must be run from a machine with internet access (not the sandbox).

Run from repo root:  python3 scripts/bake_font.py
"""

import base64
import re
import sys
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ENGINE = REPO / "kiro_slideshow_engine_v3.html"

# Variable-font sources, tried in order. Each serves a single woff2 that
# covers weights 100-900 with a continuous axis.
CANDIDATES = [
    "https://cdn.jsdelivr.net/npm/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
    "https://rsms.me/inter/font-files/InterVariable.woff2",
]


def fetch_font() -> bytes:
    last_err: Exception | None = None
    for url in CANDIDATES:
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                data = r.read()
            if len(data) < 10_000:
                raise RuntimeError(f"unexpectedly small ({len(data)} B)")
            print(f"[ok] fetched {len(data)} B from {url}")
            return data
        except Exception as e:
            print(f"[!] {url}: {e}", file=sys.stderr)
            last_err = e
    raise RuntimeError(f"all sources failed; last error: {last_err}")


def build_block(b64: str) -> str:
    return (
        "  /* Inter variable font, baked inline to avoid any network race\n"
        "     with html2canvas. Covers weights 400-900 in one woff2. */\n"
        "  @font-face {\n"
        "    font-family: 'Inter';\n"
        "    font-style: normal;\n"
        "    font-weight: 100 900;\n"
        "    font-display: block;\n"
        f"    src: url(data:font/woff2;base64,{b64}) format('woff2-variations');\n"
        "  }"
    )


def main() -> None:
    font_bytes = fetch_font()
    b64 = base64.b64encode(font_bytes).decode("ascii")
    block = build_block(b64)

    html = ENGINE.read_text()

    # Try, in order: replace an existing Inter @font-face, then an @import.
    face_pat = re.compile(
        r"[ \t]*(?:/\*[^*]*?\*/\s*)?@font-face\s*\{[^}]*?Inter[^}]*?\}",
        re.DOTALL,
    )
    import_pat = re.compile(
        r"[ \t]*(?:/\*[^*]*?\*/\s*)?@import url\(['\"]https://fonts\.googleapis\.com[^'\"]+['\"]\);",
    )

    new_html, n_face = face_pat.subn(block, html, count=1)
    if n_face == 0:
        new_html, n_import = import_pat.subn(block, html, count=1)
        if n_import == 0:
            print(
                "[!] no @import or prior @font-face found; "
                "inserting new block after <style>",
                file=sys.stderr,
            )
            new_html = re.sub(r"<style>\s*", "<style>\n" + block + "\n", html, count=1)

    ENGINE.write_text(new_html)
    print(f"wrote {ENGINE.name} with embedded Inter font ({len(b64)} b64 chars)")


if __name__ == "__main__":
    main()
