import sys
import os
import json
import shutil
import tempfile
import subprocess
from pdf2docx import Converter

def ocr_pdf(src, dst, lang):
    cmd = [
        sys.executable, "-m", "ocrmypd",
        "--skip-text", "--deskew", "--rotate-pages",
        "--optimize", "0", "-1", lang, src, dst 
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"OCR Failed: {result.stderr.strip()}")
    
def convert(pdf_path, docx_path, lang='eng'):
    tmp_dir = tempfile.mkdtemp(prefix="pdf2word_")
    try:    
        ocr_path= os.path.join(tmp_dir, "ocr.pdf")
        ocr_pdf(pdf_path, ocr_path, lang)
        cv = Converter(ocr_path)
        try:
            cv.convert(docx_path)
        finally:
            cv.close()
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"success": False, "error": "Usage: pdf_to_word.py"}))
        sys.exit(2)
        
    pdf_path, docx_path = sys.argv[1], sys.argv[2]
    lang = sys.argv[3] if len(sys.argv) > 3 else 'eng'
    
    try:
        convert(pdf_path, docx_path, lang)
        print(json.dumps({"success": True, "output": docx_path}))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)