BEGIN;

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  full_name TEXT NOT NULL,
  qid_number TEXT,
  job_title TEXT,
  phone TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'technician',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  reset_otp_hash TEXT,
  reset_otp_expires_at TEXT,
  reset_otp_attempts INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS work_orders (
  id SERIAL PRIMARY KEY,
  local_id TEXT,
  work_order_number TEXT NOT NULL,
  asset_id TEXT,
  notes TEXT,
  technician_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'received',
  submitted_at TEXT,
  received_at TEXT NOT NULL,
  metadata_json TEXT,
  ppt_status TEXT DEFAULT 'not_generated',
  ppt_file_path TEXT,
  email_status TEXT DEFAULT 'not_sent',
  email_sent_at TEXT,
  email_error TEXT,
  is_edited INTEGER NOT NULL DEFAULT 0,
  edited_at TEXT,
  edit_count INTEGER NOT NULL DEFAULT 0,
  last_added_photo_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS work_order_photos (
  id SERIAL PRIMARY KEY,
  work_order_id INTEGER NOT NULL
    REFERENCES work_orders(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  captured_time TEXT,
  display_time TEXT,
  latitude TEXT,
  longitude TEXT,
  original_name TEXT,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  uploaded_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS email_recipients (
  id SERIAL PRIMARY KEY,
  name TEXT,
  email TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ppt_reports (
  id SERIAL PRIMARY KEY,
  work_order_id INTEGER NOT NULL
    REFERENCES work_orders(id) ON DELETE CASCADE,
  ppt_path TEXT,
  status TEXT NOT NULL DEFAULT 'not_generated',
  generated_at TEXT,
  emailed_at TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  action TEXT NOT NULL,
  details TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  id SERIAL PRIMARY KEY,
  setting_key TEXT NOT NULL UNIQUE,
  setting_value TEXT,
  updated_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_work_order_local_upload
  ON work_orders (technician_id, local_id)
  WHERE local_id IS NOT NULL AND local_id <> '';

CREATE INDEX IF NOT EXISTS idx_work_orders_technician_id
  ON work_orders (technician_id);

CREATE INDEX IF NOT EXISTS idx_work_orders_number
  ON work_orders (work_order_number);

CREATE INDEX IF NOT EXISTS idx_work_order_photos_work_order_id
  ON work_order_photos (work_order_id);

CREATE INDEX IF NOT EXISTS idx_ppt_reports_work_order_id
  ON ppt_reports (work_order_id);

CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id
  ON activity_logs (user_id);

COMMIT;
