import fs from "fs/promises";
import { parentPort, workerData } from "worker_threads";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFObject,
  PDFPage,
  PDFRawStream,
  decodePDFRawStream,
  pdfDocEncodingDecode,
} from "pdf-lib";

// ---------------------------------------------------------------------------
// Content-stream tokenizer
//
// pdf-lib does not parse page content streams, so we do a small hand-rolled
// tokenizer that records the source offset of every token. Tokens keep their
// raw text so untouched regions can be copied back byte-for-byte.
// ---------------------------------------------------------------------------

interface ContentToken {
  start: number;
  end: number;
  kind: "str" | "op" | "other";
  text?: string | undefined;
  op?: string | undefined;
  num?: number | undefined;
}

const isWhite = (c: string) =>
  c === " " || c === "\t" || c === "\n" || c === "\f" || c === "\r" || c === "\0";

const isDelimiter = (c: string) =>
  isWhite(c) ||
  c === "(" ||
  c === ")" ||
  c === "<" ||
  c === ">" ||
  c === "[" ||
  c === "]" ||
  c === "{" ||
  c === "}" ||
  c === "/" ||
  c === "%";

const decodeLiteralBytes = (bytes: number[]): string => {
  const arr = new Uint8Array(bytes);
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = new Uint8Array(arr.length - 2);
    for (let i = 2; i < arr.length; i += 2) {
      swapped[i - 2] = arr[i + 1]!;
      swapped[i - 1] = arr[i]!;
    }
    return Buffer.from(swapped).toString("utf16le");
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return Buffer.from(arr.subarray(2)).toString("utf16le");
  }
  return pdfDocEncodingDecode(arr);
};

const decodeHexText = (hex: string): string => {
  const clean = hex.replace(/\s+/g, "");
  if (!clean) return "";
  try {
    return PDFHexString.of(clean).decodeText();
  } catch {
    const bytes: number[] = [];
    for (let i = 0; i + 1 < clean.length; i += 2) {
      bytes.push(parseInt(clean.slice(i, i + 2), 16));
    }
    return decodeLiteralBytes(bytes);
  }
};

const isNumericWord = (w: string): boolean =>
  /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(w);

function tokenize(content: string): ContentToken[] {
  const tokens: ContentToken[] = [];
  const n = content.length;
  let i = 0;

  const pushOther = (start: number, end: number, num?: number | undefined) =>
    tokens.push({ start, end, kind: "other", num });

  while (i < n) {
    const c = content.charAt(i);
    if (isWhite(c)) {
      i++;
      continue;
    }
    if (c === "%") {
      while (i < n && content.charAt(i) !== "\n" && content.charAt(i) !== "\r") i++;
      continue;
    }
    const start = i;

    if (c === "(") {
      // Literal string: honour escapes and balanced parens.
      i++;
      let depth = 1;
      const bytes: number[] = [];
      while (i < n && depth > 0) {
        const ch = content.charAt(i);
        if (ch === "\\") {
          i++;
          if (i >= n) break;
          const e = content.charAt(i);
          if (e === "n") bytes.push(10);
          else if (e === "r") bytes.push(13);
          else if (e === "t") bytes.push(9);
          else if (e === "b") bytes.push(8);
          else if (e === "f") bytes.push(12);
          else if (e === "(" || e === ")" || e === "\\") bytes.push(e.charCodeAt(0));
          else if (e >= "0" && e <= "7") {
            let digits = e;
            i++;
            for (let k = 0; k < 2 && i < n && content.charAt(i) >= "0" && content.charAt(i) <= "7"; k++) {
              digits += content.charAt(i);
              i++;
            }
            bytes.push(parseInt(digits, 8) & 0xff);
            continue;
          } else if (e === "\n") {
            i++;
            continue;
          } else if (e === "\r") {
            if (content.charAt(i + 1) === "\n") i++;
            i++;
            continue;
          } else bytes.push(e.charCodeAt(0) & 0xff);
          i++;
          continue;
        }
        if (ch === "(") {
          depth++;
          bytes.push(40);
          i++;
          continue;
        }
        if (ch === ")") {
          depth--;
          if (depth > 0) bytes.push(41);
          i++;
          continue;
        }
        bytes.push(ch.charCodeAt(0) & 0xff);
        i++;
      }
      tokens.push({ start, end: i, kind: "str", text: decodeLiteralBytes(bytes) });
      continue;
    }

    if (c === "<") {
      if (content.charAt(i + 1) === "<") {
        // Dictionary: skip to the matching '>>' so strings inside property
        // lists (e.g. /ActualText) are not treated as shown text.
        let j = i + 2;
        let depth = 1;
        while (j < n - 1 && depth > 0) {
          if (content.charAt(j) === "<" && content.charAt(j + 1) === "<") {
            depth++;
            j += 2;
          } else if (content.charAt(j) === ">" && content.charAt(j + 1) === ">") {
            depth--;
            j += 2;
          } else {
            j++;
          }
        }
        pushOther(start, j);
        i = j;
        continue;
      }
      let j = i + 1;
      let hex = "";
      while (j < n && content.charAt(j) !== ">") {
        if (!isWhite(content.charAt(j))) hex += content.charAt(j);
        j++;
      }
      j++; // consume '>'
      tokens.push({ start, end: j, kind: "str", text: decodeHexText(hex) });
      i = j;
      continue;
    }

    if (c === "/") {
      i++;
      while (i < n && !isDelimiter(content.charAt(i))) i++;
      pushOther(start, i);
      continue;
    }

    if (c === "[" || c === "]" || c === "{" || c === "}") {
      pushOther(start, start + 1);
      i = start + 1;
      continue;
    }

    // Bare word: operator keyword, number, or boolean/null.
    while (i < n && !isDelimiter(content.charAt(i))) i++;
    const word = content.slice(start, i);
    if (/^[A-Za-z*'"]+$/.test(word)) {
      tokens.push({ start, end: i, kind: "op", op: word });
      if (word === "ID") {
        // Inline image: the bytes after ID (up to the EI marker) are binary
        // image data, not operators — skip them so they can't be misparsed.
        const rest = content.slice(i);
        const m = /\sEI(?=\s|$)/.exec(rest);
        if (m) {
          const eiEnd = i + m.index + m[0].length;
          tokens.push({ start: i, end: eiEnd, kind: "other" });
          i = eiEnd;
        }
      }
    } else {
      pushOther(start, i, isNumericWord(word) ? Number(word) : undefined);
    }
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Text-object (BT … ET) analysis
// ---------------------------------------------------------------------------

const TEXT_SHOW_OPS = new Set(["Tj", "TJ", "'", '"']);

interface TextBlock {
  delStart: number;
  delEnd: number;
  text: string;
  squash: string;
  size: number;
  rotated: boolean;
}

interface StreamInfo {
  content: string;
  tokens: ContentToken[];
  blocks: TextBlock[];
  rebinds: Array<(ref: PDFObject) => void>;
}

const squashText = (s: string) => s.toLowerCase().replace(/\s+/g, "");

function extractBlocks(content: string, tokens: ContentToken[]): TextBlock[] {
  const blocks: TextBlock[] = [];
  let inBT = false;
  let btStart = -1;
  let btEnd = -1;
  let pending: string[] = [];
  let parts: string[] = [];
  let nums: number[] = [];
  let fontSize = 0;
  let tm: number[] | null = null;

  const flush = () => {
    if (!inBT) return;
    const text = parts.join("");
    const a = tm?.[0] ?? 1;
    const b = tm?.[1] ?? 0;
    const c = tm?.[2] ?? 0;
    const d = tm?.[3] ?? 1;
    const rotated =
      Math.abs(b) > 0.1 ||
      Math.abs(c) > 0.1 ||
      (Math.abs(a) < 0.3 && Math.abs(d) < 0.3);
    blocks.push({
      delStart: tokens[btStart]!.start,
      delEnd: tokens[btEnd]!.end,
      text,
      squash: squashText(text),
      size: fontSize,
      rotated,
    });
  };

  for (let idx = 0; idx < tokens.length; idx++) {
    const t = tokens[idx]!;
    if (t.kind === "str") {
      if (inBT) pending.push(t.text ?? "");
      continue;
    }
    if (t.kind !== "op") {
      if (inBT && t.num !== undefined) {
        nums.push(t.num);
        if (nums.length > 8) nums.shift();
      } else if (inBT) {
        nums = [];
      }
      continue;
    }
    const op = t.op!;
    if (op === "BT") {
      inBT = true;
      btStart = idx;
      pending = [];
      parts = [];
      nums = [];
      fontSize = 0;
      tm = null;
      continue;
    }
    if (!inBT) continue;
    if (op === "ET") {
      btEnd = idx;
      flush();
      inBT = false;
      continue;
    }
    if (op === "Tf" && nums.length) fontSize = nums[nums.length - 1]!;
    if (op === "Tm" && nums.length >= 6) tm = nums.slice(-6);
    if (TEXT_SHOW_OPS.has(op)) {
      if (pending.length) {
        parts.push(pending.join(""));
        pending = [];
      }
    } else {
      pending = [];
    }
    nums = [];
  }
  return blocks;
}

// ---------------------------------------------------------------------------
// Stream collection (page contents + Form XObjects)
// ---------------------------------------------------------------------------

interface StreamEntry {
  stream: PDFRawStream;
  rebind: (ref: PDFObject) => void;
}

const isStream = (o: unknown): o is PDFRawStream =>
  o instanceof PDFRawStream ||
  (o !== null && typeof o === "object" && "dict" in o && "contents" in o);

function decodeStream(stream: PDFRawStream): string | null {
  try {
    const decoded = decodePDFRawStream(stream).decode();
    return Buffer.from(decoded).toString("latin1");
  } catch {
    return null;
  }
}

function collectXObjectStreams(
  resources: PDFObject | undefined,
  doc: PDFDocument,
  visited: Set<unknown>,
  out: StreamEntry[],
): void {
  if (!(resources instanceof PDFDict)) return;
  const xobjects = resources.lookup(PDFName.of("XObject"));
  if (!(xobjects instanceof PDFDict)) return;
  for (const [name, value] of xobjects.entries()) {
    let stream: unknown;
    try {
      stream = doc.context.lookup(value as never);
    } catch {
      continue;
    }
    if (!isStream(stream)) continue;
    const subtype = stream.dict.lookup(PDFName.of("Subtype"));
    if (!(subtype instanceof PDFName) || subtype.asString() !== "Form") continue;
    if (visited.has(stream)) continue;
    visited.add(stream);
    const dict = xobjects;
    out.push({
      stream,
      rebind: (ref) => dict.set(name, ref as never),
    });
    const sub = stream.dict.lookup(PDFName.of("Resources"));
    collectXObjectStreams(sub, doc, visited, out);
  }
}

function collectPageStreams(
  page: PDFPage,
  doc: PDFDocument,
  visited: Set<unknown>,
  out: StreamEntry[],
): void {
  const contents = page.node.lookup(PDFName.of("Contents"));
  if (contents instanceof PDFArray) {
    const arr = contents;
    for (let idx = 0; idx < arr.size(); idx++) {
      const element = arr.get(idx);
      let stream: unknown;
      try {
        stream = doc.context.lookup(element as never);
      } catch {
        continue;
      }
      if (!isStream(stream)) continue;
      if (visited.has(element) || visited.has(stream)) continue;
      visited.add(element);
      visited.add(stream);
      out.push({
        stream,
        rebind: (ref) => arr.set(idx, ref as never),
      });
    }
  } else if (isStream(contents)) {
    if (!visited.has(contents)) {
      visited.add(contents);
      out.push({
        stream: contents,
        rebind: (ref) => page.node.set(PDFName.of("Contents"), ref as never),
      });
    }
  }

  const resources = page.node.lookup(PDFName.of("Resources"));
  collectXObjectStreams(resources, doc, visited, out);
}

// ---------------------------------------------------------------------------
// Matching rules
// ---------------------------------------------------------------------------

const hasLetter = (s: string) => /[a-z]/i.test(s);

const isStampLike = (b: TextBlock) => b.size >= 24 || b.rotated;

function blockMatchesWatermark(block: TextBlock, watermark: string): boolean {
  const wm = squashText(watermark);
  if (!wm) return false;
  if (block.squash === wm) return true;
  // Substring matches are only trusted for stamp-like blocks so a body
  // line that merely contains the word is never removed.
  return block.squash.includes(wm) && isStampLike(block);
}

function removeStampAnnots(page: PDFPage): number {
  const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  if (!annots) return 0;
  const kept: PDFObject[] = [];
  let removed = 0;
  for (let i = 0; i < annots.size(); i++) {
    const dict = annots.lookupMaybe(i, PDFDict);
    const subtype = dict?.lookup(PDFName.of("Subtype"));
    if (
      subtype instanceof PDFName &&
      (subtype.asString() === "Stamp" || subtype.asString() === "Watermark")
    ) {
      removed++;
    } else {
      kept.push(annots.get(i));
    }
  }
  if (removed > 0) {
    const arr = PDFArray.withContext(page.node.context);
    for (const obj of kept) arr.push(obj);
    page.node.set(PDFName.of("Annots"), arr);
  }
  return removed;
}

/**
 * Auto mode: find text blocks that look like stamps (large or rotated)
 * and repeat on (nearly) every selected page.
 */
function detectAutoBlocks(
  pageBlocks: Map<number, TextBlock[]>,
  indices: number[],
): Set<string> {
  const perPage = new Map<number, Map<string, { stamp: boolean }>>();
  for (const idx of indices) {
    const blocks = pageBlocks.get(idx) ?? [];
    const m = new Map<string, { stamp: boolean }>();
    for (const b of blocks) {
      if (!b.squash || b.squash.length < 3 || b.squash.length > 100) continue;
      if (!hasLetter(b.text)) continue;
      if (/^\d+$/.test(b.squash)) continue; // page numbers etc.
      const cur = m.get(b.squash);
      const stamp = isStampLike(b);
      if (cur) cur.stamp = cur.stamp || stamp;
      else m.set(b.squash, { stamp });
    }
    perPage.set(idx, m);
  }

  const n = indices.length;
  const required = n <= 1 ? 1 : Math.max(2, Math.ceil(n / 2));

  const candidates = new Map<string, number>();
  for (const m of perPage.values()) {
    for (const [sq, info] of m) {
      if (!info.stamp) continue;
      candidates.set(sq, (candidates.get(sq) ?? 0) + 1);
    }
  }

  const result = new Set<string>();
  for (const [sq, count] of candidates) {
    if (count >= required) result.add(sq);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

interface WorkerInput {
  inputPath: string;
  outputPath: string;
  watermarkText: string;
  pages: "all" | "first";
}

async function removeWithPdfLib(
  inputPath: string,
  outputPath: string,
  watermarkText: string,
  pages: "all" | "first",
): Promise<number> {
  const input = await fs.readFile(inputPath);
  const doc = await PDFDocument.load(input, { updateMetadata: false });

  const pageCount = doc.getPageCount();
  if (pageCount === 0) throw new Error("PDF has no pages");
  const indices =
    pages === "first" ? [0] : Array.from({ length: pageCount }, (_, i) => i);

  const text = watermarkText.trim();

  const streamMap = new Map<PDFRawStream, StreamInfo>();
  const pageBlocks = new Map<number, TextBlock[]>();
  let removedAnnots = 0;

  for (const pageIdx of indices) {
    const page = doc.getPage(pageIdx);
    removedAnnots += removeStampAnnots(page);

    const visited = new Set<unknown>();
    const entries: StreamEntry[] = [];
    collectPageStreams(page, doc, visited, entries);

    const blocks: TextBlock[] = [];
    for (const entry of entries) {
      let info = streamMap.get(entry.stream);
      if (!info) {
        const content = decodeStream(entry.stream);
        if (content === null) continue;
        const tokens = tokenize(content);
        info = {
          content,
          tokens,
          blocks: extractBlocks(content, tokens),
          rebinds: [],
        };
        streamMap.set(entry.stream, info);
      }
      info.rebinds.push(entry.rebind);
      blocks.push(...info.blocks);
    }
    pageBlocks.set(pageIdx, blocks);
  }

  const autoSquashes = text ? null : detectAutoBlocks(pageBlocks, indices);

  const shouldRemove = (b: TextBlock): boolean => {
    if (text) return blockMatchesWatermark(b, text);
    return !!autoSquashes?.has(b.squash) && isStampLike(b);
  };

  let removedBlocks = 0;
  for (const info of streamMap.values()) {
    const doomed = info.blocks.filter(shouldRemove);
    if (!doomed.length) continue;
    removedBlocks += doomed.length;

    const ranges = doomed
      .map((b) => [b.delStart, b.delEnd] as const)
      .sort((a, b) => b[0] - a[0]);
    let content = info.content;
    for (const [s, e] of ranges) {
      content = content.slice(0, s) + "\n" + content.slice(e);
    }

    const bytes = Buffer.from(content, "latin1");
    const newStream = doc.context.flateStream(bytes);
    const ref = doc.context.register(newStream);
    for (const rebind of info.rebinds) rebind(ref);
  }

  const out = await doc.save();
  await fs.writeFile(outputPath, out);
  return removedBlocks + removedAnnots;
}

async function main(): Promise<void> {
  const input = workerData as WorkerInput;
  const removed = await removeWithPdfLib(
    input.inputPath,
    input.outputPath,
    input.watermarkText,
    input.pages,
  );
  parentPort?.postMessage({ removed });
}

main().catch((err: unknown) => {
  parentPort?.postMessage({
    error: err instanceof Error ? err.message : String(err),
  });
});
