const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { Pool, types } = require("pg");

// PostgreSQL COUNT(*) is int8. Convert safe application-sized counts to numbers.
types.setTypeParser(20, (value) => Number.parseInt(value, 10));

let pool;
let database;

function normalizeParams(params) {
  if (params === undefined || params === null) {
    return [];
  }

  return Array.isArray(params) ? params : [params];
}

function convertQuestionMarkPlaceholders(sql) {
  let parameterIndex = 0;

  return String(sql).replace(/\?/g, () => {
    parameterIndex += 1;
    return `$${parameterIndex}`;
  });
}

function addReturningIdToInsert(sql) {
  const trimmedSql = String(sql).trim().replace(/;\s*$/, "");

  if (
    /^INSERT\s+INTO\b/i.test(trimmedSql) &&
    !/\bRETURNING\b/i.test(trimmedSql)
  ) {
    return `${trimmedSql} RETURNING id`;
  }

  return trimmedSql;
}

function createDatabaseAdapter(queryable) {
  return {
    async get(sql, params) {
      const result = await queryable.query(
        convertQuestionMarkPlaceholders(sql),
        normalizeParams(params)
      );

      return result.rows[0];
    },

    async all(sql, params) {
      const result = await queryable.query(
        convertQuestionMarkPlaceholders(sql),
        normalizeParams(params)
      );

      return result.rows;
    },

    async run(sql, params) {
      const normalizedSql = String(sql).trim();

      if (/^(BEGIN|COMMIT|ROLLBACK)\b/i.test(normalizedSql)) {
        throw new Error(
          "Direct transaction commands are disabled. Use withTransaction()."
        );
      }

      const queryText = addReturningIdToInsert(
        convertQuestionMarkPlaceholders(sql)
      );

      const result = await queryable.query(
        queryText,
        normalizeParams(params)
      );

      return {
        lastID: result.rows[0] ? result.rows[0].id : null,
        changes: result.rowCount,
      };
    },

    async exec(sql) {
      return queryable.query(sql);
    },
  };
}

async function ensureAdmin() {
  const adminPhone = process.env.ADMIN_PHONE;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminPhone || !adminPassword) {
    throw new Error(
      "ADMIN_PHONE and ADMIN_PASSWORD are required. No default credentials are allowed."
    );
  }

  const existingAdmin = await database.get(
    "SELECT id FROM users WHERE phone = ?",
    adminPhone
  );

  if (existingAdmin) {
    return;
  }

  const adminPasswordHash = await bcrypt.hash(adminPassword, 10);

  await database.run(
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

  console.log(`Administrator created for configured phone: ${adminPhone}`);
}

async function initDatabase() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required.");
  }

  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl:
      process.env.DATABASE_SSL === "true"
        ? { rejectUnauthorized: false }
        : false,
    max: Number(process.env.DB_POOL_MAX || 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    application_name: "work-order-backend",
  });

  pool.on("error", (error) => {
    console.error("Unexpected PostgreSQL pool error:", error);
  });

  await pool.query("SELECT 1");

  const migrationPath = path.join(
    __dirname,
    "..",
    "migrations",
    "001_initial_schema.sql"
  );

  const migrationSql = fs.readFileSync(migrationPath, "utf8");
  await pool.query(migrationSql);

  database = createDatabaseAdapter(pool);
  await ensureAdmin();

  console.log("PostgreSQL database initialized");
  return database;
}

function getDatabase() {
  if (!database) {
    throw new Error("Database not initialized");
  }

  return database;
}

async function withTransaction(work) {
  if (!pool) {
    throw new Error("Database not initialized");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const transactionDatabase = createDatabaseAdapter(client);
    const result = await work(transactionDatabase);

    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function closeDatabase() {
  if (pool) {
    await pool.end();
    pool = null;
    database = null;
  }
}

module.exports = {
  initDatabase,
  getDatabase,
  withTransaction,
  closeDatabase,
};
