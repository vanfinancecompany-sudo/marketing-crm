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
const blockSize = 25;
const targetRegistration = "AF71TVY";

function compactRegistration(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

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

async function alternateWindowProbes(position) {
  const probes = [];
  for (const perPage of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 17, 20, 25]) {
    const page = Math.floor((position - 1) / perPage) + 1;
    const result = await request({ page, perPage });
    const recovered = result.rows.find((row) => row.position === position) || null;
    probes.push({
      perPage,
      page,
      ok: result.ok,
      status: result.status,
      responseBytes: result.responseBytes,
      total: result.total,
      recovered,
    });
  }
  return probes;
}

const first = await request({ page: 1, perPage: blockSize });
const total = first.total || first.rows.length;
const pageCount = Math.max(1, Math.ceil(total / blockSize));
const blocks = [];
const failedBlocks = [];
const targetMatches = [];

for (let page = 1; page <= pageCount; page += 1) {
  const result = page === 1 ? first : await request({ page, perPage: blockSize });
  const start = ((page - 1) * blockSize) + 1;
  const end = Math.min(page * blockSize, total);
  blocks.push({ page, start, end, ok: result.ok, status: result.status, rows: result.rows.length, responseBytes: result.responseBytes });
  if (!result.ok) failedBlocks.push({ page, start, end, status: result.status });
  for (const row of result.rows) {
    if (compactRegistration(row.registration) === targetRegistration) targetMatches.push({ source: `block-${page}`, ...row });
  }
}

const failedPositions = [];
const recoveredPositions = [];
for (const block of failedBlocks) {
  for (let position = block.start; position <= block.end; position += 1) {
    const single = await request({ page: position, perPage: 1 });
    if (single.ok && single.rows[0]) {
      const row = single.rows[0];
      recoveredPositions.push(row);
      if (compactRegistration(row.registration) === targetRegistration) targetMatches.push({ source: `single-${position}`, ...row });
      continue;
    }

    const withSpecifications = await request({ page: position, perPage: 1, specifications: true });
    const specsRow = withSpecifications.ok ? withSpecifications.rows[0] || null : null;
    const alternateWindows = await alternateWindowProbes(position);
    const alternateRecovered = alternateWindows.find((probe) => probe.recovered)?.recovered || null;
    if (alternateRecovered) {
      recoveredPositions.push(alternateRecovered);
      if (compactRegistration(alternateRecovered.registration) === targetRegistration) {
        targetMatches.push({ source: `alternate-${position}`, ...alternateRecovered });
      }
    }
    failedPositions.push({
      position,
      basic: { ok: single.ok, status: single.status, responseBytes: single.responseBytes },
      specifications: {
        ok: withSpecifications.ok,
        status: withSpecifications.status,
        responseBytes: withSpecifications.responseBytes,
        row: specsRow,
      },
      alternateRecovered,
      alternateWindows,
    });
  }
}

console.log("DEALERKIT POSITION DIAGNOSTIC BEGIN");
console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  total,
  blockSize,
  blocks,
  failedBlocks,
  recoveredFromFailedBlocks: recoveredPositions.length,
  failedPositions,
  targetRegistration,
  targetMatches,
}, null, 2));
console.log("DEALERKIT POSITION DIAGNOSTIC END");
