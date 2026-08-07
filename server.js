const session = require("express-session");
const adminRoutes = require("./routes/admin_routes");

const { getStorageDir } = require("./services/storage_service");
require("dotenv").config();

const path = require("path");
const express = require("express");
const cors = require("cors");

const { initDatabase } = require("./database/db");

const authRoutes = require("./routes/auth_routes");
const workOrderRoutes = require("./routes/work_order_routes");

const app = express();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));
app.use("/public", express.static(path.join(__dirname, "public")));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "work_order_session_secret",
    resave: false,
    saveUninitialized: false,
  })
);

app.use("/uploads", express.static(getStorageDir("uploads")));

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Work Order Backend API is running",
  });
});
app.get("/account-deletion", (req, res) => {
  const supportEmail =
    process.env.SUPPORT_EMAIL || "your-support-email@gmail.com";

  const developerName =
    process.env.PLAY_DEVELOPER_NAME || "Work Order Developer";

  const emailSubject = encodeURIComponent(
    "Work Order Account Deletion Request",
  );

  const emailBody = encodeURIComponent(
    [
      "Hello,",
      "",
      "I want to permanently delete my Work Order account.",
      "",
      "Full name:",
      "Registered Qatar phone number:",
      "",
      "I understand that my account and associated data will be deleted.",
      "",
      "Please do not include your password or OTP code.",
    ].join("\n"),
  );

  res.status(200).type("html").send(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0"
        />

        <title>Work Order Account Deletion</title>

        <style>
          * {
            box-sizing: border-box;
          }

          body {
            margin: 0;
            padding: 24px;
            background: #f4f6f8;
            color: #1f2937;
            font-family: Arial, Helvetica, sans-serif;
            line-height: 1.6;
          }

          .container {
            max-width: 760px;
            margin: 40px auto;
            padding: 32px;
            background: #ffffff;
            border-radius: 16px;
            box-shadow: 0 8px 30px rgba(0, 0, 0, 0.08);
          }

          h1 {
            margin-top: 0;
            color: #1d4ed8;
          }

          h2 {
            margin-top: 28px;
          }

          .notice {
            padding: 16px;
            margin: 20px 0;
            background: #fff7ed;
            border-left: 4px solid #f97316;
            border-radius: 6px;
          }

          .delete-button {
            display: inline-block;
            margin-top: 12px;
            padding: 14px 22px;
            background: #b91c1c;
            color: #ffffff;
            text-decoration: none;
            border-radius: 8px;
            font-weight: bold;
          }

          .delete-button:hover {
            background: #991b1b;
          }

          .email {
            overflow-wrap: anywhere;
            font-weight: bold;
          }

          footer {
            margin-top: 32px;
            padding-top: 20px;
            border-top: 1px solid #e5e7eb;
            color: #6b7280;
            font-size: 14px;
          }
        </style>
      </head>

      <body>
        <main class="container">
          <h1>Work Order Account Deletion</h1>

          <p>
            This page allows users of the <strong>Work Order</strong>
            mobile application to request permanent deletion of their
            account and associated personal data.
          </p>

          <p>
            Developer:
            <strong>${developerName}</strong>
          </p>

          <h2>How to request account deletion</h2>

          <p>
            Send an account-deletion request to:
          </p>

          <p class="email">${supportEmail}</p>

          <a
            class="delete-button"
            href="mailto:${supportEmail}?subject=${emailSubject}&body=${emailBody}"
          >
            Request Account Deletion
          </a>

          <h2>Information to include</h2>

          <ul>
            <li>Your full name</li>
            <li>Your registered Qatar phone number</li>
            <li>A clear request to permanently delete your account</li>
          </ul>

          <div class="notice">
            <strong>Security warning:</strong>
            Never send your password or OTP verification code.
            We may contact you separately to verify account ownership.
          </div>

          <h2>Data that will be deleted</h2>

          <p>
            After account ownership is verified, the following data
            associated with your account will be deleted:
          </p>

          <ul>
            <li>Your Work Order application account</li>
            <li>Your registered phone number and profile information</li>
            <li>Your Firebase Authentication identity</li>
            <li>Associated work-order data</li>
            <li>Associated photos and location information</li>
          </ul>

          <h2>Processing time</h2>

          <p>
            Verified account-deletion requests are normally completed
            within 7 business days.
          </p>

          <p>
            Limited information may be retained where required for
            security, fraud prevention, legal obligations, or dispute
            resolution. Any retained information will only be kept for
            the required period.
          </p>

          <p>
            Users can also permanently delete their account directly
            inside the Work Order application through the account
            settings.
          </p>

          <footer>
            Work Order account and data deletion service
          </footer>
        </main>
      </body>
    </html>
  `);
});
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Backend healthy",
    timestamp: new Date().toISOString(),
  });
});

app.use((req, res, next) => {
  res.on("finish", () => {
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ${res.statusCode}`
    );
  });

  next();
});

app.use("/api/auth", authRoutes);
app.use("/api/work-orders", workOrderRoutes);

// Admin panel routes
app.use("/admin", adminRoutes);

// 404 handler MUST be after all valid routes
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

// Global error handler
app.use((error, req, res, next) => {
  console.error("Global error:", error);

  return res.status(500).json({
    success: false,
    message: error.message || "Internal server error",
  });
});

async function startServer() {
  try {
    await initDatabase();

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Backend running on http://localhost:${PORT}`);
      console.log(`Backend network access: http://YOUR_LAPTOP_IP:${PORT}`);
      console.log(`Health check: http://localhost:${PORT}/api/health`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();