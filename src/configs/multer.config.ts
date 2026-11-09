import multer from "multer";
import path from "path";
import fs from "fs";

const uploadDir = path.join(process.cwd(), "temp");

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },

  filename: (_req, file, cb) => {
    const name = `${Date.now()}-${crypto.randomUUID()}`;
    cb(null, `${name}${path.extname(file.originalname)}`);
  },
});

const fileFilter: multer.Options["fileFilter"] = (_req, file, cb) => {
  const extension = path.extname(file.originalname).toLowerCase();
  if (file.mimetype !== "application/pdf" || extension !== ".pdf") {
    const error = new Error("Only PDF files are allowed") as Error & {
      status?: number;
    };
    error.status = 400;
    return cb(error);
  }

  cb(null, true);
};

export const uploadConfig = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 25 * 1024 * 1024,
    files: 1,
  },
});
