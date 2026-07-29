const path = require("path");
const fs = require("fs");
const {
  getStorageDir,
  toPublicPath,
} = require("../services/storage_service");
const {
  getDatabase,
  withTransaction,
} = require("../database/db");

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
function cleanupUploadedTempFiles(files) {
  for (const file of files || []) {
    try {
      if (file.path && fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
    } catch (error) {
      console.log("Temp file cleanup failed:", error.message);
    }
  }
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
  const files = req.files || [];

  try {
    console.log("UPLOAD API HIT");
    console.log("Files:", files.length);

    const {
      localId,
      workOrderNumber,
      assetId,
      notes,
      submittedAt,
      metadata,
    } = req.body;

    if (!workOrderNumber) {
      cleanupUploadedTempFiles(files);

      return res.status(400).json({
        success: false,
        message: "Work order number is required",
      });
    }

    const technicianId = req.user?.id || null;

    if (!technicianId) {
      cleanupUploadedTempFiles(files);

      return res.status(401).json({
        success: false,
        message: "Unauthorized user",
      });
    }

    let parsedMetadata = {};

    try {
      parsedMetadata = metadata
        ? JSON.parse(metadata)
        : {};
    } catch (error) {
      cleanupUploadedTempFiles(files);

      return res.status(400).json({
        success: false,
        message: "Invalid work order metadata",
      });
    }

    /*
     * Check for an earlier successful upload using the same
     * local mobile work-order ID.
     */
    if (localId) {
      const existingWorkOrder = await db.get(
        `
        SELECT id
        FROM work_orders
        WHERE technician_id = ?
          AND local_id = ?
        `,
        [technicianId, localId]
      );

      if (existingWorkOrder) {
        cleanupUploadedTempFiles(files);

        return res.status(200).json({
          success: true,
          message:
            "Work order already uploaded. Duplicate upload ignored.",
          serverWorkOrderId: existingWorkOrder.id,
          duplicate: true,
          pptStatus: "not_generated",
        });
      }
    }

    let workOrderId;

    /*
     * PostgreSQL transaction.
     * Every database write inside this callback must use tx.
     */
    await withTransaction(async (tx) => {
      const workOrderResult = await tx.run(
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

      workOrderId = workOrderResult.lastID;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];

        const stage =
          req.body[`photo_${i}_stage`] || "Unknown";

        const relativePath =
          await moveFileToOrganizedFolder({
            file,
            technicianId,
            workOrderNumber,
            stage,
          });

        await tx.run(
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
    });

    return res.status(201).json({
      success: true,
      message: "Work order uploaded successfully",
      serverWorkOrderId: workOrderId,
      photoCount: files.length,
      pptStatus: "not_generated",
    });
  } catch (error) {
    cleanupUploadedTempFiles(files);

    console.error("Upload work order error:", error);

    /*
     * PostgreSQL unique-constraint code is 23505.
     * This protects against two simultaneous retries.
     */
    if (
      error.code === "23505" ||
      String(error.message || "")
        .toLowerCase()
        .includes("unique")
    ) {
      const existingWorkOrder = await db.get(
        `
        SELECT id
        FROM work_orders
        WHERE technician_id = ?
          AND local_id = ?
        `,
        [
          req.user?.id || null,
          req.body.localId || "",
        ]
      );

      if (existingWorkOrder) {
        return res.status(200).json({
          success: true,
          message:
            "Work order already uploaded. Duplicate upload ignored.",
          serverWorkOrderId: existingWorkOrder.id,
          duplicate: true,
          pptStatus: "not_generated",
        });
      }
    }

    return res.status(500).json({
      success: false,
      message: "Work order upload failed",
    });
  }
}
async function addPhotosToExistingWorkOrder(req, res) {
  const db = getDatabase();

  try {
    console.log("ADD PHOTOS API HIT");
    console.log("User:", req.user);
    console.log("Body:", req.body);
    console.log("Files:", req.files ? req.files.length : 0);

    const {
      workOrderId,
      workOrderNumber,
      assetId,
      notes,
      submittedAt,
      metadata,
    } = req.body;

    const technicianId = req.user ? req.user.id : null;
    const files = req.files || [];

    if (!technicianId) {
      cleanupUploadedTempFiles(files);

      return res.status(401).json({
        success: false,
        message: "Unauthorized user",
      });
    }

    if (files.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Please add at least one photo",
      });
    }

    let workOrder = null;

    if (workOrderId) {
      workOrder = await db.get(
        `
        SELECT *
        FROM work_orders
        WHERE id = ?
          AND technician_id = ?
        `,
        [workOrderId, technicianId]
      );
    }

    if (!workOrder && workOrderNumber) {
      workOrder = await db.get(
        `
        SELECT *
        FROM work_orders
        WHERE work_order_number = ?
          AND technician_id = ?
          AND asset_id = ?
        ORDER BY id DESC
        LIMIT 1
        `,
        [workOrderNumber, technicianId, assetId || ""]
      );
    }

    if (!workOrder) {
      cleanupUploadedTempFiles(files);

      return res.status(404).json({
        success: false,
        message: "Existing work order not found for editing",
      });
    }

    const parsedMetadata = metadata ? JSON.parse(metadata) : {};

    const editedAt = new Date().toISOString();

await withTransaction(async (tx) => {
  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    const stage =
      req.body[`photo_${i}_stage`] || "Unknown";

    const relativePath =
      await moveFileToOrganizedFolder({
        file,
        technicianId,
        workOrderNumber:
          workOrder.work_order_number,
        stage,
      });

    await tx.run(
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
        workOrder.id,
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

  await tx.run(
    `
    UPDATE work_orders
    SET notes = ?,
        submitted_at = ?,
        metadata_json = ?,
        ppt_status = ?,
        ppt_file_path = ?,
        email_status = ?,
        email_sent_at = ?,
        email_error = ?,
        is_edited = ?,
        edited_at = ?,
        edit_count = COALESCE(edit_count, 0) + 1,
        last_added_photo_count = ?
    WHERE id = ?
    `,
    [
      notes || workOrder.notes || "",
      submittedAt || editedAt,
      JSON.stringify(parsedMetadata),
      "needs_regeneration",
      "",
      "not_sent",
      null,
      "",
      1,
      editedAt,
      files.length,
      workOrder.id,
    ]
  );

  await tx.run(
    `
    UPDATE ppt_reports
    SET status = ?,
        error_message = ?
    WHERE work_order_id = ?
    `,
    [
      "outdated_after_photo_update",
      "",
      workOrder.id,
    ]
  );
});

    const totalPhotos = await db.get(
      `
      SELECT COUNT(*) AS count
      FROM work_order_photos
      WHERE work_order_id = ?
      `,
      workOrder.id
    );

    return res.status(200).json({
  success: true,
  message: "Photos added to existing work order successfully",
  serverWorkOrderId: workOrder.id,
  addedPhotoCount: files.length,
  totalPhotoCount: totalPhotos ? totalPhotos.count : files.length,
  pptStatus: "needs_regeneration",
  isEdited: true,
  editedAt,
});
  } catch (error) {

    cleanupUploadedTempFiles(req.files || []);

    console.error("Add photos to work order error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to add photos to existing work order",
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
  GROUP BY
    wo.id,
    u.id,
    u.full_name,
    u.phone
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
  addPhotosToExistingWorkOrder,
  getMyWorkOrders,
  getAllWorkOrders,
  getWorkOrderDetails,
};