import shutil

from docx import Document
from docxcompose.composer import Composer


def merge_documents(
    input_files: list[str],
    output_path: str,
):
    if not input_files:
        raise ValueError("No documents to merge.")

    if len(input_files) == 1:
        shutil.copy2(input_files[0], output_path)
        return

    master = Document(input_files[0])
    composer = Composer(master)

    for file_path in input_files[1:]:
        document = Document(file_path)
        composer.append(document)

    composer.save(output_path)