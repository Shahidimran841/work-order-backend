const express = require("express");

const {
  register,
  login,
  forgotPassword,
  resetPassword,
  deleteAccount,
} = require("../controllers/auth_controller");

const { protectApi } = require("../middlewares/auth_middleware");

const router = express.Router();

router.post("/register", register);
router.post("/login", login);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);

router.delete("/account", protectApi, deleteAccount);

module.exports = router;