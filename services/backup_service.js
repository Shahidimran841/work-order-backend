const fs = require("fs");
const path = require("path");
const archiver = require("archiver");

function ensureBackupFolder() {
  const backupDir = path.join(__dirname, "..", "backups");

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  return backupDir;
}

function createBackupZip() {
  return new Promise((resolve, reject) => {
    const backupDir = ensureBackupFolder();

    const timestamp = new Date()
      .toISOString()
      .replace(/:/g, "-")
      .replace(/\./g, "-");

    const backupFileName = `work_order_backup_${timestamp}.zip`;
    const backupFilePath = path.join(backupDir, backupFileName);

    const output = fs.createWriteStream(backupFilePath);
    const archive = archiver("zip", {
      zlib: { level: 9 },
    });

    output.on("close", () => {
      resolve({
        fileName: backupFileName,
        filePath: backupFilePath,
        size: archive.pointer(),
      });
    });

    archive.on("error", (error) => {
      reject(error);
    });

    archive.pipe(output);

    const databasePath = path.join(
      __dirname,
      "..",
      "database",
      "work_order_app.sqlite"
    );

    const uploadsPath = path.join(__dirname, "..", "uploads");

    if (fs.existsSync(databasePath)) {
      archive.file(databasePath, {
        name: "database/work_order_app.sqlite",
      });
    }

    if (fs.existsSync(uploadsPath)) {
      archive.directory(uploadsPath, "uploads");
    }

    archive.finalize();
  });
}

function getBackupsList() {
  const backupDir = ensureBackupFolder();

  const files = fs
    .readdirSync(backupDir)
    .filter((file) => file.endsWith(".zip"))
    .map((file) => {
      const filePath = path.join(backupDir, file);
      const stats = fs.statSync(filePath);

      return {
        fileName: file,
        filePath,
        size: stats.size,
        createdAt: stats.birthtime,
      };
    })
    .sort((a, b) => b.createdAt - a.createdAt);

  return files;
}

module.exports = {
  createBackupZip,
  getBackupsList,
};