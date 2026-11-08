import { Worker } from "node:worker_threads";
import { Express } from "express";
import { PdfConfig } from "../types/pdf.types.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface WorkerResult {
  error?: string;
}

export class ImagesToPdfService {
  convertImagesToPdf(
    images: Express.Multer.File[],
    config: PdfConfig,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      // Convert uploaded images into transferable buffers
      const imageBuffers = images.map((image) => Uint8Array.from(image.buffer));

      const transferList = imageBuffers.map(
        (image) => image.buffer as ArrayBuffer,
      );

      // Resolve current directory
      const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

      // Resolve worker JavaScript file
      const workerPath = path.join(
        currentDirectory,
        "../workers/images-to-pdf.worker.js",
      );

      // Create worker thread
      const worker = new Worker(workerPath, {
        workerData: {
          images: imageBuffers,
          config,
        },
        transferList,
      });

      let settled = false;

      const fail = (error: Error) => {
        if (settled) return;

        settled = true;
        reject(error);
      };

      // Receive generated PDF
      worker.on("message", (result: Uint8Array | WorkerResult) => {
        if (settled) return;

        if (result instanceof Uint8Array) {
          settled = true;
          resolve(Buffer.from(result));
          return;
        }

        if (result.error) {
          fail(new Error(result.error));
        }
      });

      // Handle worker errors
      worker.on("error", (error: Error) => {
        console.log(error);

        fail(error);
      });

      // Handle worker termination
      worker.on("exit", (code) => {
        if (code !== 0) {
          fail(new Error(`PDF worker exited with code ${code}`));
        } else if (!settled) {
          fail(new Error("PDF worker exited without returning a result"));
        }
      });
    });
  }
}

export default new ImagesToPdfService();
