import { NextFunction, Request, Response } from "express";
import { logger } from "../configs/winston.config.js";

export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const start = Date.now();
  const meta = {
    method: req.method,
    path: req.originalUrl,
    ip: req.ip,
  };

  logger.info("request received", meta);

  res.on("finish", () => {
    const durationMs = Date.now() - start;
    const result = { ...meta, status: res.statusCode, durationMs };

    if (res.statusCode >= 500) {
      logger.error("request failed", result);
    } else if (res.statusCode >= 400) {
      logger.warn("request rejected", result);
    } else {
      logger.info("request completed", result);
    }
  });

  next();
}
