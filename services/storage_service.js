const fs = require("fs");
const path = require("path");

const appRoot = path.join(__dirname, "..");

function getStorageRoot() {
  return process.env.STORAGE_DIR || appRoot;
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function getStoragePath(...segments) {
  const fullPath = path.join(getStorageRoot(), ...segments);
  ensureDir(path.dirname(fullPath));
  return fullPath;
}

function getStorageDir(...segments) {
  const fullPath = path.join(getStorageRoot(), ...segments);
  ensureDir(fullPath);
  return fullPath;
}

function toPublicPath(filePath) {
  return filePath.replace(/\\/g, "/");
}

function getStoredFileAbsolutePath(relativePath) {
  if (!relativePath) return "";

  const normalized = relativePath.replace(/\\/g, "/");

  if (normalized.startsWith("uploads/")) {
    return path.join(getStorageRoot(), normalized);
  }

  return path.join(appRoot, normalized);
}

module.exports = {
  appRoot,
  getStorageRoot,
  getStoragePath,
  getStorageDir,
  toPublicPath,
  getStoredFileAbsolutePath,
};