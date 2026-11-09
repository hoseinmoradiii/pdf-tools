#!/usr/bin/env python3
"""Convert a PDF to a layout-preserving DOCX."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile

from analyzer import analyze_pdf
from docx import Document
from pdf2docx import Converter
from quality import fidelity_score, render_docx_to_pdf
from rtl_fixer import apply_rtl
from scanned_converter import convert_scanned_page
from docx_builder import merge_documents


# Tuned for closer visual match to the source PDF.
CONVERT_SETTINGS = {
    "multi_processing": False,
    "ignore_page_error": True,
    "clip_image_res_ratio": 4.0,
    "parse_lattice_table": True,
    "parse_stream_table": True,
    "extract_stream_table": True,
    "delete_end_line_hyphen": False,
    "min_section_height": 10.0,
    "page_margin_factor_top": 1.0,
    "page_margin_factor_bottom": 1.0,
    "float_image_ignorable_gap": 2.0,
    "line_break_width_ratio": 0.9,
    "line_break_free_space_ratio": 0.05,
    "new_paragraph_free_space_ratio": 0.7,
}


def ocr_pdf(src: str, dst: str, lang: str) -> None:
    """Add a text layer without rewriting into PDF/A (keeps layout closer)."""
    cmd = [
        sys.executable,
        "-m",
        "ocrmypdf",
        "--skip-text",
        "--deskew",
        "--rotate-pages",
        "--optimize",
        "0",
        "--output-type",
        "pdf",
        "-l",
        lang,
        src,
        dst,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(
            f"OCR failed: {result.stderr.strip() or result.stdout.strip()}"
        )


def convert_with_pdf2docx(pdf_path: str, docx_path: str) -> None:
    converter = Converter(pdf_path)
    try:
        converter.convert(docx_path, **CONVERT_SETTINGS)
    finally:
        converter.close()


def convert_as_page_images(pdf_path: str, docx_path: str) -> None:
    """Fallback that preserves exact page visuals as images in Word."""
    pages = analyze_pdf(pdf_path)
    tmp_dir = tempfile.mkdtemp(prefix="pdf2word_img_")
    try:
        parts: list[str] = []
        for page in pages:
            part = os.path.join(tmp_dir, f"page-{page['page_number']}.docx")
            convert_scanned_page(pdf_path, page["page_number"], part)
            parts.append(part)
        merge_documents(parts, docx_path)
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


# The editable pdf2docx output is preferred, but only when it is visually
# close to the source. PAGE_IMAGE output must beat it by this margin (and
# the editable score must exceed EDITABLE_MAX_SCORE) to be chosen instead.
EDITABLE_MAX_SCORE = 0.15
EDITABLE_MARGIN = 0.02

# In "editable" mode the editable document must render at least this close
# to the source PDF (~95% overlap), otherwise the faithful page-image
# version is returned instead.
EDITABLE_GATE_SCORE = 0.05


def _apply_rtl(docx_path: str) -> None:
    """pdf2docx drops bidi metadata, so RTL text (e.g. Persian/Arabic PDFs)
    renders mirrored in Word. Restore it on the finished document."""
    try:
        document = Document(docx_path)
        apply_rtl(document)
        document.save(docx_path)
    except Exception:
        pass


def _pick_best(
    source_pdf: str,
    editable_docx: str,
    image_docx: str,
    tmp_dir: str,
) -> str:
    """Render both candidates back to PDF and keep the one that matches the
    source best. Prefers the editable document unless the page-image version
    is clearly more faithful. Falls back to page images when scoring is not
    possible (e.g. LibreOffice missing)."""
    rendered = render_docx_to_pdf([editable_docx, image_docx], tmp_dir)
    editable_pdf = rendered.get(editable_docx)
    image_pdf = rendered.get(image_docx)
    if not editable_pdf or not image_pdf:
        return image_docx

    editable_score = fidelity_score(source_pdf, editable_pdf)
    image_score = fidelity_score(source_pdf, image_pdf)

    if (
        editable_score <= EDITABLE_MAX_SCORE
        or editable_score <= image_score + EDITABLE_MARGIN
    ):
        return editable_docx
    return image_docx


def _gate_editable(
    source_pdf: str,
    editable_docx: str,
    image_docx: str,
    tmp_dir: str,
) -> str:
    """Return the editable docx only when it matches the source PDF closely
    enough (>= ~95%); otherwise return the faithful page-image version."""
    rendered = render_docx_to_pdf([editable_docx], tmp_dir)
    editable_pdf = rendered.get(editable_docx)
    if not editable_pdf:
        return image_docx
    if fidelity_score(source_pdf, editable_pdf) <= EDITABLE_GATE_SCORE:
        return editable_docx
    return image_docx


def convert(
    pdf_path: str,
    docx_path: str,
    lang: str = "eng",
    mode: str = "editable",
) -> None:
    pages = analyze_pdf(pdf_path)
    if not pages:
        raise ValueError("PDF has no pages")

    digital_count = sum(1 for page in pages if page["type"] == "digital")
    scanned_count = len(pages) - digital_count

    tmp_dir = tempfile.mkdtemp(prefix="pdf2word_")
    try:
        working_pdf = pdf_path

        # Only OCR when most pages are image-only. Running OCR/Ghostscript on
        # digital PDFs flattens fonts/vectors and makes Word diverge badly.
        if scanned_count > 0 and scanned_count >= digital_count:
            ocr_path = os.path.join(tmp_dir, "ocr.pdf")
            try:
                ocr_pdf(pdf_path, ocr_path, lang)
                working_pdf = ocr_path
            except Exception:
                # Exact visual fallback if OCR tooling fails.
                convert_as_page_images(pdf_path, docx_path)
                return

        editable_path = os.path.join(tmp_dir, "editable.docx")
        image_path = os.path.join(tmp_dir, "pages.docx")

        want_editable = mode in ("auto", "editable")
        want_image = mode in ("auto", "editable", "faithful")

        # Candidate 1: editable text via pdf2docx.
        ok_editable = False
        if want_editable:
            try:
                convert_with_pdf2docx(working_pdf, editable_path)
                ok_editable = (
                    os.path.exists(editable_path)
                    and os.path.getsize(editable_path) >= 2048
                )
            except Exception:
                ok_editable = False
            if ok_editable:
                _apply_rtl(editable_path)

        # Candidate 2: each page as an image — exact visual match.
        ok_image = False
        if want_image:
            try:
                convert_as_page_images(pdf_path, image_path)
                ok_image = (
                    os.path.exists(image_path)
                    and os.path.getsize(image_path) >= 2048
                )
            except Exception:
                ok_image = False

        if mode == "editable":
            if ok_editable and ok_image:
                best = _gate_editable(
                    pdf_path, editable_path, image_path, tmp_dir
                )
            elif ok_editable:
                best = editable_path
            else:
                best = None
        elif mode == "faithful":
            best = image_path if ok_image else None
        elif ok_editable and ok_image:
            best = _pick_best(pdf_path, editable_path, image_path, tmp_dir)
        elif ok_editable:
            best = editable_path
        elif ok_image:
            best = image_path
        else:
            best = None

        if best is None and mode in ("editable", "faithful"):
            # The requested mode failed; produce the other representation
            # rather than failing the whole conversion.
            if mode == "editable" and not ok_image:
                try:
                    convert_as_page_images(pdf_path, image_path)
                    ok_image = os.path.getsize(image_path) >= 2048
                except Exception:
                    ok_image = False
            elif mode == "faithful" and not ok_editable:
                try:
                    convert_with_pdf2docx(working_pdf, editable_path)
                    ok_editable = (
                        os.path.exists(editable_path)
                        and os.path.getsize(editable_path) >= 2048
                    )
                    if ok_editable:
                        _apply_rtl(editable_path)
                except Exception:
                    ok_editable = False
            best = (
                editable_path
                if ok_editable
                else image_path
                if ok_image
                else None
            )

        if best is None:
            raise RuntimeError("PDF to Word conversion failed")

        shutil.move(best, docx_path)
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def main() -> int:
    if len(sys.argv) < 3:
        print(
            json.dumps(
                {
                    "success": False,
                    "error": "Usage: main.py <input.pdf> <output.docx> [lang] [mode]",
                }
            )
        )
        return 2

    pdf_path, docx_path = sys.argv[1], sys.argv[2]
    lang = sys.argv[3] if len(sys.argv) > 3 else "eng"
    mode = sys.argv[4] if len(sys.argv) > 4 else "editable"

    try:
        convert(pdf_path, docx_path, lang, mode)
        print(json.dumps({"success": True, "output": docx_path}))
        return 0
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"success": False, "error": str(exc)}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
