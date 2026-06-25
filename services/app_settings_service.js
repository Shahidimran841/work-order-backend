const { getDatabase } = require("../database/db");

const defaultPptSettings = {
  PPT_PROJECT_NAME: process.env.PPT_PROJECT_NAME || "ABC DEF",
  PPT_PROJECT_CODE: process.env.PPT_PROJECT_CODE || "ERTY",

  PPT_SHOW_FOOTER: "true",
  PPT_SHOW_PROJECT_NAME: "true",
  PPT_SHOW_PROJECT_CODE: "true",
  PPT_SHOW_WORK_ORDER_NUMBER: "true",
  PPT_SHOW_PAGE_NUMBER: "true",
};

async function getSetting(key, fallbackValue = "") {
  const db = getDatabase();

  const row = await db.get(
    "SELECT setting_value FROM app_settings WHERE setting_key = ?",
    key
  );

  if (!row) {
    return fallbackValue;
  }

  return row.setting_value;
}

async function setSetting(key, value) {
  const db = getDatabase();

  const existing = await db.get(
    "SELECT * FROM app_settings WHERE setting_key = ?",
    key
  );

  if (existing) {
    await db.run(
      `
      UPDATE app_settings
      SET setting_value = ?, updated_at = ?
      WHERE setting_key = ?
      `,
      [value, new Date().toISOString(), key]
    );
  } else {
    await db.run(
      `
      INSERT INTO app_settings (
        setting_key,
        setting_value,
        updated_at
      )
      VALUES (?, ?, ?)
      `,
      [key, value, new Date().toISOString()]
    );
  }
}

async function getPptSettings() {
  return {
    projectName: await getSetting(
      "PPT_PROJECT_NAME",
      defaultPptSettings.PPT_PROJECT_NAME
    ),

    projectCode: await getSetting(
      "PPT_PROJECT_CODE",
      defaultPptSettings.PPT_PROJECT_CODE
    ),

    showFooter:
      (await getSetting(
        "PPT_SHOW_FOOTER",
        defaultPptSettings.PPT_SHOW_FOOTER
      )) === "true",

    showProjectName:
      (await getSetting(
        "PPT_SHOW_PROJECT_NAME",
        defaultPptSettings.PPT_SHOW_PROJECT_NAME
      )) === "true",

    showProjectCode:
      (await getSetting(
        "PPT_SHOW_PROJECT_CODE",
        defaultPptSettings.PPT_SHOW_PROJECT_CODE
      )) === "true",

    showWorkOrderNumber:
      (await getSetting(
        "PPT_SHOW_WORK_ORDER_NUMBER",
        defaultPptSettings.PPT_SHOW_WORK_ORDER_NUMBER
      )) === "true",

    showPageNumber:
      (await getSetting(
        "PPT_SHOW_PAGE_NUMBER",
        defaultPptSettings.PPT_SHOW_PAGE_NUMBER
      )) === "true",
  };
}

async function updatePptSettings(body) {
  await setSetting("PPT_PROJECT_NAME", body.projectName || "");
  await setSetting("PPT_PROJECT_CODE", body.projectCode || "");

  await setSetting("PPT_SHOW_FOOTER", body.showFooter === "on" ? "true" : "false");

  await setSetting(
    "PPT_SHOW_PROJECT_NAME",
    body.showProjectName === "on" ? "true" : "false"
  );

  await setSetting(
    "PPT_SHOW_PROJECT_CODE",
    body.showProjectCode === "on" ? "true" : "false"
  );

  await setSetting(
    "PPT_SHOW_WORK_ORDER_NUMBER",
    body.showWorkOrderNumber === "on" ? "true" : "false"
  );

  await setSetting(
    "PPT_SHOW_PAGE_NUMBER",
    body.showPageNumber === "on" ? "true" : "false"
  );
}

module.exports = {
  getPptSettings,
  updatePptSettings,
};