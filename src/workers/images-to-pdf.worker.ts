import PDFDocument from "pdfkit";
import { imageSize } from "image-size";
import { parentPort, workerData } from "worker_threads";
import { PdfConfig } from "../types/pdf.types.js";

interface WorkerInput {
  images: Uint8Array[];
  config: PdfConfig;
}

async function generatePdf(
  images: Uint8Array[],
  config: PdfConfig,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    try {
      const pdf = new PDFDocument({
        autoFirstPage: false,
      });

      const chunks: Buffer[] = [];

      pdf.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });

      pdf.on("end", () => {
        const result = Uint8Array.from(Buffer.concat(chunks));
        resolve(result);
      });

      pdf.on("error", reject);

      for (const image of images) {
        const dimensions = imageSize(image);

        const imageWidth = dimensions.width!;
        const imageHeight = dimensions.height!;

        const orientation =
          config.orientation === "auto"
            ? imageWidth > imageHeight
              ? "landscape"
              : "portrait"
            : config.orientation;

        if (config.pageSize === "fit") {
          const landscape = orientation === "landscape";

          const pageWidth = landscape
            ? Math.max(imageWidth, imageHeight)
            : Math.min(imageWidth, imageHeight);

          const pageHeight = landscape
            ? Math.min(imageWidth, imageHeight)
            : Math.max(imageWidth, imageHeight);

          pdf.addPage({
            size: [
              pageWidth + config.margin * 2,
              pageHeight + config.margin * 2,
            ],
            margin: config.margin,
          });
        } else {
          pdf.addPage({
            size: config.pageSize,
            layout: orientation,
            margin: config.margin,
          });
        }

        const pageWidth = pdf.page.width;
        const pageHeight = pdf.page.height;

        const availableWidth = pageWidth - config.margin * 2;

        const availableHeight = pageHeight - config.margin * 2;
        pdf.image(Buffer.from(image), config.margin, config.margin, {
          fit: [availableWidth, availableHeight],
          align: "center",
          valign: "center",
        });
      }

      pdf.end();
    } catch (error) {
      reject(error);
    }
  });
}

async function main() {
  if (!parentPort) {
    throw new Error("Worker parent port is unavailable");
  }

  try {
    const { images, config } = workerData as WorkerInput;

    const result = await generatePdf(images, config);

    parentPort.postMessage(result, [result.buffer as ArrayBuffer]);
  } catch (error) {
    parentPort.postMessage({
      error: error instanceof Error ? error.message : "PDF generation failed",
    });
  }
}

main();
