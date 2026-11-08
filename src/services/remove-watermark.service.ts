import fs from "fs/promises";
import { spawn } from "child_process";
import path from "path";

export type RemoveWatermarkPages = "all" | "first";

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
  ): Promise<string> {
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

      const timer = setTimeout(() => {
        proc.kill("SIGKILL");
        reject(new Error("Watermark removal timed out"));
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

export default new RemoveWatermarkService();
