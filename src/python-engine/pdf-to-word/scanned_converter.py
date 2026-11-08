import fitz

from docx import Document
from docx.shared import Pt


def convert_scanned_page(
    input_path: str,
    page_number: int,
    output_path: str,
):
    pdf = fitz.open(input_path)
    page = pdf[page_number]

    # Render page at 200 DPI
    pixmap = page.get_pixmap(
        dpi=200,
        alpha=False,
    )

    image_path = input_path + f".page-{page_number}.png"

    pixmap.save(image_path)

    document = Document()

    section = document.sections[0]

    section.page_width = Pt(page.rect.width)
    section.page_height = Pt(page.rect.height)

    section.top_margin = Pt(0)
    section.bottom_margin = Pt(0)
    section.left_margin = Pt(0)
    section.right_margin = Pt(0)

    document.add_picture(
        image_path,
        width=Pt(page.rect.width),
        height=Pt(page.rect.height),
    )

    document.save(output_path)

    import os

    os.remove(image_path)
    pdf.close()