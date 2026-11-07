import { Router } from "express";
import pdfToWordService from "../services/pdf-to-word.service";

const router = Router();
router.get("/pdf-to-word", pdfToWordService.get);
export default router;
