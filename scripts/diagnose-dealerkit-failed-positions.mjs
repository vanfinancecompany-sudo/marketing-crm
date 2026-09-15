const branch = String(process.env.VERCEL_GIT_COMMIT_REF || "").trim();
const env = String(process.env.VERCEL_ENV || "").trim();

if (env !== "preview" || branch !== "fix/dealerkit-af71tvy-reserved-snapshot") {
  console.log("DEALERKIT POSITION DIAGNOSTIC skipped outside the AF71TVY preview branch.");
  process.exit(0);
}

const secret = String(process.env.DEALERKIT_API_SECRET || "").trim();
const dealerId = String(process.env.DEALERKIT_DEALER_ID || "").trim();
if (!secret || !dealerId) {
  console.log("DEALERKIT POSITION DIAGNOSTIC unavailable: DealerKit preview credentials are missing.");
  process.exit(0);
}

const origin = "https://api.dealerkit.uk";
const path = "/integrators/stock";

function stockUrl({ page, perPage, specifications = false }) {
  const url = new URL(`${origin}${path}`);
  url.searchParams.set("dealer_id", dealerId);
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", String(perPage));
  if (specifications) url.searchParams.set("specifications", "true");
  return url;
}

async function request({ page, perPage, specifications = false }) {
  const response = await fetch(stockUrl({ page, perPage, specifications }), {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${secret}`,
      "user-agent": "VFC-DealerKit-Position-Diagnostic/1.0",
    },
    cache: "no-store",
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  return {
    ok: response.ok,
    status: response.status,
    responseBytes: text.length,
    total: Number(payload?.meta?.total ?? 0) || null,
    currentPage: Number(payload?.meta?.current_page ?? payload?.meta?.currentPage ?? 0) || null,
    lastPage: Number(payload?.meta?.last_page ?? payload?.meta?.lastPage ?? 0) || null,
    rows: rows.map((row, index) => ({
      position: ((page - 1) * perPage) + index + 1,
      id: row?.id ? String(row.id) : null,
      registration: row?.vehicle?.registration || row?.vehicle?.plate || null,
      status: row?.status ?? row?.meta?.status ?? null,
      vehicleType: row?.vehicle?.type || null,
    })),
  };
}

async function diagnose(position) {
  const probes = [];
  for (const shape of [
    { perPage: 1, specifications: false },
    { perPage: 1, specifications: true },
    { perPage: 2, specifications: false },
    { perPage: 3, specifications: false },
    { perPage: 4, specifications: false },
    { perPage: 5, specifications: false },
    { perPage: 10, specifications: false },
    { perPage: 25, specifications: false },
  ]) {
    const page = Math.floor((position - 1) / shape.perPage) + 1;
    const result = await request({ page, perPage: shape.perPage, specifications: shape.specifications });
    probes.push({ position, page, perPage: shape.perPage, specifications: shape.specifications, ...result });
  }

  const neighbours = [];
  for (const p of [position - 2, position - 1, position + 1, position + 2].filter((value) => value > 0)) {
    neighbours.push({ requestedPosition: p, ...(await request({ page: p, perPage: 1 })) });
  }
  return { position, probes, neighbours };
}

const results = [];
for (const position of [225, 229]) results.push(await diagnose(position));

console.log("DEALERKIT POSITION DIAGNOSTIC BEGIN");
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2));
console.log("DEALERKIT POSITION DIAGNOSTIC END");
