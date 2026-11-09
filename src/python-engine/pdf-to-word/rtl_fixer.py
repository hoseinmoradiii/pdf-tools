import re

from docx.oxml.ns import qn


# Hebrew, Arabic, Syriac, Arabic Supplement/Extended, and the Arabic
# Presentation Forms blocks.
RTL_CHAR_RE = re.compile(
    "[\\u0590-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF]"
)


def _paragraph_text(p_element) -> str:
    return "".join(
        t.text or ""
        for t in p_element.iter(qn("w:t"))
    )


def _set_paragraph_bidi(p_element) -> None:
    p_pr = p_element.find(qn("w:pPr"))
    if p_pr is None:
        p_pr = p_element.makeelement(qn("w:pPr"), {})
        p_element.insert(0, p_pr)
    if p_pr.find(qn("w:bidi")) is not None:
        return
    bidi = p_pr.makeelement(qn("w:bidi"), {})
    # w:bidi must appear before w:sectPr in the pPr sequence.
    sect_pr = p_pr.find(qn("w:sectPr"))
    if sect_pr is not None:
        sect_pr.addprevious(bidi)
    else:
        p_pr.append(bidi)


def _set_run_rtl(r_element) -> None:
    r_pr = r_element.find(qn("w:rPr"))
    if r_pr is None:
        r_pr = r_element.makeelement(qn("w:rPr"), {})
        r_element.insert(0, r_pr)
    if r_pr.find(qn("w:rtl")) is not None:
        return
    # w:rtl must come after the other rPr children.
    r_pr.append(r_pr.makeelement(qn("w:rtl"), {}))


def apply_rtl(document) -> None:
    """Mark paragraphs/runs containing RTL text so Word renders them correctly.

    Works on the raw XML so it also covers paragraphs nested inside tables
    and text boxes, which python-docx's paragraph API does not reach.
    """
    for p_element in document.element.body.iter(qn("w:p")):
        text = _paragraph_text(p_element)
        if not text or not RTL_CHAR_RE.search(text):
            continue
        _set_paragraph_bidi(p_element)
        for r_element in p_element.iter(qn("w:r")):
            # Only direct runs of this paragraph, not runs inside nested
            # structures; w:r cannot nest, so all w:r descendants belong
            # to this paragraph's content (incl. hyperlinks).
            _set_run_rtl(r_element)
