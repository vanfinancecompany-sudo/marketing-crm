import { cleanDealerKitGoogleVehicleAdsCsv } from "../lib/dealerKitGoogleVehicleAdsFeed.js";

export const config = { maxDuration: 60 };

const DEALERKIT_GVA_URL = "https://api.dealerkit.uk/google-vehicle-listing-feed";

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

  const username = clean(process.env.DEALERKIT_GVA_USERNAME);
  const password = clean(process.env.DEALERKIT_GVA_PASSWORD);

  if (!username || !password) {
    console.error("[dealerkit-gva-clean-feed] credentials are not configured");
    return response.status(503).send("Vehicle feed is temporarily unavailable.\n");
  }

  try {
    const authorization = Buffer.from(`${username}:${password}`, "utf8").toString("base64");
    const upstream = await fetch(DEALERKIT_GVA_URL, {
      headers: {
        Accept: "text/csv,text/plain;q=0.9,*/*;q=0.8",
        Authorization: `Basic ${authorization}`,
      },
    });

    if (!upstream.ok) {
      console.error("[dealerkit-gva-clean-feed] DealerKit request failed", {
        status: upstream.status,
      });
      return response.status(503).send("Vehicle feed is temporarily unavailable.\n");
    }

    const sourceCsv = await upstream.text();
    const cleaned = cleanDealerKitGoogleVehicleAdsCsv(sourceCsv);

    if (!cleaned.vehicleCount) {
      console.error("[dealerkit-gva-clean-feed] DealerKit returned no vehicles");
      return response.status(503).send("No Google Vehicle Ads vehicles are currently available.\n");
    }

    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader("Content-Disposition", 'inline; filename="vansco-google-vehicle-listings.csv"');
    response.setHeader("X-Vansco-GVA-Source", "dealerkit");
    response.setHeader("X-Vansco-Vehicle-Count", String(cleaned.vehicleCount));
    response.setHeader("X-Vansco-Descriptions-Cleaned", String(cleaned.cleanedDescriptionCount));

    return response.status(200).send(cleaned.csv);
  } catch (error) {
    console.error("[dealerkit-gva-clean-feed] failed", {
      message: error?.message || String(error),
    });
    return response.status(503).send("Vehicle feed is temporarily unavailable.\n");
  }
}
