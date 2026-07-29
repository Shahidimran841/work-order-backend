require("dotenv").config();

const bcrypt = require("bcryptjs");
const { Client } = require("pg");

async function main() {
  const adminPhone = process.env.ADMIN_PHONE;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is missing from .env");
  }

  if (!adminPhone || !adminPassword) {
    throw new Error(
      "ADMIN_PHONE and ADMIN_PASSWORD are required in .env"
    );
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
    const passwordHash = await bcrypt.hash(adminPassword, 12);

    const result = await client.query(
      `
      UPDATE users
      SET password_hash = $1,
          role = 'admin',
          status = 'approved'
      WHERE phone = $2
      `,
      [passwordHash, adminPhone]
    );

    if (result.rowCount === 0) {
      throw new Error(
        `No user found with ADMIN_PHONE=${adminPhone}`
      );
    }

    console.log(
      `Administrator password reset successfully for ${adminPhone}`
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
