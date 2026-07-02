const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");

const {
  getStorageDir,
  getStoragePath,
} = require("./storage_service");

function safeTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function deleteZeroSizeBackupFiles(backupsDir) {
  if (!fs.existsSync(backupsDir)) {
    return;
  }

  const files = fs.readdirSync(backupsDir);

  for (const fileName of files) {
    if (!fileName.endsWith(".zip")) {
      continue;
    }

    const filePath = path.join(backupsDir, fileName);
    const stats = fs.statSync(filePath);

    if (stats.size === 0) {
      try {
        fs.unlinkSync(filePath);
      } catch (_) {}
    }
  }
}

async function createBackupZip() {
  const backupsDir = getStorageDir("backups");
  ensureDir(backupsDir);
  deleteZeroSizeBackupFiles(backupsDir);

  const fileName = `work_order_backup_${safeTimestamp()}.zip`;
  const backupPath = path.join(backupsDir, fileName);

  const databasePath = getStoragePath("database", "work_order_app.sqlite");
  const uploadsDir = getStorageDir("uploads");

  console.log("Backup database path:", databasePath);
  console.log("Database exists:", fs.existsSync(databasePath));
  console.log("Backup uploads path:", uploadsDir);
  console.log("Uploads exists:", fs.existsSync(uploadsDir));

  try {
    const zip = new AdmZip();

    if (fs.existsSync(databasePath)) {
      zip.addLocalFile(
        databasePath,
        "database",
        "work_order_app.sqlite"
      );
    }

    if (fs.existsSync(uploadsDir)) {
      zip.addLocalFolder(
        uploadsDir,
        "uploads"
      );
    }

    zip.addFile(
      "backup_info.json",
      Buffer.from(
        JSON.stringify(
          {
            createdAt: new Date().toISOString(),
            databaseIncluded: fs.existsSync(databasePath),
            uploadsIncluded: fs.existsSync(uploadsDir),
            databasePath,
            uploadsDir,
          },
          null,
          2
        )
      )
    );

    zip.writeZip(backupPath);

    if (!fs.existsSync(backupPath)) {
      throw new Error("Backup file was not created.");
    }

    const stats = fs.statSync(backupPath);

    if (stats.size === 0) {
      try {
        fs.unlinkSync(backupPath);
      } catch (_) {}

      throw new Error("Backup ZIP was created but it is empty.");
    }

    return {
      fileName,
      path: backupPath,
      size: stats.size,
      createdAt: new Date(),
    };
  } catch (error) {
    try {
      if (fs.existsSync(backupPath)) {
        fs.unlinkSync(backupPath);
      }
    } catch (_) {}

    throw error;
  }
}

function getBackupsList() {
  const backupsDir = getStorageDir("backups");
  ensureDir(backupsDir);
  deleteZeroSizeBackupFiles(backupsDir);

  const files = fs
    .readdirSync(backupsDir)
    .filter((fileName) => fileName.endsWith(".zip"))
    .map((fileName) => {
      const filePath = path.join(backupsDir, fileName);
      const stats = fs.statSync(filePath);

      return {
        fileName,
        size: stats.size,
        createdAt: stats.birthtime || stats.mtime,
      };
    })
    .filter((backup) => backup.size > 0)
    .sort((a, b) => b.createdAt - a.createdAt);

  return files;
}

module.exports = {
  createBackupZip,
  getBackupsList,
};