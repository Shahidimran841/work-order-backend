require("dotenv").config();

const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const { Client } = require("pg");

const TABLES = [
  {
    name: "users",
    columns: [
      "id",
      "full_name",
      "qid_number",
      "job_title",
      "phone",
      "password_hash",
      "role",
      "status",
      "created_at",
      "reset_otp_hash",
      "reset_otp_expires_at",
      "reset_otp_attempts",
    ],
  },
  {
    name: "work_orders",
    columns: [
      "id",
      "local_id",
      "work_order_number",
      "asset_id",
      "notes",
      "technician_id",
      "status",
      "submitted_at",
      "received_at",
      "metadata_json",
      "ppt_status",
      "ppt_file_path",
      "email_status",
      "email_sent_at",
      "email_error",
      "is_edited",
      "edited_at",
      "edit_count",
      "last_added_photo_count",
    ],
  },
  {
    name: "work_order_photos",
    columns: [
      "id",
      "work_order_id",
      "stage",
      "captured_time",
      "display_time",
      "latitude",
      "longitude",
      "original_name",
      "file_name",
      "file_path",
      "uploaded_at",
    ],
  },
  {
    name: "email_recipients",
    columns: [
      "id",
      "name",
      "email",
      "is_active",
      "created_at",
    ],
  },
  {
    name: "ppt_reports",
    columns: [
      "id",
      "work_order_id",
      "ppt_path",
      "status",
      "generated_at",
      "emailed_at",
      "error_message",
      "created_at",
    ],
  },
  {
    name: "activity_logs",
    columns: [
      "id",
      "user_id",
      "action",
      "details",
      "created_at",
    ],
  },
  {
    name: "app_settings",
    columns: [
      "id",
      "setting_key",
      "setting_value",
      "updated_at",
    ],
  },
];

function getPostgresConfig() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is missing from .env");
  }

  return {
    connectionString: process.env.DATABASE_URL,
    ssl:
      process.env.DATABASE_SSL === "true"
        ? { rejectUnauthorized: false }
        : false,
  };
}

function getSqlitePath() {
  const configuredPath =
    process.env.SQLITE_PATH || "./database/work_order_app.sqlite";

  return path.resolve(process.cwd(), configuredPath);
}

function placeholders(count) {
  return Array.from(
    { length: count },
    (_, index) => `$${index + 1}`
  ).join(", ");
}

async function applySchema(client) {
  const schemaPath = path.join(
    __dirname,
    "..",
    "migrations",
    "001_initial_schema.sql"
  );

  const schemaSql = fs.readFileSync(schemaPath, "utf8");
  await client.query(schemaSql);
}

async function assertTargetIsEmpty(client) {
  const nonEmptyTables = [];

  for (const table of TABLES) {
    const result = await client.query(
      `SELECT COUNT(*)::int AS count FROM ${table.name}`
    );

    if (result.rows[0].count !== 0) {
      nonEmptyTables.push(
        `${table.name}=${result.rows[0].count}`
      );
    }
  }

  if (nonEmptyTables.length > 0) {
    throw new Error(
      `PostgreSQL is not empty (${nonEmptyTables.join(
        ", "
      )}). Stop the backend and migrate into a fresh database/volume.`
    );
  }
}

async function assertNoBrokenReferences(sqliteDb) {
  const orphanedWorkOrders = await sqliteDb.get(`
    SELECT COUNT(*) AS count
    FROM work_orders wo
    LEFT JOIN users u ON u.id = wo.technician_id
    WHERE wo.technician_id IS NOT NULL
      AND u.id IS NULL
  `);

  const orphanedPhotos = await sqliteDb.get(`
    SELECT COUNT(*) AS count
    FROM work_order_photos p
    LEFT JOIN work_orders wo ON wo.id = p.work_order_id
    WHERE wo.id IS NULL
  `);

  const orphanedReports = await sqliteDb.get(`
    SELECT COUNT(*) AS count
    FROM ppt_reports p
    LEFT JOIN work_orders wo ON wo.id = p.work_order_id
    WHERE wo.id IS NULL
  `);

  if (
    Number(orphanedWorkOrders.count) > 0 ||
    Number(orphanedPhotos.count) > 0 ||
    Number(orphanedReports.count) > 0
  ) {
    throw new Error(
      [
        "SQLite contains broken foreign-key references.",
        `orphaned work orders: ${orphanedWorkOrders.count}`,
        `orphaned photos: ${orphanedPhotos.count}`,
        `orphaned reports: ${orphanedReports.count}`,
      ].join(" ")
    );
  }
}

async function copyTable(sqliteDb, client, table) {
  const rows = await sqliteDb.all(
    `SELECT ${table.columns.join(", ")}
     FROM ${table.name}
     ORDER BY id ASC`
  );

  const insertSql = `
    INSERT INTO ${table.name} (${table.columns.join(", ")})
    VALUES (${placeholders(table.columns.length)})
  `;

  for (const row of rows) {
    const values = table.columns.map((column) => row[column]);
    await client.query(insertSql, values);
  }

  return rows.length;
}

async function resetSequences(client) {
  const tablesWithSequences = TABLES.map((table) => table.name);

  for (const tableName of tablesWithSequences) {
    await client.query(`
      SELECT setval(
        pg_get_serial_sequence('${tableName}', 'id'),
        COALESCE((SELECT MAX(id) FROM ${tableName}), 1),
        EXISTS(SELECT 1 FROM ${tableName})
      )
    `);
  }
}

async function verifyCounts(sqliteDb, client) {
  const counts = {};

  for (const table of TABLES) {
    const sqliteCount = await sqliteDb.get(
      `SELECT COUNT(*) AS count FROM ${table.name}`
    );

    const postgresCount = await client.query(
      `SELECT COUNT(*)::int AS count FROM ${table.name}`
    );

    const source = Number(sqliteCount.count);
    const target = Number(postgresCount.rows[0].count);

    counts[table.name] = {
      sqlite: source,
      postgres: target,
    };

    if (source !== target) {
      throw new Error(
        `Count mismatch for ${table.name}: SQLite=${source}, PostgreSQL=${target}`
      );
    }
  }

  return counts;
}

async function main() {
  const sqlitePath = getSqlitePath();

  if (!fs.existsSync(sqlitePath)) {
    throw new Error(`SQLite database not found: ${sqlitePath}`);
  }

  const sqliteDb = await open({
    filename: sqlitePath,
    driver: sqlite3.Database,
  });

  const postgresClient = new Client(getPostgresConfig());

  try {
    console.log(`SQLite source: ${sqlitePath}`);
    console.log("Connecting to PostgreSQL...");

    await postgresClient.connect();
    await applySchema(postgresClient);
    await assertTargetIsEmpty(postgresClient);
    await assertNoBrokenReferences(sqliteDb);

    await postgresClient.query("BEGIN");

    const copiedCounts = {};

    for (const table of TABLES) {
      copiedCounts[table.name] = await copyTable(
        sqliteDb,
        postgresClient,
        table
      );

      console.log(
        `Copied ${copiedCounts[table.name]} row(s) from ${table.name}`
      );
    }

    await resetSequences(postgresClient);

    const verifiedCounts = await verifyCounts(
      sqliteDb,
      postgresClient
    );

    await postgresClient.query("COMMIT");

    console.log("Migration committed successfully.");
    console.table(verifiedCounts);
  } catch (error) {
    try {
      await postgresClient.query("ROLLBACK");
    } catch (_) {}

    throw error;
  } finally {
    await sqliteDb.close();
    await postgresClient.end();
  }
}

main().catch((error) => {
  console.error("SQLite to PostgreSQL migration failed:");
  console.error(error);
  process.exit(1);
});
