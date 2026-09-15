const branch = String(process.env.VERCEL_GIT_COMMIT_REF || "").trim();
const env = String(process.env.VERCEL_ENV || "").trim();

if (env !== "preview" || branch !== "fix/dealerkit-af71tvy-reserved-snapshot") {
  console.log("DEALERKIT AF71 DETAIL DIAGNOSTIC skipped outside the AF71TVY preview branch.");
  process.exit(0);
}

const secret = String(process.env.DEALERKIT_API_SECRET || "").trim();
const dealerId = String(process.env.DEALERKIT_DEALER_ID || "").trim();
if (!secret || !dealerId) {
  console.log("DEALERKIT AF71 DETAIL DIAGNOSTIC unavailable: DealerKit preview credentials are missing.");
  process.exit(0);
}

const targetRegistration = "AF71TVY";
const targetStockId = "c500e0856a9b0c7db4be7";
const origin = "https://api.dealerkit.uk";
const path = "/integrators/stock";

function detailUrl(specifications = false) {
  const url = new URL(`${origin}${path}/${encodeURIComponent(targetStockId)}`);
  url.searchParams.set("dealer_id", dealerId);
  if (specifications) url.searchParams.set("specifications", "true");
  return url;
}

async function probe(specifications = false) {
  const response = await fetch(detailUrl(specifications), {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${secret}`,
      "user-agent": "VFC-DealerKit-AF71-Diagnostic/1.0",
    },
    cache: "no-store",
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
  const row = payload?.data || null;
  return {
    specifications,
    ok: response.ok,
    status: response.status,
    responseBytes: text.length,
    row: row ? {
      id: row?.id ? String(row.id) : null,
      registration: row?.vehicle?.registration || row?.vehicle?.plate || null,
      status: row?.status ?? row?.meta?.status ?? null,
      vehicleType: row?.vehicle?.type || null,
      updatedAt: row?.updated_at ?? row?.meta?.updated_at ?? null,
    } : null,
    errorMessage: !response.ok ? (payload?.message || payload?.error || text.slice(0, 200) || null) : null,
  };
}

const withoutSpecifications = await probe(false);
const withSpecifications = await probe(true);

console.log("DEALERKIT AF71 DETAIL DIAGNOSTIC BEGIN");
console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  targetRegistration,
  targetStockId,
  withoutSpecifications,
  withSpecifications,
}, null, 2));
console.log("DEALERKIT AF71 DETAIL DIAGNOSTIC END");
