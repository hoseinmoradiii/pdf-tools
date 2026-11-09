# Paperwork

A web app with three document tools:

1. **Images to PDF**: combine JPG, PNG or WebP files into one PDF, in the order you choose.
2. **Remove watermark**: strip a watermark from a PDF and get a clean copy.
3. **PDF to Word**: convert a PDF into an editable `.docx` file.

Built with Express.js and TypeScript using an MVC structure. Server-rendered views use EJS. CPU-heavy work runs in worker threads and Python subprocesses so the web server stays responsive.

## Tech stack

| Area          | Choice                                            |
| ------------- | ------------------------------------------------- |
| Runtime       | Node.js 22+                                       |
| Language      | TypeScript (compiled with `tsc`)                  |
| Web framework | Express.js                                        |
| Views         | EJS + express-ejs-layouts                         |
| Uploads       | multer (disk storage, 25 MB limit)                |
| Concurrency   | `worker_threads` + subprocess semaphore           |
| PDF (Node)    | pdf-lib, pdfkit                                   |
| PDF engines   | Python 3.12: PyMuPDF, pdf2docx, OCRmyPDF, LibreOffice |
| Logging       | Winston                                           |
| Container     | Docker (multi-stage, non-root)                    |

## Project structure

```
src/
├── app.ts                     # Express setup, middleware, graceful shutdown
├── routes/                    # Page routes + /health
├── controllers/               # Request handling, file download, cleanup
├── services/                  # Conversion orchestration (spawn workers/CLI)
├── workers/                   # worker_threads entry points (pdf-lib, pdfkit)
├── middlewares/               # request logging, error handling
├── configs/                   # multer, winston
├── python-engine/             # Python conversion scripts + requirements.txt
├── views/                     # EJS layout, partials, tool pages
└── utils/                     # concurrency limiter
```

## Endpoints

| Method | Path                | Purpose                                            |
| ------ | ------------------- | -------------------------------------------------- |
| GET    | `/`                 | Home                                               |
| GET    | `/health`           | Health check                                       |
| GET    | `/images-to-pdf`    | Tool page                                          |
| POST   | `/images-to-pdf`    | `images[]` + page options → PDF download           |
| GET    | `/remove-watermark` | Tool page                                          |
| POST   | `/remove-watermark` | `pdf`, `watermarkText`, `pages` → PDF download     |
| GET    | `/pdf-to-word`      | Tool page                                          |
| POST   | `/pdf-to-word`      | `pdf`, `lang` → `.docx` download                   |

## Getting started

### With Docker (recommended)

Requires Docker only — the image contains Node.js, Python 3.12, LibreOffice, Tesseract and all other dependencies.

```
docker build -t pdf-tools .
docker run -p 3000:3000 pdf-tools
```

Then open http://localhost:3000.

The container runs as a non-root user, exposes a `/health` endpoint used by its built-in health check, and needs no environment variables. To change the port, pass `-e PORT=8080` and map it accordingly.

### Without Docker

Prerequisites: Node.js 22+, Python 3.12 with `venv`, LibreOffice (`soffice`), Tesseract, Ghostscript and qpdf.

```
npm install
npm run build
src/python-engine/.venv/bin/pip install -r src/python-engine/requirements.txt
npm start
```

If the virtualenv lives elsewhere, the services expect it at `src/python-engine/.venv`. Copy `.env.example` to `.env` to configure `PORT` (default 3002) and optionally `TRUST_PROXY=true`.

## How it works

- **Images to PDF** — uploaded images are sent to a `worker_threads` worker that builds the PDF with pdfkit, keeping the event loop free.
- **Remove watermark** — a pdf-lib worker strips matching vector text and stamp annotations first; if nothing is removed (corner stamps, raster watermarks, rotated translucent text), a PyMuPDF script takes over.
- **PDF to Word** — a Python pipeline converts with pdf2docx, applies RTL/bidi fixes for Persian/Arabic text, renders both editable and page-image candidates, and keeps the editable `.docx` only if it matches the source at ~95% visual fidelity (otherwise it returns exact page images).

Concurrency is bounded by semaphores so simultaneous uploads can't exhaust CPU or spawn unlimited subprocesses. Temporary files are deleted after each request, and a periodic sweep removes orphans.

## Responsible use

Only remove watermarks from documents you own or have permission to edit.

## License

MIT
