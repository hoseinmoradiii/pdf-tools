import { NextFunction, Request, Response, Router } from "express";
import pdfToWordRouter from "./pdf-to-word.router.js";
import imagesToPdfRouter from "./image-to-pdf.router.js";
import removeWatermarkRouter from "./remove-watermark.router.js";

const router = Router();

router.get("/", (req: Request, res: Response, next: NextFunction) => {
  res.render("index", { title: "Home" });
});

router.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok" });
});
router.use(pdfToWordRouter);
router.use(imagesToPdfRouter);
router.use(removeWatermarkRouter);

export default router;
