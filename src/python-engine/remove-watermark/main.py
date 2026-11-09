#!/usr/bin/env python3
"""Remove text / annotation watermarks from a PDF."""

from __future__ import annotations

import json
import sys
from collections import defaultdict

import math

import pymupdf

from pixel_watermark import remove_pixel_watermark


WATERMARK_ANNOT_TYPES = {
    pymupdf.PDF_ANNOT_STAMP,
    pymupdf.PDF_ANNOT_WATERMARK,
}


def _page_indices(doc: pymupdf.Document, pages: str) -> list[int]:
    if pages == "first":
        return [0] if len(doc) else []
    return list(range(len(doc)))


def _search_rects(page: pymupdf.Page, text: str) -> list[pymupdf.Rect]:
    """Find all instances of watermark text (case-insensitive variants)."""
    variants = {text, text.lower(), text.upper(), text.title()}
    rects: list[pymupdf.Rect] = []
    seen: set[tuple[float, float, float, float]] = set()

    for variant in variants:
        if not variant.strip():
            continue
        for rect in page.search_for(variant):
            key = (round(rect.x0, 1), round(rect.y0, 1), round(rect.x1, 1), round(rect.y1, 1))
            if key in seen:
                continue
            seen.add(key)
            rects.append(rect)

    return rects


def _remove_annotations(page: pymupdf.Page) -> int:
    removed = 0
    for annot in list(page.annots() or []):
        if annot.type[0] in WATERMARK_ANNOT_TYPES:
            page.delete_annot(annot)
            removed += 1
    return removed


# Auto mode must never destroy the document: a watermark-like span can have
# a bounding box covering most of the page (e.g. rotated stamp text), and
# redacting it would wipe out the real content. Skip oversized rects and
# bail out on a page when the total redaction area gets too large.
MAX_RECT_PAGE_RATIO = 0.15
MAX_TOTAL_PAGE_RATIO = 0.25


def _rect_area(rect: pymupdf.Rect) -> float:
    return max(0.0, rect.x1 - rect.x0) * max(0.0, rect.y1 - rect.y0)


def _clamp_to_page(rect: pymupdf.Rect, page_rect: pymupdf.Rect) -> pymupdf.Rect | None:
    clipped = pymupdf.Rect(
        max(rect.x0, page_rect.x0),
        max(rect.y0, page_rect.y0),
        min(rect.x1, page_rect.x1),
        min(rect.y1, page_rect.y1),
    )
    if clipped.is_empty:
        return None
    return clipped


def _quad_area(quad: pymupdf.Quad) -> float:
    """True polygon area — Quad.rect is the axis-aligned bbox, which for
    rotated stamps is a huge overestimate."""
    pts = [quad.ul, quad.ur, quad.lr, quad.ll]
    area = 0.0
    for i in range(4):
        x1, y1 = pts[i].x, pts[i].y
        x2, y2 = pts[(i + 1) % 4].x, pts[(i + 1) % 4].y
        area += x1 * y2 - x2 * y1
    return abs(area) / 2.0


def _redact_items(
    page: pymupdf.Page,
    rects: list[pymupdf.Rect],
    quads: list[pymupdf.Quad] | None = None,
) -> int:
    """Redact rects (white-filled) plus oriented quads (unfilled).

    Quads get no fill so that content painted underneath — typically a
    scanned page image — remains visible after the watermark text object
    is stripped. Rects keep the white fill for ordinary vector documents.
    """
    if not rects and not quads:
        return 0
    page_rect = page.rect
    page_area = abs(page_rect) or 1.0
    kept: list[pymupdf.Rect] = []
    total_area = 0.0
    for rect in rects:
        clipped = _clamp_to_page(rect, page_rect)
        if clipped is None:
            kept.append(pymupdf.Rect(rect))
            continue
        area = _rect_area(clipped)
        if area > page_area * MAX_RECT_PAGE_RATIO:
            continue
        kept.append(clipped)
        total_area += area
    kept_quads = list(quads or [])
    # Area cap applies to the sum of both item types so a page can't be
    # gutted by an over-eager detection pass.
    quad_area = sum(_quad_area(q) for q in kept_quads)
    if total_area + quad_area > page_area * MAX_TOTAL_PAGE_RATIO:
        kept = []
        kept_quads = []
    for rect in kept:
        padded = pymupdf.Rect(rect)
        padded.x0 -= 1
        padded.y0 -= 1
        padded.x1 += 1
        padded.y1 += 1
        page.add_redact_annot(padded, fill=(1, 1, 1))
    for quad in kept_quads:
        page.add_redact_annot(quad)
    if kept or kept_quads:
        page.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_NONE)
    return len(kept) + len(kept_quads)


# --- Rotated / translucent stamp detection -------------------------------
#
# Some watermarks are vector text drawn at an angle with reduced opacity
# on top of a scanned page image (e.g. 'USLCA SAMPLE DOCUMENT'). Their
# axis-aligned bbox spans most of the page, so they can't go through the
# rect path — instead we redact one tight oriented quad per character.


def _trace_text(span: dict) -> str:
    parts: list[str] = []
    for char in span.get("chars") or []:
        try:
            parts.append(chr(int(char[0])))
        except (TypeError, ValueError, IndexError):
            continue
    return "".join(parts)


def _trace_spans(page: pymupdf.Page) -> list[dict]:
    return [
        span
        for span in page.get_texttrace()
        if span.get("chars") and len(_trace_text(span).strip()) >= 3
    ]


def _trace_signature(span: dict) -> tuple:
    text = " ".join(_trace_text(span).split()).lower()
    bbox = span.get("bbox") or (0, 0, 0, 0)
    return (
        text,
        round(bbox[0] / 10),
        round(bbox[1] / 10),
        round(span.get("size", 0)),
    )


def _is_stamp_trace(span: dict, multi_page: bool) -> bool:
    size = float(span.get("size", 0) or 0)
    opacity = float(span.get("opacity", 1.0) or 1.0)
    direction = span.get("dir") or (1.0, 0.0)
    dx, dy = abs(direction[0]), abs(direction[1])
    rotated = dx > 0.15 and dy > 0.15

    if multi_page:
        # The span already repeats on every page, so allow bolder calls:
        # translucent text, large rotated text, or very large stamps.
        return (
            opacity <= 0.9
            or (rotated and size >= 36)
            or size >= 60
        )
    return (opacity <= 0.85 and size >= 30) or (rotated and size >= 40)


def _char_quads(span: dict) -> list[pymupdf.Quad]:
    """Tight oriented quad per character, following the text direction."""
    chars = span.get("chars") or []
    direction = span.get("dir") or (1.0, 0.0)
    normal = (-direction[1], direction[0])
    height = float(span.get("size", 0) or 0) * (
        float(span.get("ascender", 1.0)) - float(span.get("descender", 0.0))
    )
    if height <= 0:
        height = float(span.get("size", 0) or 0)
    quads: list[pymupdf.Quad] = []
    for i, char in enumerate(chars):
        try:
            ox, oy = char[2]
        except (TypeError, IndexError):
            continue
        if i + 1 < len(chars):
            try:
                nx, ny = chars[i + 1][2]
                width = math.hypot(nx - ox, ny - oy)
            except (TypeError, IndexError):
                width = 0.0
        else:
            width = float(span.get("size", 0) or 0) * 0.5
        if width <= 0:
            continue
        quads.append(
            pymupdf.Quad(
                pymupdf.Point(ox, oy),
                pymupdf.Point(ox + direction[0] * width, oy + direction[1] * width),
                pymupdf.Point(ox + normal[0] * height, oy + normal[1] * height),
                pymupdf.Point(
                    ox + direction[0] * width + normal[0] * height,
                    oy + direction[1] * width + normal[1] * height,
                ),
            )
        )
    return quads


def _auto_quads(
    doc: pymupdf.Document, indices: list[int]
) -> dict[int, list[pymupdf.Quad]]:
    """Detect translucent / rotated stamps repeated across pages."""
    counts: dict[tuple, int] = defaultdict(int)
    spans_per_page: dict[int, list[dict]] = {}
    multi_page = len(indices) > 1

    for i in indices:
        spans = _trace_spans(doc[i])
        spans_per_page[i] = spans
        seen: set[tuple] = set()
        for span in spans:
            sig = _trace_signature(span)
            if sig in seen:
                continue
            seen.add(sig)
            counts[sig] += 1

    result: dict[int, list[pymupdf.Quad]] = {i: [] for i in indices}
    for i in indices:
        for span in spans_per_page[i]:
            sig = _trace_signature(span)
            if multi_page and counts[sig] < len(indices):
                continue
            if not _is_stamp_trace(span, multi_page):
                continue
            result[i].extend(_char_quads(span))
    return result


def _span_signature(span: dict) -> tuple:
    text = " ".join(span.get("text", "").split()).lower()
    bbox = span["bbox"]
    # Quantize position so slight layout drift still matches across pages.
    return (
        text,
        round(bbox[0] / 10),
        round(bbox[1] / 10),
        round(span.get("size", 0)),
    )


def _collect_spans(page: pymupdf.Page) -> list[tuple[tuple, pymupdf.Rect]]:
    spans: list[tuple[tuple, pymupdf.Rect]] = []
    data = page.get_text("dict", flags=pymupdf.TEXT_PRESERVE_WHITESPACE)
    for block in data.get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                text = span.get("text", "").strip()
                if len(text) < 3:
                    continue
                sig = _span_signature(span)
                spans.append((sig, pymupdf.Rect(span["bbox"])))
    return spans


def _is_watermark_like(span: dict, page_rect: pymupdf.Rect) -> bool:
    text = span.get("text", "").strip()
    if len(text) < 3:
        return False

    size = float(span.get("size", 0))
    color = int(span.get("color", 0))
    r = (color >> 16) & 255
    g = (color >> 8) & 255
    b = color & 255
    avg = (r + g + b) / 3
    is_gray = abs(r - g) < 20 and abs(g - b) < 20 and abs(r - b) < 20
    is_light = avg >= 150

    bbox = pymupdf.Rect(span["bbox"])
    page_area = abs(page_rect) or 1.0
    coverage = abs(bbox) / page_area
    span_center = pymupdf.Point(
        bbox.x0 + bbox.width / 2,
        bbox.y0 + bbox.height / 2,
    )
    page_center = pymupdf.Point(
        page_rect.x0 + page_rect.width / 2,
        page_rect.y0 + page_rect.height / 2,
    )
    near_center = abs(span_center - page_center) < max(
        page_rect.width, page_rect.height
    ) * 0.35

    # Auto mode only targets light stamp-style overlays. Dark text is far
    # more likely to be real content (titles, headings), so anything darker
    # must be removed via the explicit watermark-text option.
    if size >= 36 and is_light:
        return True
    if is_gray and is_light and size >= 22 and coverage >= 0.02:
        return True
    if size >= 48 and near_center and is_light:
        return True
    return False


def _is_edge_stamp(span: dict, line: dict, page: pymupdf.Page) -> bool:
    """Small lone-line horizontal text touching a page CORNER.

    Catches corner watermarks like 'iLovePDF' that are too small and too
    dark for the stamp heuristics. Only applied to spans already known to
    repeat verbatim on every page. Requiring two adjacent edges keeps
    headers, footers and table cells (which only touch one edge) safe.
    """
    if len(line.get("spans", [])) != 1:
        return False
    text = span.get("text", "").strip()
    if not any(ch.isalpha() for ch in text):
        return False
    direction = line.get("dir") or [1, 0]
    dx, dy = abs(direction[0]), abs(direction[1])
    if page.rotation in (90, 270):
        dx, dy = dy, dx
    if dy > dx:
        # Vertical text (e.g. rotated labels) is content, not a stamp.
        return False
    page_rect = page.mediabox
    bbox = pymupdf.Rect(span["bbox"])
    page_area = abs(page_rect) or 1.0
    if abs(bbox) > page_area * 0.02:
        return False
    w, h = page_rect.width, page_rect.height
    near_horizontal = (
        bbox.x0 - page_rect.x0 < 0.12 * w
        or page_rect.x1 - bbox.x1 < 0.12 * w
    )
    near_vertical = (
        bbox.y0 - page_rect.y0 < 0.12 * h
        or page_rect.y1 - bbox.y1 < 0.12 * h
    )
    return near_horizontal and near_vertical


def _auto_rects(doc: pymupdf.Document, indices: list[int]) -> dict[int, list[pymupdf.Rect]]:
    """Detect watermarks by visual heuristics, boosted by cross-page repetition."""
    counts: dict[tuple, int] = defaultdict(int)

    for i in indices:
        seen_on_page: set[tuple] = set()
        for sig, _ in _collect_spans(doc[i]):
            if sig in seen_on_page:
                continue
            seen_on_page.add(sig)
            counts[sig] += 1

    threshold = max(2, (len(indices) + 1) // 2) if len(indices) > 1 else 2
    repeated = {sig for sig, n in counts.items() if n >= threshold and sig[0]}
    # Stricter set for the edge-band heuristic: the text must appear on
    # every single page at the same spot.
    edge_repeated = (
        {sig for sig, n in counts.items() if n >= len(indices) and sig[0]}
        if len(indices) > 1
        else set()
    )

    result: dict[int, list[pymupdf.Rect]] = {i: [] for i in indices}
    for i in indices:
        page = doc[i]
        data = page.get_text("dict", flags=pymupdf.TEXT_PRESERVE_WHITESPACE)
        for block in data.get("blocks", []):
            if block.get("type") != 0:
                continue
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    sig = _span_signature(span)
                    watermark_like = _is_watermark_like(span, page.rect)
                    edge_stamp = (
                        sig in edge_repeated
                        and _is_edge_stamp(span, line, page)
                    )
                    if not watermark_like and not edge_stamp:
                        continue
                    if (
                        watermark_like
                        and len(indices) > 1
                        and sig not in repeated
                        # On multi-page docs, prefer stamps that repeat.
                        # Still allow very large single-page stamps.
                        and float(span.get("size", 0)) < 40
                    ):
                        continue
                    result[i].append(pymupdf.Rect(span["bbox"]))
    return result


def remove_watermark(
    input_path: str,
    output_path: str,
    watermark_text: str = "",
    pages: str = "all",
) -> dict:
    doc = pymupdf.open(input_path)
    try:
        indices = _page_indices(doc, pages)
        if not indices:
            raise ValueError("PDF has no pages")

        total_annots = 0
        total_redactions = 0
        text = (watermark_text or "").strip()

        auto_map: dict[int, list[pymupdf.Rect]] = {}
        quad_map: dict[int, list[pymupdf.Quad]] = {}
        if not text:
            auto_map = _auto_rects(doc, indices)
            quad_map = _auto_quads(doc, indices)

        for i in indices:
            page = doc[i]
            total_annots += _remove_annotations(page)

            if text:
                total_redactions += _redact_items(page, _search_rects(page, text))
            else:
                total_redactions += _redact_items(
                    page, auto_map.get(i, []), quad_map.get(i, [])
                )

        if total_annots == 0 and total_redactions == 0:
            # Content-level removal found nothing — the watermark is likely
            # baked into a raster image. Fall back to pixel whitening.
            try:
                result = remove_pixel_watermark(input_path, output_path, indices)
            except Exception:
                # Keep the unmodified document rather than failing.
                doc = pymupdf.open(input_path)
                doc.save(
                    output_path,
                    garbage=4,
                    deflate=True,
                    clean=True,
                )
                return {
                    "success": True,
                    "output": output_path,
                    "pagesProcessed": len(indices),
                    "annotationsRemoved": 0,
                    "redactions": 0,
                }
            return {
                "success": True,
                "output": output_path,
                "pagesProcessed": result["pagesProcessed"],
                "annotationsRemoved": 0,
                "redactions": 0,
                "method": "pixel",
            }

        # Garbage-collect unused objects after redactions.
        doc.save(
            output_path,
            garbage=4,
            deflate=True,
            clean=True,
        )
        return {
            "success": True,
            "output": output_path,
            "pagesProcessed": len(indices),
            "annotationsRemoved": total_annots,
            "redactions": total_redactions,
        }
    finally:
        doc.close()


def main() -> int:
    if len(sys.argv) < 3:
        print(
            json.dumps(
                {
                    "success": False,
                    "error": "Usage: main.py <input.pdf> <output.pdf> [watermarkText] [pages]",
                }
            )
        )
        return 2

    input_path = sys.argv[1]
    output_path = sys.argv[2]
    watermark_text = sys.argv[3] if len(sys.argv) > 3 else ""
    pages = sys.argv[4] if len(sys.argv) > 4 else "all"

    if pages not in ("all", "first"):
        print(json.dumps({"success": False, "error": "pages must be 'all' or 'first'"}))
        return 2

    try:
        result = remove_watermark(input_path, output_path, watermark_text, pages)
        print(json.dumps(result))
        return 0
    except Exception as exc:  # noqa: BLE001 — surface any failure as JSON
        print(json.dumps({"success": False, "error": str(exc)}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
