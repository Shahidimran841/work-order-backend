
const { createActivityLog } = require("../services/log_service");

const {
  getPptSettings,
  updatePptSettings,
} = require("../services/app_settings_service");
const { createBackupZip, getBackupsList } = require("../services/backup_service");
const { sendPptReportEmail } = require("../services/email_service");
const { generatePptForWorkOrder } = require("../services/ppt_service");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");

const { getDatabase } = require("../database/db");

function getPublicFileUrl(filePath) {
  const normalizedPath = String(filePath || "").replace(/\\/g, "/");
  return `${process.env.BASE_URL}/${normalizedPath}`;
}

function safeFolderName(value) {
  return String(value || "unknown")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[\\/:*?"<>|]/g, "_");
}

async function moveAdminUploadedFileToOrganizedFolder({
  file,
  technicianId,
  workOrderNumber,
  stage,
}) {
  const safeTechnician = safeFolderName(technicianId);
  const safeWorkOrder = safeFolderName(workOrderNumber);
  const safeStage = safeFolderName(stage);

  const targetDir = path.join(
    __dirname,
    "..",
    "uploads",
    "work-orders",
    safeTechnician,
    safeWorkOrder,
    safeStage
  );

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const oldPath = file.path;
  const newPath = path.join(targetDir, file.filename);

  fs.renameSync(oldPath, newPath);

  return path.relative(path.join(__dirname, ".."), newPath);
}

function showLoginPage(req, res) {
  return res.render("admin/login", {
    error: null,
  });
}

async function loginAdmin(req, res) {
  try {
    const { phone, password } = req.body;

    const db = getDatabase();

    const admin = await db.get(
      "SELECT * FROM users WHERE phone = ? AND role = 'admin'",
      phone
    );

    if (!admin) {
      return res.render("admin/login", {
        error: "Invalid admin phone or password",
      });
    }

    const passwordMatched = await bcrypt.compare(
      password,
      admin.password_hash
    );

    if (!passwordMatched) {
      return res.render("admin/login", {
        error: "Invalid admin phone or password",
      });
    }

    req.session.adminUser = {
      id: admin.id,
      name: admin.full_name,
      phone: admin.phone,
      role: admin.role,
    };

    return res.redirect("/admin");
  } catch (error) {
    return res.render("admin/login", {
      error: error.message,
    });
  }
}

function logoutAdmin(req, res) {
  req.session.destroy(() => {
    return res.redirect("/admin/login");
  });
}

async function dashboard(req, res) {
  const db = getDatabase();

  const totalTechnicians = await db.get(
    "SELECT COUNT(*) AS count FROM users WHERE role = 'technician'"
  );

  const pendingTechnicians = await db.get(
    "SELECT COUNT(*) AS count FROM users WHERE role = 'technician' AND status = 'pending'"
  );

  const totalWorkOrders = await db.get(
    "SELECT COUNT(*) AS count FROM work_orders"
  );

  const totalPhotos = await db.get(
    "SELECT COUNT(*) AS count FROM work_order_photos"
  );

  const recentWorkOrders = await db.all(`
    SELECT
      wo.*,
      u.full_name AS technician_name,
      u.phone AS technician_phone,
      COUNT(wop.id) AS photo_count
    FROM work_orders wo
    LEFT JOIN users u ON wo.technician_id = u.id
    LEFT JOIN work_order_photos wop ON wo.id = wop.work_order_id
    GROUP BY wo.id
    ORDER BY wo.id DESC
    LIMIT 10
  `);

  return res.render("admin/dashboard", {
    admin: req.session.adminUser,
    stats: {
      totalTechnicians: totalTechnicians.count,
      pendingTechnicians: pendingTechnicians.count,
      totalWorkOrders: totalWorkOrders.count,
      totalPhotos: totalPhotos.count,
    },
    recentWorkOrders,
  });
}

async function techniciansPage(req, res) {
  const db = getDatabase();

  const technicians = await db.all(`
    SELECT
      id,
      full_name,
      qid_number,
      job_title,
      phone,
      status,
      created_at
    FROM users
    WHERE role = 'technician'
    ORDER BY id DESC
  `);

  return res.render("admin/technicians", {
    admin: req.session.adminUser,
    technicians,
  });
}

async function approveTechnician(req, res) {
  const { id } = req.params;
  const db = getDatabase();

  await db.run(
    "UPDATE users SET status = 'approved' WHERE id = ? AND role = 'technician'",
    id
  );
    await createActivityLog({
    userId: req.session.adminUser.id,
    action: "TECHNICIAN_APPROVED",
    details: `Technician ID ${id} approved`,
  });
  

  return res.redirect("/admin/technicians");
}

async function rejectTechnician(req, res) {
  const { id } = req.params;
  const db = getDatabase();

  await db.run(
    "UPDATE users SET status = 'rejected' WHERE id = ? AND role = 'technician'",
    id
  );
  await createActivityLog({
    userId: req.session.adminUser.id,
    action: "TECHNICIAN_REJECTED",
    details: `Technician ID ${id} rejected`,
  });
  return res.redirect("/admin/technicians");
}

async function workOrdersPage(req, res) {
  const db = getDatabase();

  const { status = "", technician = "", search = "" } = req.query;

  let sql = `
    SELECT
      wo.*,
      u.full_name AS technician_name,
      u.phone AS technician_phone,
      COUNT(wop.id) AS photo_count
    FROM work_orders wo
    LEFT JOIN users u ON wo.technician_id = u.id
    LEFT JOIN work_order_photos wop ON wo.id = wop.work_order_id
    WHERE 1 = 1
  `;

  const params = [];

  if (status) {
    sql += " AND wo.status = ?";
    params.push(status);
  }

  if (technician) {
    sql += " AND wo.technician_id = ?";
    params.push(technician);
  }

  if (search) {
    sql += " AND (wo.work_order_number LIKE ? OR wo.asset_id LIKE ?)";
    params.push(`%${search}%`, `%${search}%`);
  }

  sql += `
    GROUP BY wo.id
    ORDER BY wo.id DESC
  `;

  const workOrders = await db.all(sql, params);

  const technicians = await db.all(`
    SELECT id, full_name, phone
    FROM users
    WHERE role = 'technician'
    ORDER BY full_name ASC
  `);

  return res.render("admin/work_orders", {
    admin: req.session.adminUser,
    workOrders,
    technicians,
    filters: {
      status,
      technician,
      search,
    },
  });
}

async function workOrderDetailsPage(req, res) {
  const db = getDatabase();
  const { id } = req.params;

  const workOrder = await db.get(
    `
    SELECT
      wo.*,
      u.full_name AS technician_name,
      u.phone AS technician_phone,
      u.job_title AS technician_job_title
    FROM work_orders wo
    LEFT JOIN users u ON wo.technician_id = u.id
    WHERE wo.id = ?
    `,
    id
  );

  if (!workOrder) {
    return res.status(404).send("Work order not found");
  }

  const photos = await db.all(
    `
    SELECT *
    FROM work_order_photos
    WHERE work_order_id = ?
    ORDER BY
      CASE
        WHEN stage = 'Before' THEN 1
        WHEN stage = 'During' THEN 2
        WHEN stage = 'After' THEN 3
        WHEN stage = 'Progress' THEN 4
        ELSE 5
      END,
      id ASC
    `,
    id
  );

  const photosWithUrls = photos.map((photo) => {
    return {
      ...photo,
      url: getPublicFileUrl(photo.file_path),
    };
  });

  const groupedPhotos = {
    Before: photosWithUrls.filter((photo) => photo.stage === "Before"),
    During: photosWithUrls.filter((photo) => photo.stage === "During"),
    After: photosWithUrls.filter((photo) => photo.stage === "After"),
    Progress: photosWithUrls.filter((photo) => photo.stage === "Progress"),
    Other: photosWithUrls.filter(
      (photo) =>
        !["Before", "During", "After", "Progress"].includes(photo.stage)
    ),
  };

  return res.render("admin/work_order_details", {
    admin: req.session.adminUser,
    workOrder,
    groupedPhotos,
    totalPhotos: photosWithUrls.length,
  });
}

async function deleteWorkOrderPhoto(req, res) {
  const db = getDatabase();
  const { workOrderId, photoId } = req.params;

  const photo = await db.get(
    "SELECT * FROM work_order_photos WHERE id = ? AND work_order_id = ?",
    [photoId, workOrderId]
  );

  if (!photo) {
    return res.redirect(`/admin/work-orders/${workOrderId}`);
  }

  const absolutePath = path.join(__dirname, "..", photo.file_path);

  if (fs.existsSync(absolutePath)) {
    fs.unlinkSync(absolutePath);
  }

  await db.run("DELETE FROM work_order_photos WHERE id = ?", photoId);

    await createActivityLog({
    userId: req.session.adminUser.id,
    action: "PHOTO_DELETED",
    details: `Photo ID ${photoId} deleted from Work Order ID ${workOrderId}`,
  });

  return res.redirect(`/admin/work-orders/${workOrderId}`);
}

async function addMorePhotos(req, res) {
  const db = getDatabase();
  const { workOrderId } = req.params;
  const { stage = "Progress" } = req.body;

  const workOrder = await db.get(
    "SELECT * FROM work_orders WHERE id = ?",
    workOrderId
  );

  if (!workOrder) {
    return res.status(404).send("Work order not found");
  }

  const files = req.files || [];

  for (const file of files) {
    const relativePath = await moveAdminUploadedFileToOrganizedFolder({
      file,
      technicianId: workOrder.technician_id || "unknown",
      workOrderNumber: workOrder.work_order_number,
      stage,
    });

    await db.run(
      `
      INSERT INTO work_order_photos (
        work_order_id,
        stage,
        captured_time,
        display_time,
        latitude,
        longitude,
        original_name,
        file_name,
        file_path,
        uploaded_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        workOrderId,
        stage,
        new Date().toISOString(),
        new Date().toLocaleString(),
        "",
        "",
        file.originalname,
        file.filename,
        relativePath,
        new Date().toISOString(),
      ]
    );
  }

  await db.run(
    "UPDATE work_orders SET ppt_status = 'needs_regeneration' WHERE id = ?",
    workOrderId
  );
  await createActivityLog({
    userId: req.session.adminUser.id,
    action: "PHOTOS_ADDED",
    details: `${files.length} photo(s) added to Work Order ID ${workOrderId}`,
  });
  return res.redirect(`/admin/work-orders/${workOrderId}`);
}

async function emailRecipientsPage(req, res) {
  const db = getDatabase();

  const recipients = await db.all(`
    SELECT *
    FROM email_recipients
    ORDER BY id DESC
  `);

  return res.render("admin/email_recipients", {
    admin: req.session.adminUser,
    recipients,
    error: null,
  });
}

async function addEmailRecipient(req, res) {
  const db = getDatabase();
  const { name, email } = req.body;

  if (!email) {
    const recipients = await db.all("SELECT * FROM email_recipients ORDER BY id DESC");

    return res.render("admin/email_recipients", {
      admin: req.session.adminUser,
      recipients,
      error: "Email is required",
    });
  }

  try {
    await db.run(
      `
      INSERT INTO email_recipients (
        name,
        email,
        is_active,
        created_at
      )
      VALUES (?, ?, ?, ?)
      `,
      [name || "", email, 1, new Date().toISOString()]
    );

    return res.redirect("/admin/email-recipients");
  } catch (error) {
    const recipients = await db.all("SELECT * FROM email_recipients ORDER BY id DESC");

    return res.render("admin/email_recipients", {
      admin: req.session.adminUser,
      recipients,
      error: "Email already exists or could not be added",
    });
  }
}

async function toggleEmailRecipient(req, res) {
  const db = getDatabase();
  const { id } = req.params;

  const recipient = await db.get("SELECT * FROM email_recipients WHERE id = ?", id);

  if (!recipient) {
    return res.redirect("/admin/email-recipients");
  }

  const newStatus = recipient.is_active === 1 ? 0 : 1;

  await db.run(
    "UPDATE email_recipients SET is_active = ? WHERE id = ?",
    [newStatus, id]
  );

  return res.redirect("/admin/email-recipients");
}

async function deleteEmailRecipient(req, res) {
  const db = getDatabase();
  const { id } = req.params;

  await db.run("DELETE FROM email_recipients WHERE id = ?", id);

  return res.redirect("/admin/email-recipients");
}

async function generatePpt(req, res) {
  const db = getDatabase();
  const { id } = req.params;

  try {
    await db.run(
      "UPDATE work_orders SET ppt_status = 'generating' WHERE id = ?",
      id
    );

    await generatePptForWorkOrder(id);
        await createActivityLog({
      userId: req.session.adminUser.id,
      action: "PPT_GENERATED",
      details: `PPT generated for Work Order ID ${id}`,
    });

    return res.redirect(`/admin/work-orders/${id}`);
  } catch (error) {
    console.error("Generate PPT error:", error);

    await db.run(
      "UPDATE work_orders SET ppt_status = 'failed' WHERE id = ?",
      id
    );

    const existingReport = await db.get(
      "SELECT * FROM ppt_reports WHERE work_order_id = ?",
      id
    );

    if (existingReport) {
      await db.run(
        `
        UPDATE ppt_reports
        SET status = ?, error_message = ?
        WHERE work_order_id = ?
        `,
        ["failed", error.message, id]
      );
    } else {
      await db.run(
        `
        INSERT INTO ppt_reports (
          work_order_id,
          status,
          error_message,
          created_at
        )
        VALUES (?, ?, ?, ?)
        `,
        [id, "failed", error.message, new Date().toISOString()]
      );
    }

    return res.redirect(`/admin/work-orders/${id}`);
  }
}

async function downloadPpt(req, res) {
  const db = getDatabase();
  const { id } = req.params;

  const workOrder = await db.get(
    "SELECT * FROM work_orders WHERE id = ?",
    id
  );

  if (!workOrder || !workOrder.ppt_file_path) {
    return res.status(404).send("PPT not found");
  }

  const absolutePath = path.join(__dirname, "..", workOrder.ppt_file_path);

  if (!fs.existsSync(absolutePath)) {
    return res.status(404).send("PPT file missing from server");
  }

  return res.download(absolutePath);
}
async function sendPptEmail(req, res) {
  const db = getDatabase();
  const { id } = req.params;

  try {
    await db.run(
      `
      UPDATE work_orders
      SET email_status = ?, email_error = ?
      WHERE id = ?
      `,
      ["sending", "", id]
    );

    await sendPptReportEmail(id);
        await createActivityLog({
      userId: req.session.adminUser.id,
      action: "EMAIL_SENT_OR_TESTED",
      details: `Email flow completed for Work Order ID ${id}`,
    });

    return res.redirect(`/admin/work-orders/${id}`);
  } catch (error) {
    console.error("Send email error:", error);

    await db.run(
      `
      UPDATE work_orders
      SET email_status = ?, email_error = ?
      WHERE id = ?
      `,
      ["failed", error.message, id]
    );

    const existingReport = await db.get(
      "SELECT * FROM ppt_reports WHERE work_order_id = ?",
      id
    );

    if (existingReport) {
      await db.run(
        `
        UPDATE ppt_reports
        SET status = ?, error_message = ?
        WHERE work_order_id = ?
        `,
        ["email_failed", error.message, id]
      );
    }

    return res.redirect(`/admin/work-orders/${id}`);
  }
}

async function generatePptAndSendEmail(req, res) {
  const db = getDatabase();
  const { id } = req.params;

  try {
    await db.run(
      "UPDATE work_orders SET ppt_status = 'generating', email_status = 'waiting' WHERE id = ?",
      id
    );

    await generatePptForWorkOrder(id);

    await db.run(
      "UPDATE work_orders SET email_status = 'sending', email_error = '' WHERE id = ?",
      id
    );

    await sendPptReportEmail(id);

    return res.redirect(`/admin/work-orders/${id}`);
  } catch (error) {
    console.error("Generate PPT and send email error:", error);

    await db.run(
      `
      UPDATE work_orders
      SET email_status = ?, email_error = ?
      WHERE id = ?
      `,
      ["failed", error.message, id]
    );

    return res.redirect(`/admin/work-orders/${id}`);
  }
}
async function activityLogsPage(req, res) {
  const db = getDatabase();

  const logs = await db.all(`
    SELECT
      al.*,
      u.full_name AS user_name,
      u.phone AS user_phone,
      u.role AS user_role
    FROM activity_logs al
    LEFT JOIN users u ON al.user_id = u.id
    ORDER BY al.id DESC
    LIMIT 200
  `);

  return res.render("admin/activity_logs", {
    admin: req.session.adminUser,
    logs,
  });
}

async function backupsPage(req, res) {
  const backups = getBackupsList();

  return res.render("admin/backups", {
    admin: req.session.adminUser,
    backups,
    message: null,
    error: null,
  });
}

async function createBackup(req, res) {
  try {
    const backup = await createBackupZip();

    await createActivityLog({
      userId: req.session.adminUser.id,
      action: "BACKUP_CREATED",
      details: {
        fileName: backup.fileName,
        size: backup.size,
      },
    });

    const backups = getBackupsList();

    return res.render("admin/backups", {
      admin: req.session.adminUser,
      backups,
      message: `Backup created successfully: ${backup.fileName}`,
      error: null,
    });
  } catch (error) {
    const backups = getBackupsList();

    return res.render("admin/backups", {
      admin: req.session.adminUser,
      backups,
      message: null,
      error: error.message,
    });
  }
}

async function downloadBackup(req, res) {
  const { fileName } = req.params;

  const backupPath = path.join(__dirname, "..", "backups", fileName);

  if (!fs.existsSync(backupPath)) {
    return res.status(404).send("Backup file not found");
  }

  return res.download(backupPath);
}
async function pptSettingsPage(req, res) {
  const settings = await getPptSettings();

  return res.render("admin/ppt_settings", {
    admin: req.session.adminUser,
    settings,
    message: null,
    error: null,
  });
}

async function savePptSettings(req, res) {
  try {
    await updatePptSettings(req.body);

    const settings = await getPptSettings();

    return res.render("admin/ppt_settings", {
      admin: req.session.adminUser,
      settings,
      message: "PPT settings saved successfully.",
      error: null,
    });
  } catch (error) {
    const settings = await getPptSettings();

    return res.render("admin/ppt_settings", {
      admin: req.session.adminUser,
      settings,
      message: null,
      error: error.message,
    });
  }
}
async function deleteWorkOrder(req, res) {
  const db = getDatabase();
  const { id } = req.params;

  try {
    const workOrder = await db.get(
      "SELECT * FROM work_orders WHERE id = ?",
      id
    );

    if (!workOrder) {
      return res.redirect("/admin/work-orders");
    }

    const photos = await db.all(
      "SELECT * FROM work_order_photos WHERE work_order_id = ?",
      id
    );

    for (const photo of photos) {
      if (photo.file_path) {
        const absolutePhotoPath = path.join(__dirname, "..", photo.file_path);

        if (fs.existsSync(absolutePhotoPath)) {
          fs.unlinkSync(absolutePhotoPath);
        }
      }
    }

    if (workOrder.ppt_file_path) {
      const absolutePptPath = path.join(__dirname, "..", workOrder.ppt_file_path);

      if (fs.existsSync(absolutePptPath)) {
        fs.unlinkSync(absolutePptPath);
      }
    }

    const reportFolder = path.join(
      __dirname,
      "..",
      "uploads",
      "reports",
      String(id)
    );

    if (fs.existsSync(reportFolder)) {
      fs.rmSync(reportFolder, {
        recursive: true,
        force: true,
      });
    }

    await db.run("BEGIN TRANSACTION");

    await db.run(
      "DELETE FROM work_order_photos WHERE work_order_id = ?",
      id
    );

    await db.run(
      "DELETE FROM ppt_reports WHERE work_order_id = ?",
      id
    );

    await db.run(
      "DELETE FROM work_orders WHERE id = ?",
      id
    );

    await db.run("COMMIT");

    if (typeof createActivityLog === "function") {
      await createActivityLog({
        userId: req.session.adminUser.id,
        action: "WORK_ORDER_DELETED",
        details: `Work Order ID ${id} deleted. Work Order Number: ${workOrder.work_order_number}`,
      });
    }

    return res.redirect("/admin/work-orders");
  } catch (error) {
    await db.run("ROLLBACK").catch(() => {});

    console.error("Delete work order error:", error);

    return res.status(500).send(`
      <h3>Failed to delete work order</h3>
      <p>${error.message}</p>
      <a href="/admin/work-orders">Back to Work Orders</a>
    `);
  }
}
async function deleteTechnician(req, res) {
  const db = getDatabase();
  const { id } = req.params;

  try {
    const technician = await db.get(
      "SELECT * FROM users WHERE id = ? AND role = 'technician'",
      id
    );

    if (!technician) {
      return res.redirect("/admin/technicians");
    }

    const workOrders = await db.all(
      "SELECT * FROM work_orders WHERE technician_id = ?",
      id
    );

    for (const workOrder of workOrders) {
      const photos = await db.all(
        "SELECT * FROM work_order_photos WHERE work_order_id = ?",
        workOrder.id
      );

      for (const photo of photos) {
        if (photo.file_path) {
          const absolutePhotoPath = path.join(__dirname, "..", photo.file_path);

          if (fs.existsSync(absolutePhotoPath)) {
            fs.unlinkSync(absolutePhotoPath);
          }
        }
      }

      if (workOrder.ppt_file_path) {
        const absolutePptPath = path.join(
          __dirname,
          "..",
          workOrder.ppt_file_path
        );

        if (fs.existsSync(absolutePptPath)) {
          fs.unlinkSync(absolutePptPath);
        }
      }

      const reportFolder = path.join(
        __dirname,
        "..",
        "uploads",
        "reports",
        String(workOrder.id)
      );

      if (fs.existsSync(reportFolder)) {
        fs.rmSync(reportFolder, {
          recursive: true,
          force: true,
        });
      }
    }

    await db.run("BEGIN TRANSACTION");

    for (const workOrder of workOrders) {
      await db.run(
        "DELETE FROM work_order_photos WHERE work_order_id = ?",
        workOrder.id
      );

      await db.run(
        "DELETE FROM ppt_reports WHERE work_order_id = ?",
        workOrder.id
      );

      await db.run(
        "DELETE FROM work_orders WHERE id = ?",
        workOrder.id
      );
    }

    await db.run(
      "DELETE FROM activity_logs WHERE user_id = ?",
      id
    );

    await db.run(
      "DELETE FROM users WHERE id = ? AND role = 'technician'",
      id
    );

    await db.run("COMMIT");

    if (typeof createActivityLog === "function") {
      await createActivityLog({
        userId: req.session.adminUser.id,
        action: "TECHNICIAN_DELETED",
        details: `Technician deleted. Phone: ${technician.phone}`,
      });
    }

    return res.redirect("/admin/technicians");
  } catch (error) {
    await db.run("ROLLBACK").catch(() => {});

    console.error("Delete technician error:", error);

    return res.status(500).send(`
      <h3>Failed to delete technician</h3>
      <p>${error.message}</p>
      <a href="/admin/technicians">Back to Technicians</a>
    `);
  }
}
module.exports = {
  showLoginPage,
  loginAdmin,
  logoutAdmin,
  dashboard,
  techniciansPage,
  approveTechnician,
  rejectTechnician,
  workOrdersPage,
  workOrderDetailsPage,
  deleteWorkOrderPhoto,
  addMorePhotos,
  emailRecipientsPage,
  addEmailRecipient,
  toggleEmailRecipient,
  deleteEmailRecipient,
  generatePpt,
  downloadPpt,
  sendPptEmail,
  generatePptAndSendEmail,
  activityLogsPage,
  backupsPage,
  createBackup,
  downloadBackup,
    pptSettingsPage,
  savePptSettings,
  deleteWorkOrder,
  deleteTechnician,
};