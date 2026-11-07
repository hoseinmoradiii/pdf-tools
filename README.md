# Paperwork

A small web app with three document tools:

1. **Images to PDF**: combine JPG, PNG or WebP files into one PDF, in the order you choose.
2. **Remove watermark**: strip a watermark from a PDF and get a clean copy.
3. **PDF to Word**: convert a PDF into an editable `.docx` file.

Built with Express.js using an MVC structure. Server-rendered views use EJS. Heavy conversions run in a pool of Node.js worker threads so the web server stays responsive.

## Tech stack

| Area          | Choice                                |
| ------------- | ------------------------------------- |
| Runtime       | Node.js 18+                           |
| Web framework | Express.js                            |
| Views         | EJS + express-ejs-layouts             |
| Uploads       | multer                                |
| Concurrency   | `worker_threads` via a pool (piscina) |
| Security      | helmet, express-rate-limit            |

## Project structure

```
src/
├── app.js                    # Express setup, middleware, route mounting
├── server.js                 # Starts the HTTP server and the worker pool
├── config/                   # Env vars, upload limits, storage paths
├── routes/
│   ├── pages.routes.js       # Page routes (render EJS, handle form posts)
│   └── api.routes.js         # JSON API under /api/v1
├── controllers/              # Validate request, call the pool, send response
├── services/                 # Conversion logic (no req/res), run inside workers
├── workers/
│   ├── pool.js               # Creates and exports the worker pool
│   └── worker.js             # Worker entry: routes a task name to a service
├── middlewares/              # upload, validation, rate limit, error handler
├── utils/                    # temp files, cleanup, file type checks
views/                        # EJS layout, partials, pages
public/                       # CSS and client-side JS
storage/                      # uploads/ and outputs/ (gitignored)
```

## Getting started

```bash
npm install
cp .env.example .env
npm run dev
```

Open http://localhost:3000.

Example `.env`:

```
PORT=3000
MAX_UPLOAD_MB=25
MAX_IMAGES=20
OUTPUT_TTL_MINUTES=60
WORKER_THREADS=4
```

## Routes

### Pages

| Method | Path                | Purpose                      |
| ------ | ------------------- | ---------------------------- |
| GET    | `/`                 | Home                         |
| GET    | `/images-to-pdf`    | Tool page                    |
| POST   | `/images-to-pdf`    | Convert and re-render result |
| GET    | `/remove-watermark` | Tool page                    |
| POST   | `/remove-watermark` | Convert and re-render result |
| GET    | `/pdf-to-word`      | Tool page                    |
| POST   | `/pdf-to-word`      | Convert and re-render result |

### JSON API

| Method | Path                       | Body (multipart)                                | Response                            |
| ------ | -------------------------- | ----------------------------------------------- | ----------------------------------- |
| POST   | `/api/v1/images-to-pdf`    | `images[]`, `pageSize`, `orientation`, `margin` | `201 { id, filename, downloadUrl }` |
| POST   | `/api/v1/remove-watermark` | `pdf`, `watermarkText`, `pages`                 | `201 { id, filename, downloadUrl }` |
| POST   | `/api/v1/pdf-to-word`      | `pdf`                                           | `201 { id, filename, downloadUrl }` |
| GET    | `/api/v1/downloads/:id`    | none                                            | File stream                         |

Errors always return `{ "error": { "code": "...", "message": "..." } }`.

## Worker threads

Conversions are CPU-heavy. If they ran on the main thread, one large PDF would block every other request. Each service therefore runs inside a worker thread.

### How it works

```
Request ──► Controller ──► Worker pool ──► Worker thread ──► Service
   ▲                            │                               │
   └────────── response ◄───────┴──────── result (file path) ◄──┘
```

1. The upload middleware saves files to `storage/uploads/` under random UUID names.
2. The controller sends a task to the pool with **file paths**, not file contents. Passing paths avoids copying large buffers between threads.
3. A free worker runs the matching service, writes the result to `storage/outputs/`, and returns the output path.
4. The controller replies with a download link, and the input files are deleted.
5. If every worker is busy, tasks wait in the pool's queue.

### Pool (`src/workers/pool.js`)

```js
const path = require("path");
const Piscina = require("piscina");

module.exports = new Piscina({
  filename: path.join(__dirname, "worker.js"),
  maxThreads: Number(process.env.WORKER_THREADS) || 4,
});
```

### Worker entry (`src/workers/worker.js`)

```js
const imagesToPdf = require("../services/imagesToPdf.service");
const removeWatermark = require("../services/watermark.service");
const pdfToWord = require("../services/pdfToWord.service");

const tasks = { imagesToPdf, removeWatermark, pdfToWord };

module.exports = async ({ task, input }) => {
  if (!tasks[task]) throw new Error(`Unknown task: ${task}`);
  return tasks[task](input); // returns { outputPath, filename }
};
```

### Using it in a controller

```js
const pool = require("../workers/pool");

exports.imagesToPdf = async (req, res, next) => {
  try {
    const result = await pool.run({
      task: "imagesToPdf",
      input: {
        files: req.files.map((f) => f.path), // already in the user's chosen order
        pageSize: req.body.pageSize,
        orientation: req.body.orientation,
        margin: Number(req.body.margin),
      },
    });
    res
      .status(201)
      .json({
        id: result.id,
        filename: result.filename,
        downloadUrl: `/api/v1/downloads/${result.id}`,
      });
  } catch (err) {
    next(err);
  }
};
```

### Notes

- **Pool size:** start with the number of CPU cores minus one, and tune from there.
- **Timeouts:** wrap long tasks with a timeout so one bad file cannot hold a worker forever.
- **Errors:** an exception inside a worker rejects the promise returned by `pool.run`, so your error middleware handles it as usual.
- **External tools:** if a service shells out to a program such as LibreOffice or a Python script, use `child_process` inside the worker. Worker threads help with JavaScript CPU work, not with waiting on another process.
- **Scaling later:** if conversions get slow, return `202 Accepted` with a job ID and let the client poll `GET /api/v1/jobs/:id`. The pool can then be replaced by a queue such as BullMQ without changing the routes.

## Security and housekeeping

- Uploads are renamed to random UUIDs. Client filenames are never used on disk.
- File type is checked by MIME type and by magic bytes, not by extension.
- Size and file-count limits are enforced by multer.
- `helmet` sets security headers. `express-rate-limit` protects the POST routes.
- A scheduled cleanup deletes uploads immediately after processing and outputs after `OUTPUT_TTL_MINUTES`.

## Responsible use

Only remove watermarks from documents you own or have permission to edit.

## License

MIT
