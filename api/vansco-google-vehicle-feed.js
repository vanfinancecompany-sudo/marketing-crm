import { fetchVanscoMetaCatalogue } from "./_vansco-facebook-source.js";
import { buildGoogleVehicleAdsTsv } from "../lib/googleVehicleAdsFeed.js";

export const config = { maxDuration: 60 };

function clean(value) {
  return String(value ?? "").trim();
}

export default async function handler(request, response) {
  response.setHeader("X-Robots-Tag", "noindex, nofollow");
  response.setHeader("Cache-Control", "public, max-age=0, s-maxage=900, stale-while-revalidate=3600");

  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).send("Method not allowed.");
  }

  const mode = clean(request.query?.mode).toLowerCase() === "full" ? "full" : "pilot";

  try {
    const vehicles = await fetchVanscoMetaCatalogue();
    const feed = buildGoogleVehicleAdsTsv(vehicles, { mode });

    response.setHeader("Content-Type", "text/tab-separated-values; charset=utf-8");
    response.setHeader("Content-Disposition", 'inline; filename="vansco-google-vehicle-ads.tsv"');
    response.setHeader("X-Vansco-Feed-Mode", mode);
    response.setHeader("X-Vansco-Vehicle-Count", String(feed.rows.length));
    response.setHeader("X-Vansco-Eligible-Count", String(feed.eligibleCount));

    if (!feed.rows.length) {
      return response.status(503).send("No Google Vehicle Ads eligible vehicles are currently available.\n");
    }

    return response.status(200).send(feed.tsv);
  } catch (error) {
    console.error("[google-vehicle-ads-feed] failed", {
      message: error?.message || String(error),
    });
    return response.status(503).send("Vehicle feed is temporarily unavailable.\n");
  }
}
