const express = require("express");

const {
  uploadWorkOrder,
  getMyWorkOrders,
  getAllWorkOrders,
  getWorkOrderDetails,
} = require("../controllers/work_order_controller");

const {
  uploadWorkOrderPhotos,
} = require("../middlewares/upload_middleware");

const { protectApi, requireAdmin } = require("../middlewares/auth_middleware");

const router = express.Router();

router.post(
  "/upload",
  protectApi,
  uploadWorkOrderPhotos.array("photos", 100),
  uploadWorkOrder
);

router.get("/my", protectApi, getMyWorkOrders);

router.get("/", protectApi, requireAdmin, getAllWorkOrders);

router.get("/:id", protectApi, getWorkOrderDetails);

module.exports = router;