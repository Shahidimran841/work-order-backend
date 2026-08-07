const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { getDatabase, withTransaction } = require("../database/db");
const fs = require("fs");
const path = require("path");

const {
  getStorageRoot,
  getStoredFileAbsolutePath,
} = require("../services/storage_service");

const {
  normalizePhone,
  toE164Phone,
  fromE164Phone,
  isValidPhone,
  validatePassword,
  createOtp,
  getOtpExpiryDate,
} = require("../services/auth_validation_service");

const {
  getFirebaseAuth,
  verifyFirebasePhoneToken,
} = require("../services/firebase_admin_service");

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
    },
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
          "Invalid phone number. Please enter a valid 8-digit Qatar phone number.",
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
      phone,
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
      ],
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
async function deleteAccount(req, res) {
  try {
    const userId = req.user?.id;
    const authenticatedRole = req.user?.role;
    const { password } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    if (authenticatedRole === "admin") {
      return res.status(403).json({
        success: false,
        message: "Administrator accounts cannot be deleted from the mobile app",
      });
    }

    if (!password || typeof password !== "string" || !password.trim()) {
      return res.status(400).json({
        success: false,
        message: "Password is required to delete your account",
      });
    }

    const db = getDatabase();

    const user = await db.get(
      `
      SELECT id, password_hash, role, firebase_uid
      FROM users
      WHERE id = ?
      `,
      userId,
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Account not found",
      });
    }

    if (user.role === "admin") {
      return res.status(403).json({
        success: false,
        message: "Administrator accounts cannot be deleted from the mobile app",
      });
    }

    const passwordMatched = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatched) {
      return res.status(401).json({
        success: false,
        message: "Incorrect password",
      });
    }

    // ----------------------------------------------------
    // 1. Find all work orders belonging to this user
    // ----------------------------------------------------

    const workOrders = await db.all(
      `
      SELECT id, ppt_file_path
      FROM work_orders
      WHERE technician_id = ?
      `,
      userId,
    );

    const filePathsToDelete = new Set();
    const reportFoldersToDelete = [];

    for (const workOrder of workOrders) {
      const photos = await db.all(
        `
        SELECT file_path
        FROM work_order_photos
        WHERE work_order_id = ?
        `,
        workOrder.id,
      );

      for (const photo of photos) {
        if (photo.file_path) {
          filePathsToDelete.add(photo.file_path);
        }
      }

      if (workOrder.ppt_file_path) {
        filePathsToDelete.add(workOrder.ppt_file_path);
      }

      const pptReports = await db.all(
        `
        SELECT ppt_path
        FROM ppt_reports
        WHERE work_order_id = ?
        `,
        workOrder.id,
      );

      for (const report of pptReports) {
        if (report.ppt_path) {
          filePathsToDelete.add(report.ppt_path);
        }
      }

      reportFoldersToDelete.push(
        path.join(getStorageRoot(), "uploads", "reports", String(workOrder.id)),
      );
    }

    // ----------------------------------------------------
    // 2. Delete Firebase Authentication identity
    // ----------------------------------------------------

    if (user.firebase_uid) {
      try {
        await getFirebaseAuth().deleteUser(user.firebase_uid);

        console.log("Firebase Authentication user deleted:", {
          firebaseUid: user.firebase_uid,
        });
      } catch (firebaseError) {
        if (firebaseError.code !== "auth/user-not-found") {
          throw firebaseError;
        }

        console.log("Firebase Authentication user was already absent:", {
          firebaseUid: user.firebase_uid,
        });
      }
    }

    // ----------------------------------------------------
    // 3. Delete stored photo/PPT files
    // ----------------------------------------------------

    for (const storedPath of filePathsToDelete) {
      try {
        const absolutePath = getStoredFileAbsolutePath(storedPath);

        if (absolutePath && fs.existsSync(absolutePath)) {
          fs.unlinkSync(absolutePath);
        }
      } catch (fileError) {
        console.error("Failed to delete account file:", storedPath, fileError);

        throw fileError;
      }
    }

    // Delete generated report folders
    for (const reportFolder of reportFoldersToDelete) {
      try {
        if (fs.existsSync(reportFolder)) {
          fs.rmSync(reportFolder, {
            recursive: true,
            force: true,
          });
        }
      } catch (folderError) {
        console.error(
          "Failed to delete account report folder:",
          reportFolder,
          folderError,
        );

        throw folderError;
      }
    }

    // ----------------------------------------------------
    // 4. Delete database data inside one transaction
    // ----------------------------------------------------

    await withTransaction(async (transactionDb) => {
      // Deleting work_orders also deletes:
      // work_order_photos and ppt_reports through ON DELETE CASCADE.
      for (const workOrder of workOrders) {
        await transactionDb.run(
          `
          DELETE FROM work_orders
          WHERE id = ?
            AND technician_id = ?
          `,
          [workOrder.id, userId],
        );
      }

      // Activity logs have no FK cascade.
      await transactionDb.run(
        `
        DELETE FROM activity_logs
        WHERE user_id = ?
        `,
        userId,
      );

      const deletionResult = await transactionDb.run(
        `
        DELETE FROM users
        WHERE id = ?
          AND role <> 'admin'
        `,
        userId,
      );

      if (deletionResult.changes !== 1) {
        throw new Error(
          `Expected to delete one user but deleted ${deletionResult.changes}`,
        );
      }
    });

    // ----------------------------------------------------
    // 5. Verify account no longer exists
    // ----------------------------------------------------

    const remainingUser = await db.get(
      `
      SELECT id
      FROM users
      WHERE id = ?
      `,
      userId,
    );

    if (remainingUser) {
      throw new Error("Account still exists after PostgreSQL deletion");
    }

    const remainingWorkOrders = await db.get(
      `
      SELECT id
      FROM work_orders
      WHERE technician_id = ?
      LIMIT 1
      `,
      userId,
    );

    if (remainingWorkOrders) {
      throw new Error("Work-order data still exists after account deletion");
    }

    // ----------------------------------------------------
    // 6. Destroy session if one exists
    // ----------------------------------------------------

    if (req.session) {
      req.session.destroy((sessionError) => {
        if (sessionError) {
          console.error(
            "Failed to destroy deleted user's session:",
            sessionError,
          );
        }
      });
    }

    console.log("Complete account deletion successful:", {
      userId,
      deletedWorkOrders: workOrders.length,
      deletedFiles: filePathsToDelete.size,
    });

    return res.status(200).json({
      success: true,
      message: "Your account and associated data have been permanently deleted",
    });
  } catch (error) {
    console.error("Delete account error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to delete account",
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
        message:
          "Invalid phone number. Please enter a valid 8-digit Qatar phone number.",
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

    const genericResponse = {
      success: true,
      message:
        "If an account exists for this phone number, a verification code has been sent.",
    };

    if (!user) {
      return res.json(genericResponse);
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
      [otpHash, otpExpiresAt, user.id],
    );

    return res.json({
      success: true,
      message:
        "If an account exists for this phone number, a verification code has been sent.",
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
        user.id,
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
      [newPasswordHash, user.id],
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
async function registerWithPhone(req, res) {
  try {
    const { fullName, qidNumber, jobTitle, password, firebaseIdToken } =
      req.body;

    const phone = normalizePhone(req.body.phone);

    if (!fullName || !phone || !password || !firebaseIdToken) {
      return res.status(400).json({
        success: false,
        message:
          "Full name, phone, password and phone verification are required",
      });
    }

    if (!isValidPhone(phone)) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid 8-digit Qatar phone number",
      });
    }

    const passwordCheck = validatePassword(password);

    if (!passwordCheck.valid) {
      return res.status(400).json({
        success: false,
        message: passwordCheck.errors.join(", "),
      });
    }

    const { firebaseUid, phoneNumber: verifiedPhoneNumber } =
      await verifyFirebasePhoneToken(firebaseIdToken);

    const expectedFirebasePhone = toE164Phone(phone);

    if (verifiedPhoneNumber !== expectedFirebasePhone) {
      return res.status(403).json({
        success: false,
        message:
          "The verified phone number does not match the registration phone number",
      });
    }

    const db = getDatabase();

    const existingPhoneUser = await db.get(
      `
      SELECT id
      FROM users
      WHERE phone = ?
      `,
      phone,
    );

    if (existingPhoneUser) {
      return res.status(409).json({
        success: false,
        message: "Phone number already registered",
      });
    }

    const existingFirebaseUser = await db.get(
      `
      SELECT id
      FROM users
      WHERE firebase_uid = ?
      `,
      firebaseUid,
    );

    if (existingFirebaseUser) {
      return res.status(409).json({
        success: false,
        message: "This verified Firebase account is already registered",
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
        created_at,
        firebase_uid,
        phone_verified_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        fullName.trim(),
        qidNumber || "",
        jobTitle || "",
        phone,
        passwordHash,
        "technician",
        status,
        new Date().toISOString(),
        firebaseUid,
        new Date().toISOString(),
      ],
    );

    return res.status(201).json({
      success: true,
      message:
        status === "approved"
          ? "Phone verified and registration completed. You can login now."
          : "Phone verified and registration submitted. Admin approval is required.",
    });
  } catch (error) {
    console.error("Firebase phone registration error:", error);

    const statusCode =
      Number(error.statusCode) ||
      (String(error.code || "").startsWith("auth/") ? 401 : 500);

    return res.status(statusCode).json({
      success: false,
      message: statusCode === 500 ? "Registration failed" : error.message,
    });
  }
}
async function resetPasswordWithPhone(req, res) {
  try {
    const { firebaseIdToken, newPassword } = req.body;

    if (!firebaseIdToken || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Phone verification and new password are required",
      });
    }

    const passwordCheck = validatePassword(newPassword);

    if (!passwordCheck.valid) {
      return res.status(400).json({
        success: false,
        message: passwordCheck.errors.join(", "),
      });
    }

    const { firebaseUid, phoneNumber: verifiedPhoneNumber } =
      await verifyFirebasePhoneToken(firebaseIdToken);

    const phone = fromE164Phone(verifiedPhoneNumber);

    if (!isValidPhone(phone)) {
      return res.status(400).json({
        success: false,
        message: "The verified Firebase phone number is not supported",
      });
    }

    const db = getDatabase();

    const user = await db.get(
      `
      SELECT id, role, firebase_uid
      FROM users
      WHERE phone = ?
      `,
      phone,
    );

    if (!user || user.role === "admin") {
      return res.status(404).json({
        success: false,
        message:
          "No technician account was found for this verified phone number",
      });
    }

    const firebaseUidOwner = await db.get(
      `
      SELECT id
      FROM users
      WHERE firebase_uid = ?
      `,
      firebaseUid,
    );

    if (firebaseUidOwner && firebaseUidOwner.id !== user.id) {
      return res.status(409).json({
        success: false,
        message: "This Firebase identity is linked to a different account",
      });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);

    await db.run(
      `
      UPDATE users
      SET password_hash = ?,
          firebase_uid = ?,
          phone_verified_at = ?,
          reset_otp_hash = NULL,
          reset_otp_expires_at = NULL,
          reset_otp_attempts = 0
      WHERE id = ?
      `,
      [passwordHash, firebaseUid, new Date().toISOString(), user.id],
    );

    try {
      await getFirebaseAuth().revokeRefreshTokens(firebaseUid);
    } catch (revocationError) {
      console.error("Firebase token revocation warning:", revocationError);
    }

    return res.status(200).json({
      success: true,
      message:
        "Password reset successful. Please login with your new password.",
    });
  } catch (error) {
    console.error("Firebase password reset error:", error);

    const statusCode =
      Number(error.statusCode) ||
      (String(error.code || "").startsWith("auth/") ? 401 : 500);

    return res.status(statusCode).json({
      success: false,
      message: statusCode === 500 ? "Password reset failed" : error.message,
    });
  }
}
module.exports = {
  register,
  registerWithPhone,
  login,
  forgotPassword,
  resetPassword,
  resetPasswordWithPhone,
  deleteAccount,
};
