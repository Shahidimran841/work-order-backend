const bcrypt = require("bcryptjs");
const path = require("path");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const { getStoragePath } = require("../services/storage_service");

let db;

async function initDatabase() {
  // Step 2 updated: Swapped path.join for getStoragePath
  db = await open({
    filename: getStoragePath("database", "work_order_app.sqlite"),
    driver: sqlite3.Database,
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      qid_number TEXT,
      job_title TEXT,
      phone TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'technician',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS work_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      local_id TEXT,
      work_order_number TEXT NOT NULL,
      asset_id TEXT,
      notes TEXT,
      technician_id INTEGER,
      status TEXT NOT NULL DEFAULT 'received',
      submitted_at TEXT,
      received_at TEXT NOT NULL,
      metadata_json TEXT,
      ppt_status TEXT DEFAULT 'not_generated',
      ppt_file_path TEXT,
      FOREIGN KEY (technician_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS work_order_photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      work_order_id INTEGER NOT NULL,
      stage TEXT NOT NULL,
      captured_time TEXT,
      display_time TEXT,
      latitude TEXT,
      longitude TEXT,
      original_name TEXT,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      uploaded_at TEXT NOT NULL,
      FOREIGN KEY (work_order_id) REFERENCES work_orders(id)
    );

        CREATE TABLE IF NOT EXISTS email_recipients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      email TEXT NOT NULL UNIQUE,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
        CREATE TABLE IF NOT EXISTS ppt_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      work_order_id INTEGER NOT NULL,
      ppt_path TEXT,
      status TEXT NOT NULL DEFAULT 'not_generated',
      generated_at TEXT,
      emailed_at TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (work_order_id) REFERENCES work_orders(id)
    );

    CREATE TABLE IF NOT EXISTS activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      setting_key TEXT NOT NULL UNIQUE,
      setting_value TEXT,
      updated_at TEXT
    );
  `);
  await ensureColumn("email_recipients", "name", "TEXT");
  await ensureColumn("work_orders", "ppt_file_path", "TEXT");
  await ensureColumn("work_orders", "ppt_status", "TEXT DEFAULT 'not_generated'");
  await ensureColumn("work_orders", "email_status", "TEXT DEFAULT 'not_sent'");
  await ensureColumn("work_orders", "email_sent_at", "TEXT");
  await ensureColumn("work_orders", "email_error", "TEXT");
  await ensureColumn("users", "reset_otp_hash", "TEXT");
  await ensureColumn("users", "reset_otp_expires_at", "TEXT");
  await ensureColumn("users", "reset_otp_attempts", "INTEGER DEFAULT 0");
  const adminPhone = process.env.ADMIN_PHONE || "admin";
  const adminPassword = process.env.ADMIN_PASSWORD || "admin123";

  const existingAdmin = await db.get(
    "SELECT * FROM users WHERE phone = ?",
    adminPhone
  );

  if (!existingAdmin) {
    const adminPasswordHash = await bcrypt.hash(adminPassword, 10);

    await db.run(
      `
      INSERT INTO users (
        full_name,
        qid_number,
        job_title,
        phone,
        password_hash,
        role,
        status,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        "System Admin",
        "",
        "Administrator",
        adminPhone,
        adminPasswordHash,
        "admin",
        "approved",
        new Date().toISOString(),
      ]
    );

    console.log(`Default admin created. Phone: ${adminPhone}`);
  }
  console.log("SQLite database initialized");
  return db;
}

function getDatabase() {
  if (!db) {
    throw new Error("Database not initialized");
  }

  return db;
}
async function ensureColumn(tableName, columnName, columnDefinition) {
  const columns = await db.all(`PRAGMA table_info(${tableName})`);
  const exists = columns.some((column) => column.name === columnName);

  if (!exists) {
    await db.run(
      `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`
    );
  }
}

module.exports = {
  initDatabase,
  getDatabase,
};