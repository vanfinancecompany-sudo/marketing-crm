import crypto from "node:crypto";
import correctionHandler from "./maintenance-correct-rent2buy-opportunity-draft.js";

const RUN_PROJECT_ID = "prj_UA8X61RmObkTDVp8cCkZ5X4oPlHl";
const CORRECTION_PROJECT_ID = "prj_zD76dAe2MHZdBTO08GNFSqOb9UHf";
const RUN_TOKEN_HASH = "09108ed6272b6723e1c3416231b3e2a5530db3115ce4e83a54e60efdffebd37a";

function safeHash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function allowedRuntime(request) {
  const suppliedToken = Array.isArray(request.query?.token)
    ? request.query.token[0]
    : request.query?.token;

  return (
    request.method === "GET" &&
    process.env.VERCEL_ENV === "production" &&
    process.env.VERCEL_PROJECT_ID === RUN_PROJECT_ID &&
    process.env.VERCEL_GIT_COMMIT_REF === "main" &&
    safeHash(suppliedToken) === RUN_TOKEN_HASH
  );
}

export default async function handler(request, response) {
  if (!allowedRuntime(request)) {
    return response.status(404).json({ ok: false, message: "Not found." });
  }

  const originalProjectId = process.env.VERCEL_PROJECT_ID;
  try {
    process.env.VERCEL_PROJECT_ID = CORRECTION_PROJECT_ID;
    return await correctionHandler(request, response);
  } finally {
    process.env.VERCEL_PROJECT_ID = originalProjectId;
  }
}
