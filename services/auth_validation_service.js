function normalizePhone(phone) {
  return String(phone || "").trim().replace(/\s+/g, "");
}

function toE164Phone(phone) {
  const value = normalizePhone(phone);

  // Qatar local 8 digit number -> +974XXXXXXXX
  if (/^\d{8}$/.test(value)) {
    return `+974${value}`;
  }

  // Already Qatar international format
  if (/^\+974\d{8}$/.test(value)) {
    return value;
  }

  return value;
}

function isValidPhone(phone) {
  const value = normalizePhone(phone);

  const country = process.env.ALLOWED_PHONE_COUNTRY || "QA";

  if (country === "QA") {
    // Client requirement: Qatar phone number = 8 digits only
    return /^\d{8}$/.test(value);
  }

  if (country === "PK") {
    return /^(03\d{9}|\+923\d{9})$/.test(value);
  }

  return /^\+\d{10,15}$/.test(value);
}

function validatePassword(password) {
  const value = String(password || "");

  const errors = [];

  if (value.length < 8) {
    errors.push("Password must be at least 8 characters");
  }

  if (!/[A-Z]/.test(value)) {
    errors.push("Password must contain at least one uppercase letter");
  }

  if (!/[a-z]/.test(value)) {
    errors.push("Password must contain at least one lowercase letter");
  }

  if (!/[0-9]/.test(value)) {
    errors.push("Password must contain at least one number");
  }

  if (!/[!@#$%^&*(),.?":{}|<>_\-+=]/.test(value)) {
    errors.push("Password must contain at least one special character");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

function createOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function getOtpExpiryDate() {
  const minutes = Number(process.env.OTP_EXPIRY_MINUTES || 10);
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

module.exports = {
  normalizePhone,
  toE164Phone,
  isValidPhone,
  validatePassword,
  createOtp,
  getOtpExpiryDate,
};