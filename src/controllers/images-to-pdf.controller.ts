import { NextFunction, Request, Response } from "express";
import imagesToPdfService, {
  ImagesToPdfService,
} from "../services/image-to-pdf.service.js";
import { Margin, Orientation, PageSize, PdfConfig } from "../types/pdf.types.js";

export class ImagesToPdfController {
  private readonly service: ImagesToPdfService;

  constructor(service: ImagesToPdfService) {
    this.service = service;
    this.get = this.get.bind(this);
    this.convert = this.convert.bind(this);
  }

  get(_: Request, res: Response, __: NextFunction) {
    return res.render("tools/images-to-pdf", { active: "images" });
  }

  async convert(req: Request, res: Response, next: NextFunction) {
    try {
      const images = req.files as Express.Multer.File[];

      if (!images?.length) {
        return res.status(400).json({
          success: false,
          message: "Please upload at least one image",
        });
      }

      const { pageSize, orientation, margin } = req.body;

      const config: PdfConfig = {
        pageSize,
        orientation,
        margin: Number(margin) as Margin,
      };

      const pdf = await this.service.convertImagesToPdf(images, config);

      res.setHeader("Content-Type", "application/pdf");

      res.setHeader(
        "Content-Disposition",
        'attachment; filename="converted-images.pdf"',
      );
      res.send(pdf);
    } catch (error) {
      next(error);
    }
  }
}

export default new ImagesToPdfController(imagesToPdfService);
