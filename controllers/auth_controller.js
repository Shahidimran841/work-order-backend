const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { getDatabase } = require("../database/db");

const {
  normalizePhone,
  isValidPhone,
  validatePassword,
  createOtp,
  getOtpExpiryDate,
} = require("../services/auth_validation_service");

function createToken(user) {
  return jwt.sign(
    {
      id: user.id,
      phone: user.phone,
      role: user.role,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: "30d",
    }
  );
}

async function register(req, res) {
  try {
    const { fullName, qidNumber, jobTitle, password } = req.body;
    const phone = normalizePhone(req.body.phone);

    if (!fullName || !phone || !password) {
      return res.status(400).json({
        success: false,
        message: "Full name, phone and password are required",
      });
    }

    if (!isValidPhone(phone)) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid phone number. Use valid format like 03XXXXXXXXX or +923XXXXXXXXX.",
      });
    }

    const passwordCheck = validatePassword(password);

    if (!passwordCheck.valid) {
      return res.status(400).json({
        success: false,
        message: passwordCheck.errors.join(", "),
      });
    }

    const db = getDatabase();

    const existingUser = await db.get(
      "SELECT * FROM users WHERE phone = ?",
      phone
    );

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "Phone number already registered",
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const status =
      process.env.AUTO_APPROVE_USERS === "true" ? "approved" : "pending";

    await db.run(
      `
      INSERT INTO users (
        full_name,
        qid_number,
        job_title,
        phone,
        password_hash,
        role,
        status,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        fullName,
        qidNumber || "",
        jobTitle || "",
        phone,
        passwordHash,
        "technician",
        status,
        new Date().toISOString(),
      ]
    );

    return res.status(201).json({
      success: true,
      message:
        status === "approved"
          ? "Registration successful. You can login now."
          : "Registration submitted. Admin approval required.",
    });
  } catch (error) {
    console.error("Register error:", error);

    return res.status(500).json({
      success: false,
      message: "Registration failed",
      error: error.message,
    });
  }
}

async function login(req, res) {
  try {
    const phone = normalizePhone(req.body.phone);
    const { password } = req.body;

    if (!phone || !password) {
      return res.status(400).json({
        success: false,
        message: "Phone and password are required",
      });
    }

    if (!isValidPhone(phone) && phone !== "admin") {
      return res.status(400).json({
        success: false,
        message: "Invalid phone number format",
      });
    }

    const db = getDatabase();

    const user = await db.get("SELECT * FROM users WHERE phone = ?", phone);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid phone or password",
      });
    }

    const passwordMatched = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatched) {
      return res.status(401).json({
        success: false,
        message: "Invalid phone or password",
      });
    }

    if (user.status !== "approved") {
      return res.status(403).json({
        success: false,
        message: "Account pending approval from admin",
      });
    }

    const token = createToken(user);

    return res.json({
      success: true,
      message: "Login successful",
      token,
      user: {
        id: user.id,
        name: user.full_name,
        phone: user.phone,
        role: user.role,
        status: user.status,
      },
    });
  } catch (error) {
    console.error("Login error:", error);

    return res.status(500).json({
      success: false,
      message: "Login failed",
      error: error.message,
    });
  }
}

async function forgotPassword(req, res) {
  try {
    const phone = normalizePhone(req.body.phone);

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: "Phone number is required",
      });
    }

    if (!isValidPhone(phone)) {
      return res.status(400).json({
        success: false,
        message: "Invalid phone number format",
      });
    }

    const db = getDatabase();

    const user = await db.get("SELECT * FROM users WHERE phone = ?", phone);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "No account found with this phone number",
      });
    }

    const otp = createOtp();
    const otpHash = await bcrypt.hash(otp, 10);
    const otpExpiresAt = getOtpExpiryDate();

    await db.run(
      `
      UPDATE users
      SET reset_otp_hash = ?,
          reset_otp_expires_at = ?,
          reset_otp_attempts = 0
      WHERE id = ?
      `,
      [otpHash, otpExpiresAt, user.id]
    );

    console.log(`Password reset OTP for ${phone}: ${otp}`);

    return res.json({
      success: true,
      message: "OTP generated. Development OTP returned for testing.",
      devOtp: otp,
    });
  } catch (error) {
    console.error("Forgot password error:", error);

    return res.status(500).json({
      success: false,
      message: "Forgot password failed",
      error: error.message,
    });
  }
}

async function resetPassword(req, res) {
  try {
    const phone = normalizePhone(req.body.phone);
    const { otp, newPassword } = req.body;

    if (!phone || !otp || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Phone, OTP and new password are required",
      });
    }

    if (!isValidPhone(phone)) {
      return res.status(400).json({
        success: false,
        message: "Invalid phone number format",
      });
    }

    const passwordCheck = validatePassword(newPassword);

    if (!passwordCheck.valid) {
      return res.status(400).json({
        success: false,
        message: passwordCheck.errors.join(", "),
      });
    }

    const db = getDatabase();

    const user = await db.get("SELECT * FROM users WHERE phone = ?", phone);

    if (!user || !user.reset_otp_hash || !user.reset_otp_expires_at) {
      return res.status(400).json({
        success: false,
        message: "OTP request not found. Please request OTP again.",
      });
    }

    if (Number(user.reset_otp_attempts || 0) >= 5) {
      return res.status(429).json({
        success: false,
        message: "Too many wrong OTP attempts. Please request new OTP.",
      });
    }

    if (new Date(user.reset_otp_expires_at).getTime() < Date.now()) {
      return res.status(400).json({
        success: false,
        message: "OTP expired. Please request new OTP.",
      });
    }

    const otpMatched = await bcrypt.compare(String(otp), user.reset_otp_hash);

    if (!otpMatched) {
      await db.run(
        `
        UPDATE users
        SET reset_otp_attempts = reset_otp_attempts + 1
        WHERE id = ?
        `,
        user.id
      );

      return res.status(400).json({
        success: false,
        message: "Invalid OTP",
      });
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 10);

    await db.run(
      `
      UPDATE users
      SET password_hash = ?,
          reset_otp_hash = NULL,
          reset_otp_expires_at = NULL,
          reset_otp_attempts = 0
      WHERE id = ?
      `,
      [newPasswordHash, user.id]
    );

    return res.json({
      success: true,
      message: "Password reset successful. Please login with new password.",
    });
  } catch (error) {
    console.error("Reset password error:", error);

    return res.status(500).json({
      success: false,
      message: "Password reset failed",
      error: error.message,
    });
  }
}

module.exports = {
  register,
  login,
  forgotPassword,
  resetPassword,
};