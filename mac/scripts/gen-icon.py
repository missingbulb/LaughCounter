#!/usr/bin/env python3
"""Generate LaughCounter's app icon from code — no external dependencies.

Renders an original 😄-motif icon using only the Python standard library (a
hand-rolled PNG encoder on top of ``zlib``), so the art is reproducible and
reviewable in-repo. The macOS build turns ``AppIcon.png`` into a multi-resolution
``.icns`` with ``sips``/``iconutil`` (used both as the app icon and the DMG's
volume icon).

Usage:  python3 mac/scripts/gen-icon.py
Writes: mac/Resources/AppIcon.png (1024²)
"""
from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path

RESOURCES = Path(__file__).resolve().parent.parent / "Resources"


def write_png(path: Path, width: int, height: int, pixels: bytearray) -> None:
    """Encode 8-bit RGBA ``pixels`` (row-major, no filter bytes) as a PNG."""
    def chunk(kind: bytes, data: bytes) -> bytes:
        return (struct.pack(">I", len(data)) + kind + data
                + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF))

    stride = width * 4
    raw = bytearray()
    for y in range(height):
        raw.append(0)  # filter type 0 (None) per scanline
        raw.extend(pixels[y * stride:(y + 1) * stride])
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)  # RGBA, 8-bit
    blob = (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
            + chunk(b"IEND", b""))
    path.write_bytes(blob)


def _clamp(v: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return lo if v < lo else hi if v > hi else v


def _mix(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def _sd_round_rect(dx: float, dy: float, half: float, r: float) -> float:
    qx, qy = abs(dx) - (half - r), abs(dy) - (half - r)
    outside = math.hypot(max(qx, 0.0), max(qy, 0.0))
    inside = min(max(qx, qy), 0.0)
    return outside + inside - r


def _sd_ellipse(dx: float, dy: float, rx: float, ry: float) -> float:
    k1 = math.hypot(dx / rx, dy / ry)
    if k1 == 0:
        return -min(rx, ry)
    k2 = math.hypot(dx / (rx * rx), dy / (ry * ry))
    return k1 * (k1 - 1.0) / k2 if k2 else -min(rx, ry)


def _over(bg, fg_rgb, a):
    """Composite opaque-ish ``fg_rgb`` with coverage ``a`` over premultiplied bg
    (r, g, b, alpha), all 0..1. Returns the new (r, g, b, alpha)."""
    br, bgc, bb, ba = bg
    out_a = a + ba * (1 - a)
    if out_a == 0:
        return (0.0, 0.0, 0.0, 0.0)
    r = (fg_rgb[0] * a + br * ba * (1 - a)) / out_a
    g = (fg_rgb[1] * a + bgc * ba * (1 - a)) / out_a
    b = (fg_rgb[2] * a + bb * ba * (1 - a)) / out_a
    return (r, g, b, out_a)


TOP = (1.0, 0.807, 0.227)     # #FFCE3A
BOTTOM = (1.0, 0.588, 0.0)    # #FF9600
EYE = (0.235, 0.165, 0.071)   # #3C2A12
MOUTH = (0.373, 0.137, 0.094)  # #5F2318
TEETH = (0.98, 0.98, 0.98)


def render_icon(size: int) -> bytearray:
    px = bytearray(size * size * 4)
    cx = cy = size / 2.0
    margin = size * 0.085
    half = (size - 2 * margin) / 2.0
    corner = (half * 2) * 0.2237
    aa = size / 1024.0 * 1.4  # anti-alias width, scales with resolution

    eye_dx, eye_dy = size * 0.155, size * 0.115
    eye_rx, eye_ry = size * 0.052, size * 0.072
    m_cx, m_cy = cx, cy + size * 0.045
    m_r = size * 0.265
    m_line = cy + size * 0.02          # flat-ish top of the open mouth
    teeth_bottom = m_line + size * 0.055

    for y in range(size):
        row = y * size * 4
        fy = y + 0.5
        for x in range(size):
            fx = x + 0.5
            dx, dy = fx - cx, fy - cy

            sq = _sd_round_rect(dx, dy, half, corner)
            sq_cov = _clamp(0.5 - sq / aa)
            if sq_cov <= 0.0:
                continue  # fully transparent outside the squircle

            t = _clamp((fy - (cy - half)) / (2 * half))
            color = _mix(TOP, BOTTOM, t)
            pix = (color[0], color[1], color[2], sq_cov)

            # Open mouth: disk below the smile line, clipped to the squircle.
            md = math.hypot(fx - m_cx, fy - m_cy) - m_r
            mouth_cov = _clamp(0.5 - md / aa) * _clamp((fy - m_line) / aa + 0.5)
            mouth_cov = min(mouth_cov, sq_cov)
            if mouth_cov > 0.0:
                pix = _over(pix, MOUTH, mouth_cov)
                if fy <= teeth_bottom:
                    teeth_cov = min(mouth_cov, _clamp((teeth_bottom - fy) / aa + 0.5))
                    pix = _over(pix, TEETH, teeth_cov)

            # Two happy eyes.
            for ex in (cx - eye_dx, cx + eye_dx):
                ed = _sd_ellipse(fx - ex, fy - (cy - eye_dy), eye_rx, eye_ry)
                eye_cov = min(_clamp(0.5 - ed / aa), sq_cov)
                if eye_cov > 0.0:
                    pix = _over(pix, EYE, eye_cov)

            r, g, b, a = pix
            i = row + x * 4
            px[i] = int(r * 255 + 0.5)
            px[i + 1] = int(g * 255 + 0.5)
            px[i + 2] = int(b * 255 + 0.5)
            px[i + 3] = int(a * 255 + 0.5)
    return px


def main() -> None:
    RESOURCES.mkdir(parents=True, exist_ok=True)
    write_png(RESOURCES / "AppIcon.png", 1024, 1024, render_icon(1024))
    print("wrote", RESOURCES / "AppIcon.png")


if __name__ == "__main__":
    main()
