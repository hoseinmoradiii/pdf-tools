import fitz

from pdf2docx import Converter


def convert_digital_page(
    input_path: str,
    page_number: int,
    output_path: str,
):
    temp_pdf = input_path + f".page-{page_number}.pdf"

    source = fitz.open(input_path)
    single_page = fitz.open()

    single_page.insert_pdf(
        source,
        from_page=page_number,
        to_page=page_number,
    )

    single_page.save(temp_pdf)

    single_page.close()
    source.close()

    converter = Converter(temp_pdf)

    try:
        converter.convert(output_path)
    finally:
        converter.close()

        import os
        if os.path.exists(temp_pdf):
            os.remove(temp_pdf)