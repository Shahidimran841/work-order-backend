const session = require("express-session");
const adminRoutes = require("./routes/admin_routes");

const { getStorageDir } = require("./services/storage_service");
require("dotenv").config();

const fs = require("fs");
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

const uploadsPath = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadsPath)) {
  fs.mkdirSync(uploadsPath, { recursive: true });
}

app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));
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
});app.listen

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Backend healthy",
    timestamp: new Date().toISOString(),
  });
});
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});
app.use("/api/auth", authRoutes);
app.use("/api/work-orders", workOrderRoutes);
app.use("/admin", adminRoutes);
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