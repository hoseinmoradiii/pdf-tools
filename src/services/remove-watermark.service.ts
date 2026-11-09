import fs from "fs/promises";
import { spawn } from "child_process";
import { Worker } from "node:worker_threads";
import path from "path";
import { fileURLToPath } from "node:url";
import { createLimiter } from "../utils/concurrency.js";

export type RemoveWatermarkPages = "all" | "first";

// Heavy passes (pdf-lib worker + PyMuPDF fallback) — cap concurrency.
const removalLimiter = createLimiter(3);

interface PdfLibResult {
  removed?: number;
  error?: string;
}

export class RemoveWatermarkService {
  private readonly script = path.resolve(
    process.cwd(),
    "src",
    "python-engine",
    "remove-watermark",
    "main.py",
  );

  private readonly pythonBin = path.resolve(
    process.cwd(),
    "src",
    "python-engine",
    ".venv",
    "bin",
    "python3",
  );

  private readonly timeout = 5 * 60 * 1000;

  async remove(
    inputPath: string,
    outputPath: string,
    watermarkText: string = "",
    pages: RemoveWatermarkPages = "all",
  ): Promise<void> {
    return removalLimiter(() =>
      this.removeInternal(inputPath, outputPath, watermarkText, pages),
    );
  }

  private async removeInternal(
    inputPath: string,
    outputPath: string,
    watermarkText: string,
    pages: RemoveWatermarkPages,
  ): Promise<void> {
    let removed = 0;
    try {
      removed = await this.removeWithPdfLib(
        inputPath,
        outputPath,
        watermarkText,
        pages,
      );
    } catch {
      removed = 0;
    }

    if (removed === 0) {
      // pdf-lib only sees vector text in content streams. Watermarks that
      // are corner stamps, raster-baked, or hidden in structures pdf-lib
      // can't parse are handled by the PyMuPDF engine instead.
      await this.removeWithPython(inputPath, outputPath, watermarkText, pages);
    }
  }

  /**
   * pdf-lib pass in a worker thread: strip matching BT…ET text objects and
   * stamp annotations without blocking the event loop.
   */
  private removeWithPdfLib(
    inputPath: string,
    outputPath: string,
    watermarkText: string,
    pages: RemoveWatermarkPages,
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
      const workerPath = path.join(
        currentDirectory,
        "../workers/remove-watermark.worker.js",
      );

      const worker = new Worker(workerPath, {
        workerData: { inputPath, outputPath, watermarkText, pages },
      });

      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };

      const timer = setTimeout(() => {
        finish(() => {
          void worker.terminate();
          reject(new Error("Watermark removal timed out"));
        });
      }, this.timeout);

      worker.on("message", (result: PdfLibResult) => {
        finish(() => {
          if (result.error) reject(new Error(result.error));
          else resolve(result.removed ?? 0);
        });
      });

      worker.on("error", (err) => finish(() => reject(err)));

      worker.on("exit", (code) => {
        finish(() =>
          reject(
            new Error(
              code !== 0
                ? `Watermark worker exited with code ${code}`
                : "Watermark worker exited without a result",
            ),
          ),
        );
      });
    });
  }

  /** PyMuPDF fallback for watermarks pdf-lib can't reach. */
  private removeWithPython(
    inputPath: string,
    outputPath: string,
    watermarkText: string,
    pages: RemoveWatermarkPages,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.pythonBin, [
        this.script,
        inputPath,
        outputPath,
        watermarkText,
        pages,
      ]);

      let stdout = "";
      let stderr = "";

      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };

      const timer = setTimeout(() => {
        finish(() => {
          proc.kill("SIGKILL");
          reject(new Error("Watermark removal timed out"));
        });
      }, this.timeout);

      proc.stdout.on("data", (d) => (stdout += d));
      proc.stderr.on("data", (d) => (stderr += d));

      proc.on("error", (err) => finish(() => reject(err)));

      proc.on("close", (code) => {
        finish(() => {
          let parsed: { success?: boolean; error?: string } | null = null;
          try {
            parsed = JSON.parse(stdout.trim().split("\n").pop()!);
          } catch {
            parsed = null;
          }
          if (code === 0 && parsed?.success) return resolve();
          const message =
            parsed?.error || stderr || `Worker exited with code ${code}`;
          const error = new Error(message) as Error & {
            status?: number;
            clientMessage?: string;
          };
          if (/failed to open|invalid pdf|not a pdf|cannot find document/i.test(message)) {
            error.status = 422;
            error.clientMessage = "The uploaded file is not a valid PDF.";
          }
          reject(error);
        });
      });
    });
  }

  async cleanUp(...paths: string[]): Promise<void> {
    await Promise.all(paths.map((p) => fs.unlink(p).catch(() => {})));
  }
}

export default new RemoveWatermarkService();
