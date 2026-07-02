const fs = require("fs");
const path = require("path");
const archiver = require("archiver");

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

async function createBackupZip() {
  const backupsDir = getStorageDir("backups");
  ensureDir(backupsDir);

  const fileName = `work_order_backup_${safeTimestamp()}.zip`;
  const backupPath = path.join(backupsDir, fileName);

  const databasePath = getStoragePath("database", "work_order_app.sqlite");
  const uploadsDir = getStorageDir("uploads");

  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(backupPath);

    const archive = archiver("zip", {
      zlib: {
        level: 9,
      },
    });

    output.on("close", () => {
      const stats = fs.statSync(backupPath);

      if (stats.size === 0) {
        try {
          fs.unlinkSync(backupPath);
        } catch (_) {}

        return reject(new Error("Backup ZIP was created but it is empty."));
      }

      return resolve({
        fileName,
        path: backupPath,
        size: stats.size,
        createdAt: new Date(),
      });
    });

    output.on("error", (error) => {
      try {
        if (fs.existsSync(backupPath)) {
          fs.unlinkSync(backupPath);
        }
      } catch (_) {}

      return reject(error);
    });

    archive.on("error", (error) => {
      try {
        if (fs.existsSync(backupPath)) {
          fs.unlinkSync(backupPath);
        }
      } catch (_) {}

      return reject(error);
    });

    archive.pipe(output);

    if (fs.existsSync(databasePath)) {
      archive.file(databasePath, {
        name: "database/work_order_app.sqlite",
      });
    }

    if (fs.existsSync(uploadsDir)) {
      archive.directory(uploadsDir, "uploads");
    }

    archive.append(
      JSON.stringify(
        {
          createdAt: new Date().toISOString(),
          databaseIncluded: fs.existsSync(databasePath),
          uploadsIncluded: fs.existsSync(uploadsDir),
        },
        null,
        2
      ),
      {
        name: "backup_info.json",
      }
    );

    archive.finalize();
  });
}

function getBackupsList() {
  const backupsDir = getStorageDir("backups");
  ensureDir(backupsDir);

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
const zeroSizeFiles = fs
  .readdirSync(backupsDir)
  .filter((fileName) => fileName.endsWith(".zip"))
  .filter((fileName) => {
    const filePath = path.join(backupsDir, fileName);
    return fs.statSync(filePath).size === 0;
  });

for (const fileName of zeroSizeFiles) {
  try {
    fs.unlinkSync(path.join(backupsDir, fileName));
  } catch (_) {}
}
  return files;
}

module.exports = {
  createBackupZip,
  getBackupsList,
};