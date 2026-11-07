import { Router } from "express";
import imagesToPdfService from "../services/images-to-pdf.service";

const router = Router();
router.get("/images-to-pdf", imagesToPdfService.get);
export default router;
