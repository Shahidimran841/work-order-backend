const fs = require("fs");
const path = require("path");
const pptxgen = require("pptxgenjs");
const {
  getStorageDir,
  getStoredFileAbsolutePath,
  toPublicPath,
} = require("./storage_service");
const { getDatabase } = require("../database/db");
const { getPptSettings } = require("./app_settings_service");

const SLIDE_W = 13.333;
const SLIDE_H = 7.5;

const imageSizePackage = require("image-size");

const imageSize =
  imageSizePackage.imageSize ||
  imageSizePackage.default ||
  imageSizePackage;

function getAbsolutePath(relativePath) {
  return getStoredFileAbsolutePath(relativePath);
}
function ensureReportsFolder(workOrderId) {
  return getStorageDir("uploads", "reports", String(workOrderId));
}

function getTemplatePath() {
  const templateRelativePath =
    process.env.PPT_TEMPLATE_IMAGE || "assets/ppt_templates/bda_template.png";

  return path.join(__dirname, "..", templateRelativePath);
}

function safeText(value) {
  return String(value || "-");
}

function addWhiteBox(pptx, slide, x, y, w, h) {
  slide.addShape(pptx.ShapeType.rect, {
    x,
    y,
    w,
    h,
    fill: { color: "FFFFFF" },
    line: { color: "FFFFFF" },
  });
}

function addTemplateBackground(pptx, slide) {
  const templatePath = getTemplatePath();

  if (fs.existsSync(templatePath)) {
    slide.addImage({
      path: templatePath,
      x: 0,
      y: 0,
      w: SLIDE_W,
      h: SLIDE_H,
    });
  } else {
    slide.background = { color: "FFFFFF" };
  }
}

function addDynamicTitle(pptx, slide, title) {
  // This white box hides the template's old BEFORE/DURING/AFTER heading.
  // It keeps the logos safe and only replaces the center heading area.
  addWhiteBox(pptx, slide, 3.3, 1.35, 6.8, 1.15);

  slide.addText(title, {
    x: 3.3,
    y: 1.72,
    w: 6.8,
    h: 0.45,
    fontSize: 22,
    bold: true,
    align: "center",
    color: "000000",
    margin: 0,
  });
}

function addFooter(pptx, slide, workOrder, pageNumber, totalPages, settings) {
  // Always hide old footer text from template, then draw only enabled fields.
  addWhiteBox(pptx, slide, 0.25, 6.55, 12.85, 0.88);

  if (!settings.showFooter) {
    return;
  }

  if (settings.showProjectName) {
    slide.addText(`Project Name : ${settings.projectName || "-"}`, {
      x: 0.45,
      y: 6.72,
      w: 4.7,
      h: 0.25,
      fontSize: 14,
      color: "000000",
      margin: 0,
    });
  }

  if (settings.showProjectCode) {
    slide.addText(`Contract  / Project Code : ${settings.projectCode || "-"}`, {
      x: 0.45,
      y: 7.02,
      w: 5.3,
      h: 0.25,
      fontSize: 14,
      color: "000000",
      margin: 0,
    });
  }

  if (settings.showWorkOrderNumber) {
    slide.addText(`Work Order Number: ${safeText(workOrder.work_order_number)}`, {
      x: 4.9,
      y: 6.88,
      w: 4.2,
      h: 0.3,
      fontSize: 14,
      color: "000000",
      align: "center",
      margin: 0,
    });
  }

  if (settings.showPageNumber) {
    slide.addText(`Page Number: ${pageNumber} of ${totalPages}`, {
      x: 9.85,
      y: 6.88,
      w: 2.9,
      h: 0.3,
      fontSize: 14,
      color: "000000",
      align: "center",
      margin: 0,
    });
  }
}

function getSlotsForPhotoCount(count) {
  // 1 photo = centered, decent width, not too wide
  // 2 photos = 50 / 50
  // 3 photos = 3 equal columns

  if (count === 1) {
    return [
      {
        x: 3.0,
        y: 2.72,
        w: 7.3,
        h: 3.65,
      },
    ];
  }

  if (count === 2) {
    return [
      {
        x: 0.85,
        y: 2.72,
        w: 5.55,
        h: 3.65,
      },
      {
        x: 6.95,
        y: 2.72,
        w: 5.55,
        h: 3.65,
      },
    ];
  }

  return [
    {
      x: 0.55,
      y: 2.72,
      w: 3.85,
      h: 3.65,
    },
    {
      x: 4.75,
      y: 2.72,
      w: 3.85,
      h: 3.65,
    },
    {
      x: 8.95,
      y: 2.72,
      w: 3.85,
      h: 3.65,
    },
  ];
}
function getContainPosition(imagePath, boxX, boxY, boxW, boxH) {
  try {
    const dimensions = imageSize(imagePath);

    const imageW = dimensions.width || 1;
    const imageH = dimensions.height || 1;

    const imageRatio = imageW / imageH;
    const boxRatio = boxW / boxH;

    let finalW;
    let finalH;

    if (imageRatio > boxRatio) {
      finalW = boxW;
      finalH = boxW / imageRatio;
    } else {
      finalH = boxH;
      finalW = boxH * imageRatio;
    }

    return {
      x: boxX + (boxW - finalW) / 2,
      y: boxY + (boxH - finalH) / 2,
      w: finalW,
      h: finalH,
    };
  } catch (error) {
    return {
      x: boxX,
      y: boxY,
      w: boxW,
      h: boxH,
    };
  }
}
function hidePhotoPlaceholderArea(pptx, slide) {
  // This hides old Picture 1 / Picture 2 / Picture 3 text from the template.
  // Footer is added again after photos, so footer will stay visible.
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.35,
    y: 2.45,
    w: 12.65,
    h: 4.12,
    fill: { color: "FFFFFF" },
    line: { color: "FFFFFF" },
  });
}
function addPhotoToSlot(pptx, slide, photo, slot, photoNumber) {
  slide.addShape(pptx.ShapeType.rect, {
    x: slot.x,
    y: slot.y,
    w: slot.w,
    h: slot.h,
    fill: { color: "FFFFFF" },
    line: { color: "D1D5DB", width: 1 },
  });

  const absoluteImagePath = getAbsolutePath(photo.file_path);

  const imageBox = {
    x: slot.x + 0.08,
    y: slot.y + 0.08,
    w: slot.w - 0.16,
    h: slot.h - 0.45,
  };

  if (fs.existsSync(absoluteImagePath)) {
    slide.addImage({
      path: absoluteImagePath,
      x: imageBox.x,
      y: imageBox.y,
      w: imageBox.w,
      h: imageBox.h,
      sizing: {
        type: "contain",
        x: imageBox.x,
        y: imageBox.y,
        w: imageBox.w,
        h: imageBox.h,
      },
    });
  } else {
    slide.addText("Image missing", {
      x: slot.x,
      y: slot.y + 1.35,
      w: slot.w,
      h: 0.4,
      fontSize: 13,
      color: "DC2626",
      align: "center",
      margin: 0,
    });
  }

  slide.addText(`Picture ${photoNumber}`, {
    x: slot.x,
    y: slot.y + slot.h - 0.28,
    w: slot.w,
    h: 0.22,
    fontSize: 10,
    color: "000000",
    align: "center",
    margin: 0,
  });
}
function groupPhotosByStage(photos) {
  return {
    Before: photos.filter((photo) => photo.stage === "Before"),
    During: photos.filter((photo) => photo.stage === "During"),
    After: photos.filter((photo) => photo.stage === "After"),
    Progress: photos.filter((photo) => photo.stage === "Progress"),
    Other: photos.filter(
      (photo) =>
        !["Before", "During", "After", "Progress"].includes(photo.stage)
    ),
  };
}

function buildSlideGroups(photos) {
  const grouped = groupPhotosByStage(photos);
  const stageOrder = ["Before", "During", "After", "Progress", "Other"];

  const slideGroups = [];

  for (const stage of stageOrder) {
    const stagePhotos = grouped[stage];

    if (!stagePhotos || stagePhotos.length === 0) continue;

    for (let i = 0; i < stagePhotos.length; i += 3) {
      slideGroups.push({
  stage,
  title:
    stage === "Other"
      ? "PHOTOS"
      : stage === "Progress"
      ? "PROGRESS"
      : stage.toUpperCase(),
  photos: stagePhotos.slice(i, i + 3),
});
    }
  }

  return slideGroups;
}

async function generatePptForWorkOrder(workOrderId) {
  const db = getDatabase();
  const pptSettings = await getPptSettings();

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
    workOrderId
  );

  if (!workOrder) {
    throw new Error("Work order not found");
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
    workOrderId
  );

  if (photos.length === 0) {
    throw new Error("No photos available for PPT generation");
  }

  const slideGroups = buildSlideGroups(photos);
  const totalPages = slideGroups.length;

  const pptx = new pptxgen();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Work Order App";
  pptx.subject = `Work Order ${workOrder.work_order_number}`;

slideGroups.forEach((group, groupIndex) => {
  const pageNumber = groupIndex + 1;
  const slide = pptx.addSlide();

  addTemplateBackground(pptx, slide);

  // Hide old template photo labels first.
  hidePhotoPlaceholderArea(pptx, slide);

  // Show only one heading: BEFORE / DURING / AFTER / PROGRESS.
  addDynamicTitle(pptx, slide, group.title);

  const slots = getSlotsForPhotoCount(group.photos.length);

  group.photos.forEach((photo, index) => {
    addPhotoToSlot(
      pptx,
      slide,
      photo,
      slots[index],
      index + 1
    );
  });

  // Footer comes at the end so it stays visible above any white cover.
  addFooter(pptx, slide, workOrder, pageNumber, totalPages, pptSettings);
});

  const reportsDir = ensureReportsFolder(workOrderId);

  const safeWorkOrder = String(workOrder.work_order_number || "work_order")
    .replace(/\s+/g, "_")
    .replace(/[\\/:*?"<>|]/g, "_");

  const fileName = `${safeWorkOrder}_${Date.now()}.pptx`;
  const absolutePptPath = path.join(reportsDir, fileName);
  const relativePptPath = toPublicPath(
  path.join("uploads", "reports", String(workOrderId), fileName)
);

  await pptx.writeFile({
    fileName: absolutePptPath,
  });

  const existingReport = await db.get(
    "SELECT * FROM ppt_reports WHERE work_order_id = ?",
    workOrderId
  );

  if (existingReport) {
    await db.run(
      `
      UPDATE ppt_reports
      SET ppt_path = ?, status = ?, generated_at = ?, error_message = ?
      WHERE work_order_id = ?
      `,
      [relativePptPath, "generated", new Date().toISOString(), "", workOrderId]
    );
  } else {
    await db.run(
      `
      INSERT INTO ppt_reports (
        work_order_id,
        ppt_path,
        status,
        generated_at,
        error_message,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        workOrderId,
        relativePptPath,
        "generated",
        new Date().toISOString(),
        "",
        new Date().toISOString(),
      ]
    );
  }

  await db.run(
    `
    UPDATE work_orders
    SET ppt_status = 'generated', ppt_file_path = ?
    WHERE id = ?
    `,
    [relativePptPath, workOrderId]
  );

  return {
    pptPath: relativePptPath,
    absolutePptPath,
  };
}

module.exports = {
  generatePptForWorkOrder,
};