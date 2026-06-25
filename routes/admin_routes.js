const express = require("express");

const {
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
} = require("../controllers/admin_controller");

const {
  requireAdminSession,
} = require("../middlewares/admin_session_middleware");

const {
  uploadWorkOrderPhotos,
} = require("../middlewares/upload_middleware");

const router = express.Router();

router.get("/login", showLoginPage);
router.post("/login", loginAdmin);
router.post("/logout", logoutAdmin);

router.get("/", requireAdminSession, dashboard);

router.get("/technicians", requireAdminSession, techniciansPage);
router.post("/technicians/:id/approve", requireAdminSession, approveTechnician);
router.post("/technicians/:id/reject", requireAdminSession, rejectTechnician);

router.get("/work-orders", requireAdminSession, workOrdersPage);
router.get("/work-orders/:id", requireAdminSession, workOrderDetailsPage);

router.post(
  "/work-orders/:workOrderId/photos",
  requireAdminSession,
  uploadWorkOrderPhotos.array("photos", 100),
  addMorePhotos
);

router.post(
  "/work-orders/:workOrderId/photos/:photoId/delete",
  requireAdminSession,
  deleteWorkOrderPhoto
);

router.get("/email-recipients", requireAdminSession, emailRecipientsPage);
router.post("/email-recipients", requireAdminSession, addEmailRecipient);
router.post(
  "/email-recipients/:id/toggle",
  requireAdminSession,
  toggleEmailRecipient
);
router.post(
  "/email-recipients/:id/delete",
  requireAdminSession,
  deleteEmailRecipient
);

router.post("/work-orders/:id/generate-ppt", requireAdminSession, generatePpt);
router.get("/work-orders/:id/download-ppt", requireAdminSession, downloadPpt);

router.post("/work-orders/:id/send-email", requireAdminSession, sendPptEmail);

router.post(
  "/work-orders/:id/generate-ppt-and-send-email",
  requireAdminSession,
  generatePptAndSendEmail
);
router.get("/activity-logs", requireAdminSession, activityLogsPage);

router.get("/backups", requireAdminSession, backupsPage);
router.post("/backups/create", requireAdminSession, createBackup);
router.get("/backups/:fileName/download", requireAdminSession, downloadBackup);
router.get("/ppt-settings", requireAdminSession, pptSettingsPage);
router.post("/ppt-settings", requireAdminSession, savePptSettings);
router.post("/work-orders/:id/delete",requireAdminSession,deleteWorkOrder);
router.post(
  "/technicians/:id/delete",
  requireAdminSession,
  deleteTechnician
);
module.exports = router;