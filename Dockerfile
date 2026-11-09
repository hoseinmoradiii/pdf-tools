# syntax=docker/dockerfile:1

# ---------- Build stage: compile TypeScript ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---------- Runtime stage ----------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app

# Python engine runtime deps:
#  - libreoffice-writer    : renders .docx back to PDF for quality scoring
#  - tesseract-ocr         : OCRmyPDF language data (eng + fas)
#  - ghostscript, qpdf     : OCRmyPDF / PDF rewriting
#  - python3               : fallback interpreter; the engine venv below is
#                            Python 3.12 installed via uv (requirements are
#                            pinned for 3.12 and bookworm only ships 3.11)
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 \
      libreoffice-writer \
      tesseract-ocr \
      tesseract-ocr-eng \
      tesseract-ocr-fas \
      ghostscript \
      qpdf \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./

# Views are loaded from src/views at runtime; python engine + requirements too.
COPY src/views ./src/views
COPY public ./public
COPY src/python-engine ./src/python-engine

# Services resolve the interpreter as src/python-engine/.venv/bin/python3
# relative to the working directory — build a Python 3.12 venv via uv.
# UV_PYTHON_INSTALL_DIR keeps the base interpreter outside /root so the
# non-root runtime user can execute the venv.
ENV UV_PYTHON_INSTALL_DIR=/opt/uv-python \
    UV_HTTP_TIMEOUT=600
RUN uv python install 3.12 \
 && uv venv --python 3.12 src/python-engine/.venv \
 && uv pip install \
      --python src/python-engine/.venv/bin/python \
      --no-cache \
      -r src/python-engine/requirements.txt

RUN useradd --system --uid 1001 --create-home appuser \
 && mkdir -p temp \
 && chown -R appuser:appuser /app
USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/app.js"]
