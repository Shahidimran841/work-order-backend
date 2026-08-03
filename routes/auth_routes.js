const express = require("express");

const {
  register,
  registerWithPhone,
  login,
  forgotPassword,
  resetPassword,
  resetPasswordWithPhone,
  deleteAccount,
} = require("../controllers/auth_controller");

const { protectApi } = require("../middlewares/auth_middleware");

const router = express.Router();

// router.post("/register", register);

router.post(
  "/register-with-phone",
  registerWithPhone
);

router.post("/login", login);

router.post(
  "/forgot-password",
  forgotPassword
);

router.post(
  "/reset-password",
  resetPassword
);

router.post(
  "/reset-password-with-phone",
  resetPasswordWithPhone
);

router.delete(
  "/account",
  protectApi,
  deleteAccount
);

module.exports = router;