import express, { Express, NextFunction, Request, Response } from "express";
import { logger } from "./configs/winston.config";
import expressLayouts from "express-ejs-layouts";
import router from "./routes";
import dotenv from "dotenv";
import path from "path";

dotenv.config();

function bootstrap() {
  const app: Express = express();

  app.set("view engine", "ejs");
  app.set("views", path.join(process.cwd(), "src", "views"));
  app.use(expressLayouts);
  app.set("layout", path.join(process.cwd(), "src", "views", "layouts/main"));
  app.use(express.static(path.join(process.cwd(), "public")));

  app.use(router);

  const PORT = process.env.PORT || 3002;
  app.listen(PORT, () => {
    logger.info(`application is running on port ${PORT}`);
  });
}

bootstrap();
