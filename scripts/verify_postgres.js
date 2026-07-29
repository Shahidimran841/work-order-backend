require("dotenv").config();

const { Client } = require("pg");

const TABLES = [
  "users",
  "work_orders",
  "work_order_photos",
  "email_recipients",
  "ppt_reports",
  "activity_logs",
  "app_settings",
];

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is missing from .env");
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl:
      process.env.DATABASE_SSL === "true"
        ? { rejectUnauthorized: false }
        : false,
  });

  await client.connect();

  try {
    const connection = await client.query(`
      SELECT
        current_database() AS database,
        current_user AS user_name,
        version() AS version
    `);

    console.log(connection.rows[0]);

    const counts = {};

    for (const table of TABLES) {
      const result = await client.query(
        `SELECT COUNT(*)::int AS count FROM ${table}`
      );

      counts[table] = result.rows[0].count;
    }

    console.table(counts);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
