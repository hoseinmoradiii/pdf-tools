import fs from "fs/promises";
import { spawn } from "child_process";
import path from "path";
import { createLimiter } from "../utils/concurrency.js";

// Each conversion can spawn Python + LibreOffice + OCRmyPDF — cap
// concurrency so simultaneous uploads can't exhaust the machine.
const conversionLimiter = createLimiter(2);

export class PdfToWordService {
  private readonly script = path.resolve(
    process.cwd(),
    "src",
    "python-engine",
    "pdf-to-word",
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

  private readonly timeout = 10 * 60 * 1000;

  async convert(
    inputPath: string,
    outputPath: string,
    lang: string = "eng",
    mode: string = "editable",
  ): Promise<string> {
    return conversionLimiter(() =>
      this.convertInternal(inputPath, outputPath, lang, mode),
    );
  }

  private convertInternal(
    inputPath: string,
    outputPath: string,
    lang: string,
    mode: string,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(
        this.pythonBin,
        [this.script, inputPath, outputPath, lang, mode],
        {
          cwd: path.dirname(this.script),
          env: {
            ...process.env,
            VIRTUAL_ENV: path.resolve(
              process.cwd(),
              "src",
              "python-engine",
              ".venv",
            ),
            PATH: `${path.dirname(this.pythonBin)}:${process.env.PATH ?? ""}`,
          },
        },
      );

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
          reject(new Error("Conversion timed out"));
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
          if (code === 0 && parsed?.success) return resolve(outputPath);
          const message =
            parsed?.error || stderr || `Worker exited with code ${code}`;
          const error = new Error(message) as Error & {
            status?: number;
            clientMessage?: string;
          };
          // Corrupt/non-PDF uploads are client errors, not server faults.
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

export default new PdfToWordService();
