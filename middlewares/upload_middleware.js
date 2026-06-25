const fs = require("fs");
const path = require("path");
const multer = require("multer");

const uploadDir = path.join(__dirname, "..", "uploads", "work-orders");

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

function isAllowedImage(file) {
  const allowedMimeTypes = [
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "application/octet-stream"
  ];

  const allowedExtensions = [".jpg", ".jpeg", ".png", ".webp"];

  const ext = path.extname(file.originalname || "").toLowerCase();

  return allowedMimeTypes.includes(file.mimetype) || allowedExtensions.includes(ext);
}

const storage = multer.diskStorage({
  destination: function (req, file, callback) {
    callback(null, uploadDir);
  },

  filename: function (req, file, callback) {
    const timestamp = Date.now();
    const random = Math.round(Math.random() * 1e9);

    let ext = path.extname(file.originalname || "").toLowerCase();

    if (!ext) {
      if (file.mimetype === "image/png") ext = ".png";
      else if (file.mimetype === "image/webp") ext = ".webp";
      else ext = ".jpg";
    }

    const fileName = `${timestamp}_${random}${ext}`;

    callback(null, fileName);
  },
});

const fileFilter = function (req, file, callback) {
  console.log("Incoming file:", {
    originalname: file.originalname,
    mimetype: file.mimetype,
    fieldname: file.fieldname,
  });

  if (isAllowedImage(file)) {
    callback(null, true);
  } else {
    callback(
      new Error(`Only image files are allowed. Received: ${file.mimetype}`),
      false
    );
  }
};

const uploadWorkOrderPhotos = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 20 * 1024 * 1024,
  },
});

module.exports = {
  uploadWorkOrderPhotos,
};