#!/usr/bin/env python3
"""Remove text / annotation watermarks from a PDF."""

from __future__ import annotations

import json
import sys
from collections import defaultdict

import pymupdf


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


def _redact_rects(page: pymupdf.Page, rects: list[pymupdf.Rect]) -> int:
    if not rects:
        return 0
    for rect in rects:
        # Slight pad so faint edges of the watermark glyph are covered.
        padded = pymupdf.Rect(rect)
        padded.x0 -= 1
        padded.y0 -= 1
        padded.x1 += 1
        padded.y1 += 1
        page.add_redact_annot(padded, fill=(1, 1, 1))
    page.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_NONE)
    return len(rects)


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

    # Large light-gray overlays (classic stamp) or huge centered text.
    if size >= 36 and (is_light or is_gray):
        return True
    if is_gray and is_light and size >= 22 and coverage >= 0.02:
        return True
    if size >= 48 and near_center:
        return True
    return False


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

    result: dict[int, list[pymupdf.Rect]] = {i: [] for i in indices}
    for i in indices:
        page = doc[i]
        data = page.get_text("dict", flags=pymupdf.TEXT_PRESERVE_WHITESPACE)
        for block in data.get("blocks", []):
            if block.get("type") != 0:
                continue
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    # Repeated body text is common; only redact when it also
                    # looks like a stamp (large / light / gray overlay).
                    if not _is_watermark_like(span, page.rect):
                        continue
                    if len(indices) > 1 and _span_signature(span) not in repeated:
                        # On multi-page docs, prefer stamps that repeat.
                        # Still allow very large single-page stamps.
                        if float(span.get("size", 0)) < 40:
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
        if not text:
            auto_map = _auto_rects(doc, indices)

        for i in indices:
            page = doc[i]
            total_annots += _remove_annotations(page)

            if text:
                total_redactions += _redact_rects(page, _search_rects(page, text))
            else:
                total_redactions += _redact_rects(page, auto_map.get(i, []))

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
