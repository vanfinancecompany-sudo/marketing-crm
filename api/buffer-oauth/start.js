import { createBufferOAuthAuthorization } from "../../lib/bufferOAuth.js";

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

  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ ok: false, error: "Method not allowed." });
    return;
  }

  if (!authorize(request)) {
    response.status(401).json({ ok: false, error: "Marketing access key not recognised." });
    return;
  }

  try {
    const authorization = await createBufferOAuthAuthorization();
    response.status(200).json({
      ok: true,
      authorize_url: authorization.authorizeUrl,
      expires_at: authorization.expiresAt,
    });
  } catch (error) {
    console.error("[buffer-oauth] start failed", {
      message: error?.message || String(error),
    });
    response.status(500).json({
      ok: false,
      error: error?.message || "Could not start Buffer authorization.",
    });
  }
}
