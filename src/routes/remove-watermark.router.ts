import { Router } from "express";
import removeWatermarkService from "../services/remove-watermark.service";

const router = Router();
router.get("/remove-watermark", removeWatermarkService.get);
export default router;
