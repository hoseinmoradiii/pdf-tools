import { NextFunction, Request, Response } from "express";
import path from "path";
import removeWatermarkService, {
  RemoveWatermarkPages,
  RemoveWatermarkService,
} from "../services/remove-watermark.service.js";
import { logger } from "../configs/winston.config.js";

export class RemoveWatermarkController {
  private readonly service: RemoveWatermarkService;

  constructor(service: RemoveWatermarkService) {
    this.service = service;
    this.get = this.get.bind(this);
    this.remove = this.remove.bind(this);
  }

  get(_: Request, res: Response) {
    return res.render("tools/remove-watermark", { active: "watermark" });
  }

  async remove(req: Request, res: Response, next: NextFunction) {
    const inputPath = req.file?.path;
    let outputPath: string | undefined;

    try {
      if (!req.file || !inputPath) {
        return res.status(400).json({
          success: false,
          message: "Please upload a PDF file.",
        });
      }

      const watermarkText =
        typeof req.body.watermarkText === "string"
          ? req.body.watermarkText.trim()
          : "";
      const pages: RemoveWatermarkPages =
        req.body.pages === "first" ? "first" : "all";

      outputPath = path.join(
        path.dirname(inputPath),
        `${req.file.filename}-clean.pdf`,
      );

      await this.service.remove(inputPath, outputPath, watermarkText, pages);

      res.download(outputPath!, "no-watermark.pdf", async (err) => {
        if (err) logger.error(err);
        await this.service.cleanUp(inputPath, outputPath!);
      });
    } catch (error) {
      await this.service.cleanUp(
        ...[inputPath, outputPath].filter((p): p is string => !!p),
      );
      next(error);
    }
  }
}

export default new RemoveWatermarkController(removeWatermarkService);
