import { Request, Response, NextFunction } from "express";
import multer from "multer";
import { logger } from "../configs/winston.config.js";

export function errorMiddleware(
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (res.headersSent) {
    return next(error);
  }

  if (error instanceof multer.MulterError) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }

  const status = (error as { status?: number }).status;
  if (typeof status === "number" && status >= 400 && status < 500) {
    logger.warn("client error", {
      message: error.message,
      status,
      path: req.originalUrl,
      method: req.method,
    });
    return res.status(status).json({
      success: false,
      message:
        (error as { clientMessage?: string }).clientMessage ?? error.message,
    });
  }

  logger.error("unhandled error", {
    message: error.message,
    stack: error.stack,
    path: req.originalUrl,
    method: req.method,
  });

  return res.status(500).json({
    success: false,
    message: "Internal server error",
  });
}
