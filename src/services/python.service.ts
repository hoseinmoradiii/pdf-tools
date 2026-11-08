import { spawn } from "node:child_process";
import path from "path";
import fs from "fs";
import { logger } from "../configs/winston.config.js";

export class PythonService {
  private static pythonScript = path.resolve(
    process.cwd(),
    "src",
    "python-engine",
    "pdf-to-word",
    "main.py",
  );

  static async execute(inputPath: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(this.pythonScript))
        logger.error("python script not found");

      const child = spawn(
        "python3",
        [this.pythonScript, "--input", inputPath, "--output", outputPath],
        {
          cwd: path.join(process.cwd(), "src", "python-engine"),
          env: {
            ...process.env,
            PDF_MODE: "ocr",
            VIRTUAL_ENV: path.join(
              process.cwd(),
              "src",
              "python-engine",
              ".venv",
            ),
            PATH: `${path.join(
              process.cwd(),
              "src",
              "python-engine",
              ".venv",
              "bin",
            )}:${process.env.PATH}`,
          },
        },
      );

      let stderr = "";

      child.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      child.on("error", reject);

      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(stderr || `Python exited with code ${code}`));
      });
    });
  }
}
