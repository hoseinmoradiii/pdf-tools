import { NextFunction, Request, Response, Router } from "express";
import pdfToWordRouter from "./pdf-to-word.router";
import imagesToPdfRouter from "./image-to-pdf.router";
import removeWatermarkRouter from "./remove-watermark.router";

const router = Router();

router.get("/", (req: Request, res: Response, next: NextFunction) => {
  res.render("index", { title: "Home" });
});
router.use(pdfToWordRouter);
router.use(imagesToPdfRouter);
router.use(removeWatermarkRouter);

export default router;
