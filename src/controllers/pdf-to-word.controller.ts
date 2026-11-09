import { NextFunction, Request, Response } from "express";
import pdfToWordService, {
  PdfToWordService,
} from "../services/pdf-to-word.service.js";
import { logger } from "../configs/winston.config.js";
import path from "path";

export class PdfToWordController {
  private readonly pdfToWordService: PdfToWordService;

  constructor(pdfToWordService: PdfToWordService) {
    this.pdfToWordService = pdfToWordService;
    this.get = this.get.bind(this);
    this.convert = this.convert.bind(this);
  }

  get(_: Request, res: Response) {
    return res.render("tools/pdf-to-word", { active: "word" });
  }

  async convert(req: Request, res: Response, next: NextFunction) {
    const inputPath = req.file?.path;
    let outputPath: string | undefined;

    try {
      if (!req.file || !inputPath) {
        return res.status(400).json({
          success: false,
          message: "Please upload a PDF file.",
        });
      }

      outputPath = path.join(
        path.dirname(inputPath),
        `${req.file.filename}.docx`,
      );

      const lang =
        typeof req.body.lang === "string" && req.body.lang.trim()
          ? req.body.lang.trim()
          : "eng";

      await this.pdfToWordService.convert(inputPath, outputPath, lang);

      res.download(outputPath!, "converted.docx", async (err) => {
        if (err) logger.error(err);
        await this.pdfToWordService.cleanUp(inputPath, outputPath!);
      });
    } catch (error) {
      await this.pdfToWordService.cleanUp(
        ...[inputPath, outputPath].filter((p): p is string => !!p),
      );
      next(error);
    }
  }
}

export default new PdfToWordController(pdfToWordService);
