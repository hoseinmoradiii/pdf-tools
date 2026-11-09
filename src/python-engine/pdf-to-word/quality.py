"""Fidelity scoring: render DOCX candidates back to PDF and pixel-compare
against the source PDF to decide which conversion to keep."""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile

import fitz
import numpy as np

TARGET_WIDTH = 400


def _page_array(page) -> np.ndarray:
    zoom = TARGET_WIDTH / page.rect.width
    pix = page.get_pixmap(
        matrix=fitz.Matrix(zoom, zoom),
        colorspace=fitz.csGRAY,
        alpha=False,
    )
    return np.frombuffer(pix.samples, dtype=np.uint8).reshape(
        pix.height, pix.width
    )


def _pad_to(arr: np.ndarray, height: int, width: int) -> np.ndarray:
    out = np.full((height, width), 255, dtype=np.uint8)
    out[: arr.shape[0], : arr.shape[1]] = arr
    return out


def fidelity_score(source_pdf: str, rendered_pdf: str) -> float:
    """Mean per-pixel difference (0 = identical) plus a page-count penalty."""
    src = fitz.open(source_pdf)
    rnd = fitz.open(rendered_pdf)
    try:
        count = min(len(src), len(rnd))
        diffs = []
        for i in range(count):
            a = _page_array(src[i])
            b = _page_array(rnd[i])
            h = max(a.shape[0], b.shape[0])
            w = max(a.shape[1], b.shape[1])
            diff = np.abs(
                _pad_to(a, h, w).astype(int) - _pad_to(b, h, w).astype(int)
            ).mean()
            diffs.append(diff / 255.0)
        base = float(np.mean(diffs)) if diffs else 1.0
        mismatch = abs(len(src) - len(rnd)) / max(len(src), len(rnd))
        return base + 0.5 * mismatch
    finally:
        src.close()
        rnd.close()


def render_docx_to_pdf(docx_paths: list[str], out_dir: str) -> dict[str, str]:
    """Convert DOCX files to PDF via LibreOffice. Returns {docx: pdf} for
    the ones that succeeded; empty dict when LibreOffice is unavailable."""
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice or not docx_paths:
        return {}

    profile = tempfile.mkdtemp(prefix="lo_profile_")
    try:
        cmd = [
            soffice,
            f"-env:UserInstallation=file://{profile}",
            "--headless",
            "--norestore",
            "--convert-to",
            "pdf",
            "--outdir",
            out_dir,
            *docx_paths,
        ]
        subprocess.run(cmd, capture_output=True, timeout=300)
    except Exception:
        return {}
    finally:
        shutil.rmtree(profile, ignore_errors=True)

    results = {}
    for docx_path in docx_paths:
        pdf_path = os.path.join(
            out_dir,
            os.path.splitext(os.path.basename(docx_path))[0] + ".pdf",
        )
        if os.path.exists(pdf_path):
            results[docx_path] = pdf_path
    return results
