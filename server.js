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


app.get("/privacy-policy", (req, res) => {
  const developerName = process.env.PLAY_DEVELOPER_NAME;

  const privacyEmail =
    process.env.PRIVACY_CONTACT_EMAIL ||
    process.env.SUPPORT_EMAIL;

  if (!developerName || !privacyEmail) {
    return res.status(503).send(
      "Privacy Policy configuration is currently unavailable.",
    );
  }

  res.status(200).type("html").send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />

  <meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
  />

  <title>Work Order Privacy Policy</title>

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
      line-height: 1.7;
    }

    .container {
      max-width: 860px;
      margin: 40px auto;
      padding: 36px;
      background: #ffffff;
      border-radius: 16px;
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.08);
    }

    h1 {
      margin-top: 0;
      color: #0d5c75;
    }

    h2 {
      margin-top: 32px;
      color: #173b4d;
    }

    h3 {
      margin-top: 22px;
    }

    a {
      color: #0d5c75;
    }

    .summary {
      padding: 18px;
      margin: 22px 0;
      background: #f0f9ff;
      border-left: 4px solid #0d5c75;
      border-radius: 6px;
    }

    .warning {
      padding: 18px;
      background: #fff7ed;
      border-left: 4px solid #f97316;
      border-radius: 6px;
    }

    footer {
      margin-top: 36px;
      padding-top: 20px;
      border-top: 1px solid #e5e7eb;
      color: #6b7280;
      font-size: 14px;
    }
  </style>
</head>

<body>
  <main class="container">

    <h1>Work Order Privacy Policy</h1>

    <p>
      <strong>Effective date:</strong> 8 August 2026
    </p>

    <p>
      <strong>Application:</strong> Work Order
    </p>

    <p>
      <strong>Developer:</strong> ${developerName}
    </p>

    <div class="summary">
      This Privacy Policy explains how the Work Order mobile
      application collects, uses, stores, protects, and deletes
      personal information when users access and use the application.
    </div>

    <h2>1. Information We Collect</h2>

    <p>
      Depending on how you use Work Order, we may collect the
      following information.
    </p>

    <h3>Account and Profile Information</h3>

    <ul>
      <li>Full name</li>
      <li>Qatar Identification Number (QID), where provided</li>
      <li>Job title</li>
      <li>Registered Qatar phone number</li>
      <li>Account status and role</li>
      <li>Account creation information</li>
    </ul>

    <h3>Authentication Information</h3>

    <p>
      Work Order uses Firebase Authentication to verify phone
      numbers during account registration and password recovery.
      Authentication services may process your phone number,
      Firebase user identifier, IP address, device or user-agent
      information, and security or integrity information required
      to authenticate users and prevent abuse.
    </p>

    <p>
      Work Order does not ask users to provide their OTP code to
      administrators or support personnel.
    </p>

    <h3>Work Order Information</h3>

    <p>
      When you create or submit a work order, we may collect:
    </p>

    <ul>
      <li>Work order number</li>
      <li>Asset information</li>
      <li>Notes and work-related information</li>
      <li>Work order status</li>
      <li>Submission and processing timestamps</li>
      <li>Associated technician information</li>
    </ul>

    <h3>Photos and Camera Data</h3>

    <p>
      The application may access the device camera when you choose
      to capture photographs for a work order. Captured photographs
      may be uploaded to the Work Order server and associated with
      the relevant work order.
    </p>

    <h3>Location Information</h3>

    <p>
      When required for a work-order photo, Work Order may request
      foreground device location and store latitude and longitude
      information associated with that photograph.
    </p>

    <p>
      Work Order does not intentionally collect background location
      while the application is not being actively used.
    </p>

    <h3>Technical and Security Information</h3>

    <p>
      Technical information may be processed when necessary to
      provide network connectivity, authentication, security,
      fraud prevention, troubleshooting, and reliable operation
      of the application.
    </p>

    <h2>2. How We Use Information</h2>

    <p>
      Information collected through Work Order is used to:
    </p>

    <ul>
      <li>Create and manage user accounts</li>
      <li>Verify registered phone numbers</li>
      <li>Authenticate users securely</li>
      <li>Recover or reset account passwords</li>
      <li>Allow administrators to review and approve accounts</li>
      <li>Create, process, and manage work orders</li>
      <li>Associate work-order photographs with work activities</li>
      <li>Record work-related location information when required</li>
      <li>Generate work-order reports</li>
      <li>Provide application support</li>
      <li>Protect the application against misuse and unauthorized access</li>
      <li>Maintain and improve application reliability</li>
    </ul>

    <h2>3. How Information Is Shared</h2>

    <p>
      We do not sell personal information or use Work Order user
      information for third-party advertising.
    </p>

    <p>
      Information may be processed by service providers that are
      necessary to operate Work Order, including:
    </p>

    <ul>
      <li>
        <strong>Google Firebase</strong> — used for phone-number
        authentication, OTP verification, authentication security,
        and related account verification functions.
      </li>

      <li>
        <strong>Hosting and database infrastructure</strong> —
        used to operate the Work Order backend, PostgreSQL database,
        and application file storage.
      </li>
    </ul>

    <p>
      Work-order reports may also be provided to recipients
      designated or configured by the organization using Work Order
      when an authorized report or email function is used.
    </p>

    <p>
      Information may also be disclosed where required by applicable
      law, legal process, or a valid government request.
    </p>

    <h2>4. Data Security</h2>

    <p>
      We use reasonable technical and organizational safeguards
      designed to protect personal information.
    </p>

    <p>
      These measures include secure network communication,
      authenticated access to protected application functions,
      phone-number verification, administrative access controls,
      and hashed password storage.
    </p>

    <p>
      No system can guarantee absolute security. Users should keep
      their password and OTP verification codes confidential.
    </p>

    <h2>5. Data Retention</h2>

    <p>
      Account and work-order information is retained while required
      to provide the Work Order service and support legitimate
      operational requirements.
    </p>

    <p>
      When an account is permanently deleted, the account and
      associated active user data are removed from the application's
      primary systems, including associated work orders, photographs,
      location information connected to those photographs, generated
      report data, and Firebase Authentication identity where
      applicable.
    </p>

    <p>
      Limited information may be retained where reasonably necessary
      for security, fraud prevention, legal obligations, dispute
      resolution, or system backup and disaster-recovery purposes.
      Such information is not retained for advertising purposes.
    </p>

    <h2>6. Account and Data Deletion</h2>

    <p>
      Users can permanently delete their Work Order account from
      within the mobile application through the account settings.
    </p>

    <p>
      Users who no longer have access to the application can also
      request account and associated data deletion using our public
      account-deletion page:
    </p>

    <p>
      <a href="/account-deletion">
        Work Order Account Deletion
      </a>
    </p>

    <p>
      When an account deletion request is completed, associated
      account data is permanently removed from active systems unless
      limited retention is required for a legitimate security,
      legal, or regulatory reason.
    </p>

    <h2>7. Permissions Used by the Application</h2>

    <p>
      Work Order may request the following Android permissions:
    </p>

    <ul>
      <li>
        <strong>Camera:</strong> to capture photographs associated
        with work orders.
      </li>

      <li>
        <strong>Precise and approximate location:</strong> to record
        location information associated with work-order photographs
        when the feature is used.
      </li>

      <li>
        <strong>Internet and network access:</strong> to communicate
        securely with the Work Order backend and authentication
        services.
      </li>
    </ul>

    <p>
      Work Order does not request SMS-reading, call-log,
      background-location, microphone, or broad media-library
      permissions in its current Android release.
    </p>

    <h2>8. Children's Privacy</h2>

    <p>
      Work Order is a business and workforce application and is not
      designed or intended for use by children.
    </p>

    <h2>9. Changes to This Privacy Policy</h2>

    <p>
      We may update this Privacy Policy when the application,
      services, legal requirements, or data-handling practices
      change.
    </p>

    <p>
      Any updated policy will be published on this page with a
      revised effective date.
    </p>

    <h2>10. Contact Us</h2>

    <p>
      For privacy questions, concerns, or data-related requests,
      contact:
    </p>

    <p>
      <strong>${developerName}</strong><br />
      Email:
      <a href="mailto:${privacyEmail}">
        ${privacyEmail}
      </a>
    </p>

    <div class="warning">
      Never send your password or OTP verification code by email
      or through a support request.
    </div>

    <footer>
      Work Order Privacy Policy
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