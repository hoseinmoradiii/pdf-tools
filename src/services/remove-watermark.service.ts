import { NextFunction, Request, Response } from "express";

export class RemoveWatermark {
  get(_: Request, res: Response, __: NextFunction) {
    return res.render("tools/remove-watermark", { active: "watermark" });
  }
}

export default new RemoveWatermark();
