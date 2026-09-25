import {
  loadVanscoBufferConfig,
  loadVanscoBufferState,
} from "./_vansco-buffer-runtime.js";

const ACCESS_HEADER = "x-marketing-customer-database-key";

function clean(value) {
  return String(value ?? "").trim();
}

function authorize(request) {
  const expected = clean(process.env.MARKETING_CUSTOMER_DATABASE_API_KEY);
  const supplied = clean(request.headers[ACCESS_HEADER]);
  const authorization = clean(request.headers.authorization);
  return Boolean(
    expected &&
    (supplied === expected || authorization === `Bearer ${expected}`),
  );
}

function londonDateKey(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (!["GET", "POST"].includes(request.method)) {
    response.setHeader("Allow", "GET, POST");
    return response.status(405).json({ ok: false, error: "Method not allowed." });
  }
  if (!authorize(request)) {
    return response.status(401).json({ ok: false, error: "Marketing access key not recognised." });
  }

  try {
    const bufferConfigured = Boolean(String(process.env.VANSCO_BUFFER_API_KEY || "").trim());
    if (!bufferConfigured) {
      return response.status(200).json({
        ok: true,
        connected: false,
        missingVariable: "VANSCO_BUFFER_API_KEY",
        message: "Add the dedicated Vansco Buffer API key to this Vercel environment, then verify again.",
      });
    }

    const config = await loadVanscoBufferConfig({ forceDiscovery: true });
    const dateKey = londonDateKey();
    const state = await loadVanscoBufferState(config, `${dateKey}T12:00:00.000Z`);
    return response.status(200).json({
      ok: true,
      connected: true,
      organizationName: config.organizationName,
      channelName: config.channelName,
      externalLink: config.externalLink,
      scheduledPostsLimit: config.scheduledPostsLimit,
      dailyPostingLimit: state.limit?.limit ?? null,
      sentToday: state.limit?.sent ?? 0,
      scheduledToday: state.limit?.scheduled ?? 0,
      queuedNow: state.posts.length,
      verifiedAt: new Date().toISOString(),
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      connected: false,
      error: String(error?.message || "Could not verify the Vansco Buffer connection.").slice(0, 300),
    });
  }
}
