import express, { Express } from "express";
import type { Server } from "node:http";
import fs from "fs/promises";
import path from "path";
import router from "./routes/index.js";
import { logger } from "./configs/winston.config.js";
import expressLayouts from "express-ejs-layouts";
import dotenv from "dotenv";
import { errorMiddleware } from "./middlewares/error.middleware.js";
import { requestLogger } from "./middlewares/request-logger.middleware.js";

dotenv.config();

const PORT = Number(process.env.PORT) || 3002;
// Long-running conversions (pdf-to-word can take several minutes) need a
// request timeout above the service-level timeouts.
const REQUEST_TIMEOUT_MS = 15 * 60 * 1000;
// Uploads/outputs are deleted after each request; this sweeps files orphaned
// by crashes, killed processes, or client disconnects.
const TEMP_MAX_AGE_MS = 2 * 60 * 60 * 1000;

async function sweepTempDir() {
  const tempDir = path.join(process.cwd(), "temp");
  const cutoff = Date.now() - TEMP_MAX_AGE_MS;
  try {
    for (const entry of await fs.readdir(tempDir)) {
      const filePath = path.join(tempDir, entry);
      const stat = await fs.stat(filePath).catch(() => null);
      if (stat && stat.mtimeMs < cutoff) {
        await fs.unlink(filePath).catch(() => {});
      }
    }
  } catch {
    // temp dir missing or unreadable — nothing to sweep
  }
}

function securityHeaders(
  _req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  next();
}

function bootstrap() {
  const app: Express = express();

  app.disable("x-powered-by");
  if (process.env.TRUST_PROXY === "true") app.set("trust proxy", 1);

  app.set("view engine", "ejs");
  app.set("views", path.join(process.cwd(), "src", "views"));
  app.use(expressLayouts);
  app.set("layout", path.join(process.cwd(), "src", "views", "layouts/main"));

  app.use(securityHeaders);
  app.use(requestLogger);
  app.use(express.static(path.join(process.cwd(), "public")));

  app.use(router);
  app.use(errorMiddleware);

  const server: Server = app.listen(PORT, () => {
    logger.info(`application is running on port ${PORT}`, {
      env: process.env.NODE_ENV ?? "development",
    });
  });

  server.requestTimeout = REQUEST_TIMEOUT_MS;
  server.headersTimeout = 65_000;
  server.keepAliveTimeout = 65_000;

  const shutdown = (signal: string) => {
    logger.info(`${signal} received, shutting down gracefully`);
    server.close(() => {
      logger.info("server closed");
      process.exit(0);
    });
    // Force exit if connections don't drain in time.
    setTimeout(() => {
      logger.error("graceful shutdown timed out, forcing exit");
      process.exit(1);
    }, 30_000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  process.on("uncaughtException", (error) => {
    logger.error("uncaught exception", { message: error.message, stack: error.stack });
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    logger.error("unhandled rejection", {
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });

  void sweepTempDir();
  setInterval(() => void sweepTempDir(), 60 * 60 * 1000).unref();
}

bootstrap();
