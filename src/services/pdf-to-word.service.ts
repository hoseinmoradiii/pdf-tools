import { NextFunction, Request, Response } from "express";

export class PdfToWordService {
  get(_: Request, res: Response, __: NextFunction) {
    return res.render("tools/pdf-to-word", { active: "word" });
  }
}

export default new PdfToWordService();
