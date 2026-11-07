import { NextFunction, Request, Response } from "express";

export class ImagesToPdfService {
  get(_: Request, res: Response, __: NextFunction) {
    return res.render("tools/images-to-pdf", { active: "images" });
  }

  convert() {}
}

export default new ImagesToPdfService();
