"""Pixel-based watermark removal, adapted from
https://github.com/LJSthu/Python-Remove-Watermark

Rasterizes each target page, whitens light-gray pixels that belong to thin
strokes (watermark glyphs) while preserving large filled areas, then draws
the cleaned page image back over the original page. Untouched pages keep
their original vector/text content.
"""

from __future__ import annotations

import io

import numpy as np
import pymupdf
from PIL import Image

DPI = 200
# Whiten pixels whose channels are near-equal and light (the typical
# color of stamp watermarks). Pure white and dark content are untouched.
MIN_CHANNEL = 175
MAX_CHANNEL = 250
CHANNEL_TOLERANCE = 12
# A watermark stroke is sparse: within a small window most pixels are
# background. Fills/shading are dense and must be preserved.
DENSITY_WINDOW = 15
MAX_DENSITY = 0.6
# If light-stroke pixels cover more than this fraction of the page, they
# are almost certainly real content (table grids, letterhead rules) rather
# than a watermark — skip whitening for that page entirely.
MAX_WHITEN_RATIO = 0.05
# Strokes longer than this (in pixels at DPI) are rules/borders, not glyph
# strokes — keep them even when they are light gray.
MIN_RUN_LENGTH = 80


def _long_run_mask(mask: np.ndarray, horizontal: bool) -> np.ndarray:
    """Pixels belonging to runs of True longer than MIN_RUN_LENGTH."""
    lines = mask if horizontal else mask.T
    res = np.zeros_like(lines)
    for idx in range(lines.shape[0]):
        row = lines[idx]
        if not row.any():
            continue
        diff = np.diff(np.concatenate(([0], row.astype(np.int8), [0])))
        starts = np.flatnonzero(diff == 1)
        ends = np.flatnonzero(diff == -1)
        for s, e in zip(starts, ends):
            if e - s >= MIN_RUN_LENGTH:
                res[idx, s:e] = True
    return res if horizontal else res.T


def _box_density(mask: np.ndarray, k: int) -> np.ndarray:
    """Fraction of True pixels in a kxk window around each pixel."""
    integral = np.pad(mask.astype(np.float64), ((1, 0), (1, 0))).cumsum(0).cumsum(1)
    h, w = mask.shape
    y0 = np.clip(np.arange(h) - k // 2, 0, h)
    y1 = np.clip(np.arange(h) + k // 2 + 1, 0, h)
    x0 = np.clip(np.arange(w) - k // 2, 0, w)
    x1 = np.clip(np.arange(w) + k // 2 + 1, 0, w)
    area = (y1 - y0)[:, None] * (x1 - x0)[None, :]
    sums = (
        integral[y1][:, x1]
        - integral[y0][:, x1]
        - integral[y1][:, x0]
        + integral[y0][:, x0]
    )
    return sums / np.maximum(area, 1)


def whiten_watermark_pixels(arr: np.ndarray) -> np.ndarray:
    """Return a copy of the RGB image with watermark strokes set to white."""
    r = arr[..., 0].astype(np.int16)
    g = arr[..., 1].astype(np.int16)
    b = arr[..., 2].astype(np.int16)

    near_gray = (
        (np.abs(r - g) <= CHANNEL_TOLERANCE)
        & (np.abs(g - b) <= CHANNEL_TOLERANCE)
        & (np.abs(r - b) <= CHANNEL_TOLERANCE)
    )
    light = (
        (r >= MIN_CHANNEL)
        & (r <= MAX_CHANNEL)
        & (g >= MIN_CHANNEL)
        & (g <= MAX_CHANNEL)
        & (b >= MIN_CHANNEL)
        & (b <= MAX_CHANNEL)
    )
    mask = near_gray & light
    if not mask.any():
        return arr

    density = _box_density(mask, DENSITY_WINDOW)
    whiten = mask & (density <= MAX_DENSITY)
    if not whiten.any() or whiten.mean() > MAX_WHITEN_RATIO:
        return arr

    # Keep long straight strokes (table rules, form borders, underlines);
    # only compact glyph-like strokes are treated as watermark.
    lines = _long_run_mask(whiten, horizontal=True) | _long_run_mask(
        whiten, horizontal=False
    )
    whiten &= ~lines
    if not whiten.any():
        return arr

    out = arr.copy()
    out[whiten] = 255
    return out


def _cleaned_page_png(page: pymupdf.Page, dpi: int) -> bytes:
    pixmap = page.get_pixmap(dpi=dpi, alpha=False)
    arr = np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(
        pixmap.height, pixmap.width, pixmap.n
    )
    if pixmap.n == 4:
        arr = arr[..., :3]
    arr = whiten_watermark_pixels(arr)
    image = Image.fromarray(arr, "RGB")
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()


def remove_pixel_watermark(
    input_path: str,
    output_path: str,
    page_indices: list[int] | None = None,
    dpi: int = DPI,
) -> dict:
    """Whiten light-gray watermark pixels on the given pages (default: all)
    by overlaying a cleaned raster of each page."""
    targets = set(page_indices) if page_indices is not None else None
    doc = pymupdf.open(input_path)
    try:
        processed = 0
        for i, page in enumerate(doc):
            if targets is not None and i not in targets:
                continue
            png = _cleaned_page_png(page, dpi)
            # The pixmap is in display (rotated) space while insertion uses
            # unrotated page coordinates, so rotate the image back by the
            # page's own rotation and fit it into the media box.
            page.insert_image(
                page.mediabox,
                stream=png,
                rotate=page.rotation,
            )
            processed += 1
        doc.save(output_path, garbage=4, deflate=True, clean=True)
        return {
            "success": True,
            "output": output_path,
            "pagesProcessed": processed,
            "method": "pixel",
        }
    finally:
        doc.close()
