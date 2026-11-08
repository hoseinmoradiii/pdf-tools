import { Router } from "express";
import imagesToPdfController from "../controllers/images-to-pdf.controller.js";
import { uploadImages } from "../configs/upload-images.config.js";

const router = Router();
router.get("/images-to-pdf", imagesToPdfController.get);
router.post(
  "/images-to-pdf",
  uploadImages.array("images", 20),
  imagesToPdfController.convert,
);
export default router;
