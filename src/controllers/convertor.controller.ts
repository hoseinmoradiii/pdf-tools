import { Request, Response } from "express";

export class ConvertorController {
  async getHomePage(req: Request, res: Response) {}

  async convertImagesToPdf(req: Request, res: Response) {}

  async deleteWatermark(req: Request, res: Response) {}

  async convertPdfToWord(req: Request, res: Response) {}
}
