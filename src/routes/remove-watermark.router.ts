import { Router } from "express";
import removeWatermarkController from "../controllers/remove-watermark.controller.js";
import { uploadPdf } from "../middlewares/upload-pdf.middleware.js";

const router = Router();

router.get("/remove-watermark", removeWatermarkController.get);
router.post("/remove-watermark", uploadPdf, removeWatermarkController.remove);

export default router;
