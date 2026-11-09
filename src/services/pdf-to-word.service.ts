import fs from "fs/promises";
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
        let parsed: { success?: boolean; error?: string } | null = null;
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
