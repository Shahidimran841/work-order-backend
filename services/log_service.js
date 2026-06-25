const { getDatabase } = require("../database/db");

async function createActivityLog({ userId = null, action, details = "" }) {
  try {
    const db = getDatabase();

    await db.run(
      `
      INSERT INTO activity_logs (
        user_id,
        action,
        details,
        created_at
      )
      VALUES (?, ?, ?, ?)
      `,
      [
        userId,
        action,
        typeof details === "string" ? details : JSON.stringify(details),
        new Date().toISOString(),
      ]
    );
  } catch (error) {
    console.error("Activity log error:", error.message);
  }
}

module.exports = {
  createActivityLog,
};