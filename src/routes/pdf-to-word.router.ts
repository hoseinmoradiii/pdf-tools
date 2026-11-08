import { Router } from "express";
import pdfToWordController from "../controllers/pdf-to-word.controller.js";
import { uploadPdf } from "../middlewares/upload-pdf.middleware.js";

const router = Router();
router.get("/pdf-to-word", pdfToWordController.get);
router.post("/pdf-to-word", uploadPdf, pdfToWordController.convert);

export default router;
