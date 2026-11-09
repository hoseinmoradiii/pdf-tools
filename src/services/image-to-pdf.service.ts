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

      const toError = (message: string) => {
        const error = new Error(message) as Error & {
          status?: number;
          clientMessage?: string;
        };
        // Undecodable/corrupt uploads are client errors, not server faults.
        if (
          /unsupported|invalid|corrupt|decode|failed to (read|load|open)/i.test(
            message,
          )
        ) {
          error.status = 422;
          error.clientMessage = "One or more uploaded images could not be read.";
        }
        return error;
      };

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        void worker.terminate();
        reject(toError("Image-to-PDF conversion timed out"));
      }, 2 * 60 * 1000);

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };

      const fail = (error: Error) => finish(() => reject(error));

      // Receive generated PDF
      worker.on("message", (result: Uint8Array | WorkerResult) => {
        finish(() => {
          if (result instanceof Uint8Array) {
            resolve(Buffer.from(result));
            return;
          }

          if (result.error) {
            reject(toError(result.error));
          }
        });
      });

      // Handle worker errors
      worker.on("error", fail);

      // Handle worker termination
      worker.on("exit", (code) => {
        finish(() =>
          reject(
            code !== 0
              ? toError(`PDF worker exited with code ${code}`)
              : toError("PDF worker exited without returning a result"),
          ),
        );
      });
    });
  }
}

export default new ImagesToPdfService();
