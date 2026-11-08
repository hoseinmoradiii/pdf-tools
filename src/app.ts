import express, { Express } from "express";
import router from "./routes/index.js";
import { logger } from "./configs/winston.config.js";
import expressLayouts from "express-ejs-layouts";
import dotenv from "dotenv";
import path from "path";
import { errorMiddleware } from "./middlewares/error.middleware.js";

dotenv.config();

function bootstrap() {
  const app: Express = express();

  app.set("view engine", "ejs");
  app.set("views", path.join(process.cwd(), "src", "views"));
  app.use(expressLayouts);
  app.set("layout", path.join(process.cwd(), "src", "views", "layouts/main"));
  app.use(express.static(path.join(process.cwd(), "public")));

  app.use(router);
  app.use(errorMiddleware);

  const PORT = process.env.PORT || 3002;
  app.listen(PORT, () => {
    logger.info(`application is running on port ${PORT}`);
  });
}

bootstrap();
