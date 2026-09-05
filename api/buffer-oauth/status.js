import { getBufferOAuthStatus } from "../../lib/bufferOAuth.js";

const ACCESS_HEADER = "x-marketing-customer-database-key";

function authorize(request) {
  const expected = String(process.env.MARKETING_CUSTOMER_DATABASE_API_KEY || "");
  const supplied = String(request.headers[ACCESS_HEADER] || "");
  const authorization = String(request.headers.authorization || "");
  return Boolean(
    expected
      && (supplied === expected
        || (authorization.startsWith("Bearer ") && authorization.slice(7) === expected)),
  );
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ ok: false, error: "Method not allowed." });
    return;
  }
  if (!authorize(request)) {
    response.status(401).json({ ok: false, error: "Marketing access key not recognised." });
    return;
  }

  try {
    const status = await getBufferOAuthStatus();
    response.status(200).json({ ok: true, ...status });
  } catch (error) {
    console.error("[buffer-oauth] status failed", {
      message: error?.message || String(error),
    });
    response.status(500).json({ ok: false, error: "Could not read Buffer authorization status." });
  }
}
