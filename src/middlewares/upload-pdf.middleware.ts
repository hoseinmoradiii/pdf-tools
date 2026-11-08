import { NextFunction, Request, Response } from "express";
import multer from "multer";
import { uploadConfig } from "../configs/multer.config.js";

export const uploadPdf = (req: Request, res: Response, next: NextFunction) => {
  uploadConfig.single("pdf")(req, res, (err) => {
    if (!err) return next();

    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({
          success: false,
          message: "File size must not exceed 25 MB.",
        });
      }

      if (err.code === "LIMIT_UNEXPECTED_FILE") {
        return res.status(400).json({
          success: false,
          message: "Only one PDF file is allowed.",
        });
      }
    }

    return res.status(400).json({
      success: false,
      message: err.message || "File upload failed",
    });
  });
};
