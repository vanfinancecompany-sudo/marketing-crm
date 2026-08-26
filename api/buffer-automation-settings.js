import {
  loadBufferAutomationConfig,
  saveBufferAutomationConfig,
} from "../lib/bufferAutomationConfig.js";
import { normalizeBufferAutomationConfig } from "../lib/bufferAutomation.js";

const ACCESS_HEADER = "x-marketing-customer-database-key";

function authorize(request) {
  const expected = process.env.MARKETING_CUSTOMER_DATABASE_API_KEY;
  const supplied = String(request.headers[ACCESS_HEADER] || "");
  const authorization = String(request.headers.authorization || "");
  return Boolean(
    expected &&
      (supplied === expected ||
        (authorization.startsWith("Bearer ") && authorization.slice(7) === expected)),
  );
}

function parseBody(request) {
  if (!request.body) return {};
  if (typeof request.body === "object") return request.body;
  try {
    return JSON.parse(String(request.body));
  } catch {
    return {};
  }
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (!authorize(request)) {
    response.status(401).json({ ok: false, error: "Marketing access key not recognised." });
    return;
  }

  if (request.method === "GET") {
    response.status(200).json({
      ok: true,
      config: await loadBufferAutomationConfig({ useDailyTargets: false }),
    });
    return;
  }

  if (request.method !== "POST") {
    response.setHeader("Allow", "GET, POST");
    response.status(405).json({ ok: false, error: "Method not allowed." });
    return;
  }

  try {
    const body = parseBody(request);
    const current = await loadBufferAutomationConfig({ useDailyTargets: false });
    const next = normalizeBufferAutomationConfig({ ...current, ...(body.config || body) });
    if (next.enabled && !current.enabled && body.confirmEnable !== "ENABLE_BUFFER_AUTOMATION") {
      response.status(400).json({ ok: false, error: "Enabling live automation requires explicit confirmation." });
      return;
    }
    const config = await saveBufferAutomationConfig(next);
    response.status(200).json({ ok: true, config });
  } catch (error) {
    response.status(500).json({
      ok: false,
      error: error?.message || "Could not save Buffer automation settings.",
    });
  }
}
