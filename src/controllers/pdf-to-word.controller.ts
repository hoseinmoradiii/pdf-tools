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
    try {
      if (!req.file)
        return res.status(400).render("pages/pdf-to-word", {
          active: "word",
          error: "Please upload a PDF file.",
        });

      const inputPath = req.file.path;
      const outputPath = path.join(
        path.dirname(inputPath),
        `${req.file.filename}.docx`,
      );

      const lang = req.body.lang || "eng";
      await this.pdfToWordService.convert(inputPath, outputPath, lang);
      res.download(outputPath, "converted.docx", async (err) => {
        if (err) logger.error(err);
        await this.pdfToWordService.cleanUp(req.file!.path, outputPath);
      });
    } catch (error) {
      await this.pdfToWordService.cleanUp(req.file!.path);
      next(error);
    }
  }
}

export default new PdfToWordController(pdfToWordService);
