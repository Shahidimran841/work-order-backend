const {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
} = require("firebase-admin/app");

const { getAuth } = require("firebase-admin/auth");

function getFirebaseCredential() {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  if (serviceAccountJson) {
    let serviceAccount;

    try {
      serviceAccount = JSON.parse(serviceAccountJson);
    } catch {
      throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON contains invalid JSON");
    }

    const configuredProjectId = process.env.FIREBASE_PROJECT_ID;

    if (
      configuredProjectId &&
      serviceAccount.project_id !== configuredProjectId
    ) {
      throw new Error(
        "Firebase service-account project does not match FIREBASE_PROJECT_ID",
      );
    }

    return cert(serviceAccount);
  }

  return applicationDefault();
}

function getFirebaseAuth() {
  if (getApps().length === 0) {
    const projectId = process.env.FIREBASE_PROJECT_ID;

    if (!projectId) {
      throw new Error("FIREBASE_PROJECT_ID is required");
    }

    initializeApp({
      credential: getFirebaseCredential(),
      projectId,
    });
  }

  return getAuth();
}

function createAuthenticationError(message) {
  const error = new Error(message);
  error.statusCode = 401;
  return error;
}

async function verifyFirebasePhoneToken(
  idToken,
  { maxAuthAgeSeconds = 10 * 60, checkRevoked = true } = {},
) {
  const token = String(idToken || "").trim();

  if (!token) {
    throw createAuthenticationError(
      "Firebase phone verification token is required",
    );
  }

  const decodedToken = await getFirebaseAuth().verifyIdToken(
    token,
    checkRevoked,
  );

  if (decodedToken.firebase?.sign_in_provider !== "phone") {
    throw createAuthenticationError("Phone verification is required");
  }

  const phoneNumber = decodedToken.phone_number;

  if (!phoneNumber) {
    throw createAuthenticationError("Verified phone number was not found");
  }

  const authenticationTime = Number(decodedToken.auth_time);
  const currentTime = Math.floor(Date.now() / 1000);

  if (
    !authenticationTime ||
    currentTime - authenticationTime > maxAuthAgeSeconds
  ) {
    throw createAuthenticationError(
      "Phone verification has expired. Please request a new OTP.",
    );
  }

  return {
    firebaseUid: decodedToken.uid,
    phoneNumber,
  };
}

module.exports = {
  getFirebaseAuth,
  verifyFirebasePhoneToken,
};
