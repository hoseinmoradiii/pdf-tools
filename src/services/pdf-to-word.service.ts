import fs from "fs/promises";
import { PythonService } from "./python.service.js";
import { spawn } from "child_process";
import path from "path";

export class PdfToWordService {
  private readonly script = path.resolve(
    process.cwd(),
    "src",
    "python-engine",
    "pdf-to-word",
    "main.py",
  );

  private readonly timeout = 5 * 1000 * 60;

  async convert(
    inputPath: string,
    outputPath: string,
    lang: string = "eng",
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn("python3", [this.script, inputPath, outputPath, lang]);

      let stdout = "";
      let stderr = "";

      const timer = setTimeout(() => {
        proc.kill("SIGKILL");
        reject(new Error("Conversion timed out"));
      }, this.timeout);

      proc.stdout.on("data", (d) => (stdout += d));
      proc.stderr.on("data", (d) => (stderr += d));

      proc.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });

      proc.on("close", (code) => {
        clearTimeout(timer);
        let parsed;
        try {
          parsed = JSON.parse(stdout.trim().split("\n").pop()!);
        } catch {
          parsed = null;
        }
        if (code === 0 && parsed?.success) return resolve(outputPath);
        reject(
          new Error(
            parsed?.error || stderr || `Worker exited with code ${code}`,
          ),
        );
      });
    });
  }

  async cleanUp(...paths: string[]): Promise<void> {
    await Promise.all(paths.map((p) => fs.unlink(p).catch(() => {})));
  }
}

export default new PdfToWordService();
