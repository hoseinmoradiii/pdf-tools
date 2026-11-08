import fitz


def analyze_pdf(input_path: str) -> list[dict]:
    doc = fitz.open(input_path)

    pages = []

    for index, page in enumerate(doc):
        text = page.get_text("text").strip()

        # Initial classification heuristic
        text_length = len("".join(text.split()))

        page_type = (
            "digital"
            if text_length >= 30
            else "scanned"
        )

        pages.append({
            "page_number": index,
            "type": page_type,
            "width": page.rect.width,
            "height": page.rect.height,
        })

    doc.close()

    return pages