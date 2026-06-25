const path = require("path");
const fs = require("fs");
const {
  getStorageDir,
  toPublicPath,
} = require("../services/storage_service");
const { getDatabase } = require("../database/db");

function getPublicFileUrl(filePath) {
  const normalizedPath = filePath.replace(/\\/g, "/");
  return `${process.env.BASE_URL}/${normalizedPath}`;
}

function safeFolderName(value) {
  return String(value || "unknown")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[\\/:*?"<>|]/g, "_");
}

async function moveFileToOrganizedFolder({
  file,
  technicianId,
  workOrderNumber,
  stage,
}) {
  const safeTechnician = safeFolderName(technicianId);
  const safeWorkOrder = safeFolderName(workOrderNumber);
  const safeStage = safeFolderName(stage);

  const targetDir = getStorageDir(
    "uploads",
    "work-orders",
    safeTechnician,
    safeWorkOrder,
    safeStage
  );

  const oldPath = file.path;
  const newPath = path.join(targetDir, file.filename);

  console.log("Moving uploaded file:", {
    oldPath,
    newPath,
    oldExists: fs.existsSync(oldPath),
    targetDirExists: fs.existsSync(targetDir),
  });

  try {
    fs.renameSync(oldPath, newPath);
  } catch (error) {
    console.log("Rename failed, using copy fallback:", error.message);

    fs.copyFileSync(oldPath, newPath);

    if (fs.existsSync(oldPath)) {
      fs.unlinkSync(oldPath);
    }
  }

  const relativeFilePath = toPublicPath(
    path.join(
      "uploads",
      "work-orders",
      safeTechnician,
      safeWorkOrder,
      safeStage,
      file.filename
    )
  );

  console.log("Saved relative file path:", relativeFilePath);

  return relativeFilePath;
}
async function uploadWorkOrder(req, res) {
  const db = getDatabase();

  try {
    console.log("UPLOAD API HIT");
    console.log("User:", req.user);
    console.log("Body:", req.body);
    console.log("Files:", req.files ? req.files.length : 0);

    const {
      localId,
      workOrderNumber,
      assetId,
      notes,
      submittedAt,
      metadata,
    } = req.body;

    if (!workOrderNumber) {
      return res.status(400).json({
        success: false,
        message: "Work order number is required",
      });
    }

    const technicianId = req.user ? req.user.id : null;
    const files = req.files || [];
    const parsedMetadata = metadata ? JSON.parse(metadata) : {};

    await db.run("BEGIN TRANSACTION");

    const workOrderResult = await db.run(
      `
      INSERT INTO work_orders (
        local_id,
        work_order_number,
        asset_id,
        notes,
        technician_id,
        status,
        submitted_at,
        received_at,
        metadata_json,
        ppt_status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        localId || "",
        workOrderNumber,
        assetId || "",
        notes || "",
        technicianId,
        "uploaded",
        submittedAt || new Date().toISOString(),
        new Date().toISOString(),
        JSON.stringify(parsedMetadata),
        "not_generated",
      ]
    );

    const workOrderId = workOrderResult.lastID;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      const stage = req.body[`photo_${i}_stage`] || "Unknown";

      const relativePath = await moveFileToOrganizedFolder({
        file,
        technicianId,
        workOrderNumber,
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
          req.body[`photo_${i}_time`] || "",
          req.body[`photo_${i}_displayTime`] || "",
          req.body[`photo_${i}_latitude`] || "",
          req.body[`photo_${i}_longitude`] || "",
          file.originalname,
          file.filename,
          relativePath,
          new Date().toISOString(),
        ]
      );
    }

    await db.run("COMMIT");

    return res.status(201).json({
      success: true,
      message: "Work order uploaded successfully",
      serverWorkOrderId: workOrderId,
      photoCount: files.length,
      pptStatus: "not_generated",
    });
  } catch (error) {
    await db.run("ROLLBACK");

    console.error("Upload work order error:", error);

    return res.status(500).json({
      success: false,
      message: "Work order upload failed",
      error: error.message,
    });
  }
}

async function getMyWorkOrders(req, res) {
  try {
    const db = getDatabase();

    const workOrders = await db.all(
      `
      SELECT
        wo.*,
        COUNT(wop.id) AS photo_count
      FROM work_orders wo
      LEFT JOIN work_order_photos wop ON wo.id = wop.work_order_id
      WHERE wo.technician_id = ?
      GROUP BY wo.id
      ORDER BY wo.id DESC
      `,
      req.user.id
    );

    return res.json({
      success: true,
      data: workOrders,
    });
  } catch (error) {
    console.error("Get my work orders error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to get technician work orders",
      error: error.message,
    });
  }
}

async function getAllWorkOrders(req, res) {
  try {
    const db = getDatabase();

    const workOrders = await db.all(`
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
    `);

    return res.json({
      success: true,
      data: workOrders,
    });
  } catch (error) {
    console.error("Get work orders error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to get work orders",
      error: error.message,
    });
  }
}

async function getWorkOrderDetails(req, res) {
  try {
    const { id } = req.params;
    const db = getDatabase();

    const workOrder = await db.get(
      `
      SELECT
        wo.*,
        u.full_name AS technician_name,
        u.phone AS technician_phone
      FROM work_orders wo
      LEFT JOIN users u ON wo.technician_id = u.id
      WHERE wo.id = ?
      `,
      id
    );

    if (!workOrder) {
      return res.status(404).json({
        success: false,
        message: "Work order not found",
      });
    }

    if (
      req.user &&
      req.user.role !== "admin" &&
      workOrder.technician_id !== req.user.id
    ) {
      return res.status(403).json({
        success: false,
        message: "You cannot view this work order",
      });
    }

    const photos = await db.all(
      "SELECT * FROM work_order_photos WHERE work_order_id = ? ORDER BY id ASC",
      id
    );

    const photosWithUrls = photos.map((photo) => {
      return {
        ...photo,
        url: getPublicFileUrl(photo.file_path),
      };
    });

    return res.json({
      success: true,
      data: {
        ...workOrder,
        photos: photosWithUrls,
      },
    });
  } catch (error) {
    console.error("Get work order details error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to get work order details",
      error: error.message,
    });
  }
}

module.exports = {
  uploadWorkOrder,
  getMyWorkOrders,
  getAllWorkOrders,
  getWorkOrderDetails,
};