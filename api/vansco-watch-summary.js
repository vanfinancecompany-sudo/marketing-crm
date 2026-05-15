import { buildVanscoWatchSummary } from "./_vansco-watch-summary.js";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.status(405).json({ ok: false, message: "Method not allowed." });
    return;
  }

  try {
    const checkedAt = new Date().toISOString();
    const summary = await buildVanscoWatchSummary();

    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.status(200).json({
      ok: true,
      summary,
      checkedAt,
    });
  } catch (error) {
    response.status(200).json({
      ok: false,
      summary: {
        finance: { missing: 0, localNotVansco: 0, latestDetailCheck: "" },
        rent2buy: { missing: 0, localNotVansco: 0, latestDetailCheck: "" },
        cars: { missing: 0, localNotVansco: 0, latestDetailCheck: "" },
      },
      checkedAt: new Date().toISOString(),
      message: error?.message || "Could not load Vansco Stock Watch summary.",
    });
  }
}
