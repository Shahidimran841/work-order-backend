const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");

const { getDatabase } = require("../database/db");

function getAbsolutePath(relativePath) {
  return path.join(__dirname, "..", relativePath);
}

function isEmailEnabled() {
  return process.env.EMAIL_ENABLED === "true";
}

function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

async function getActiveRecipients() {
  const db = getDatabase();

  return db.all(`
    SELECT *
    FROM email_recipients
    WHERE is_active = 1
    ORDER BY id ASC
  `);
}

async function sendPptReportEmail(workOrderId) {
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
    workOrderId
  );

  if (!workOrder) {
    throw new Error("Work order not found");
  }

  if (!workOrder.ppt_file_path) {
    throw new Error("PPT is not generated yet");
  }

  const absolutePptPath = getAbsolutePath(workOrder.ppt_file_path);

  if (!fs.existsSync(absolutePptPath)) {
    throw new Error("PPT file is missing from server");
  }

  const recipients = await getActiveRecipients();

  if (recipients.length === 0) {
    throw new Error("No active email recipients found");
  }

  const toEmails = recipients.map((recipient) => recipient.email).join(",");

  const subject = `Work Order Report - ${workOrder.work_order_number}`;

  const html = `
    <div style="font-family: Arial, sans-serif;">
      <h2>Work Order Photo Report</h2>

      <p>Please find attached the generated PowerPoint report.</p>

      <table cellpadding="6" cellspacing="0" border="1" style="border-collapse: collapse;">
        <tr>
          <td><strong>Work Order</strong></td>
          <td>${workOrder.work_order_number || "-"}</td>
        </tr>
        <tr>
          <td><strong>Asset ID</strong></td>
          <td>${workOrder.asset_id || "-"}</td>
        </tr>
        <tr>
          <td><strong>Technician</strong></td>
          <td>${workOrder.technician_name || "-"} (${workOrder.technician_phone || "-"})</td>
        </tr>
        <tr>
          <td><strong>Submitted At</strong></td>
          <td>${workOrder.submitted_at || "-"}</td>
        </tr>
      </table>

      <p style="margin-top: 20px; color: #666;">
        This is an automated email from Work Order App.
      </p>
    </div>
  `;

  if (!isEmailEnabled()) {
    console.log("EMAIL TEST MODE ACTIVE");
    console.log("Email would be sent to:", toEmails);
    console.log("Subject:", subject);
    console.log("Attachment:", absolutePptPath);

    await db.run(
      `
      UPDATE work_orders
      SET email_status = ?, email_sent_at = ?, email_error = ?
      WHERE id = ?
      `,
      [
        "test_mode",
        new Date().toISOString(),
        "EMAIL_ENABLED=false. Email not actually sent.",
        workOrderId,
      ]
    );

    await db.run(
      `
      UPDATE ppt_reports
      SET status = ?, emailed_at = ?, error_message = ?
      WHERE work_order_id = ?
      `,
      [
        "email_test_mode",
        new Date().toISOString(),
        "EMAIL_ENABLED=false. Email not actually sent.",
        workOrderId,
      ]
    );

    return {
      success: true,
      testMode: true,
      message: "Email test mode completed. No real email sent.",
      recipients: toEmails,
    };
  }

  const transporter = createTransporter();

  await transporter.sendMail({
    from: `"${process.env.EMAIL_FROM_NAME || "Work Order App"}" <${process.env.EMAIL_FROM_ADDRESS || process.env.SMTP_USER}>`,
    to: toEmails,
    subject,
    html,
    attachments: [
      {
        filename: path.basename(absolutePptPath),
        path: absolutePptPath,
      },
    ],
  });

  await db.run(
    `
    UPDATE work_orders
    SET email_status = ?, email_sent_at = ?, email_error = ?
    WHERE id = ?
    `,
    ["sent", new Date().toISOString(), "", workOrderId]
  );

  await db.run(
    `
    UPDATE ppt_reports
    SET status = ?, emailed_at = ?, error_message = ?
    WHERE work_order_id = ?
    `,
    ["email_sent", new Date().toISOString(), "", workOrderId]
  );

  return {
    success: true,
    testMode: false,
    message: "Email sent successfully",
    recipients: toEmails,
  };
}

module.exports = {
  sendPptReportEmail,
};