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

    if (!allowedMimeTypes.includes(file.mimetype))
      return cb(new Error("File Type Not Allowed"));

    cb(null, true);
  },
});
