import multer from "multer";

export const uploadImages = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 20,
  },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = [
      "image/jpeg",
      "image/png",
      "image/jpg",
      "image/webp",
    ];

    if (!allowedMimeTypes.includes(file.mimetype)) {
      const error = new Error("Only JPEG, PNG, and WebP images are allowed") as Error & {
        status?: number;
      };
      error.status = 400;
      return cb(error);
    }

    cb(null, true);
  },
});
