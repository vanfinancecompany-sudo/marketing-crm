// Ask Me golden-question suite: runs the agreed questions against a CRM deployment on
// both engines and checks actual reply content, actions and timings.
//
//   ASKME_BASE_URL=https://<crm-preview> [ASKME_SHARE_URL=<vercel share link>] node scripts/askme-golden-suite.mjs
//
// Test traffic only: every visitor id starts with "askme-test-", which keeps it out of
// customer telemetry. Uses dummy vehicle fixtures; never submits applications.

const BASE = (process.env.ASKME_BASE_URL || "").replace(/\/$/, "");
const SHARE = process.env.ASKME_SHARE_URL || "";
const ENGINES = (process.env.ASKME_ENGINES || "lean,legacy").split(",");
const PACE_MS = Number(process.env.ASKME_PACE_MS || 4300); // CRM limit: 15 requests/minute per IP
if (!BASE) { console.error("Set ASKME_BASE_URL"); process.exit(2); }

const VFC = "https://www.vanfinancecompany.co.uk";
const R2B = "https://www.rent2buyvans.co.uk";
const REFUSAL = /can.t confirm|cannot confirm|not enough verified|don.t have enough|won.t guess|unable to confirm|check (?:that|the) vehicle.s pricing/i;
const PROMISE = /you(?:'ll| will) (?:be|get) (?:approved|accepted)|guaranteed (?:approval|acceptance)/i;

const van = { registration: "TE57VAN", vehicle_kind: "van", title: "Ford Transit Custom 300 L1 Trend", year: "2022", mileage: "38,500", fuel: "Diesel", transmission: "Manual", stock_status: "available", specification: "MILEAGE: 38,500\nFUEL TYPE: DIESEL\nTRANSMISSION: MANUAL\nENGINE SIZE: 2.0\nBHP: 130", apply_link: "/apply?vehicle=TE57VAN", pricing: { finance_monthly: "£389", finance_retail_vat: "£18,995 +VAT" }, vat_status: "Plus VAT" };
const reservedVan = { ...van, registration: "TE57RES", stock_status: "reserved", apply_link: null };
const car = { registration: "TE57CAR", vehicle_kind: "car", title: "Toyota Land Cruiser Invincible", year: "2021", mileage: "41,000", fuel: "Diesel", transmission: "Automatic", stock_status: "available", specification: "MILEAGE: 41,000\nFUEL TYPE: DIESEL\nTRANSMISSION: AUTOMATIC", apply_link: "/apply?vehicle=TE57CAR", pricing: { finance_monthly: "£1,470", finance_retail_vat: "£69,995" } };
const r2bVan = { registration: "TE57RTB", title: "MAXUS eDeliver 9 L3", stock_status: "available", specification: "MILEAGE: 12,000\nFUEL TYPE: ELECTRIC", apply_link: "/apply-for-no-credit-check-rent2buy-vans?registration=TE57RTB", pricing: { rent2buy_initial: "£2,190", rent2buy_monthly: "£525" }, term_months: 48 };

const financeGeneral = { origin: VFC, page: { page_type: "finance_general" } };
const financeVan = { origin: VFC, page: { page_type: "finance_vehicle", vehicle: van } };
const financeReserved = { origin: VFC, page: { page_type: "finance_vehicle", vehicle: reservedVan } };
const financeCar = { origin: VFC, page: { page_type: "finance_vehicle", vehicle: car } };
const r2bGeneral = { origin: R2B, page: { page_type: "rent2buy_general" } };
const r2bVehicle = { origin: R2B, page: { page_type: "rent2buy_general", vehicle: r2bVan } };

// [id, question group, context, messages[], required regexes (last reply), forbidden regexes, expected action type | null]
const CASES = [
  ["Q1", "VFC upfront+monthly", financeVan, ["What would I pay upfront and per month?"], [/£389/, /£18,995/], [REFUSAL], "apply"],
  ["Q1b", "VFC monthly rephrase", financeVan, ["How much is this one a month?"], [/£389/], [REFUSAL], "apply"],
  ["Q1c", "VFC car page monthly", financeCar, ["What are the monthly payments on this car?"], [/£1,470/], [REFUSAL], "apply"],
  ["Q2", "VFC poor credit", financeGeneral, ["Can I apply with poor credit?"], [/\b(?:yes|can apply|can still apply|you can)\b/i], [REFUSAL, PROMISE, /rent\s?2\s?buy/i], null],
  ["Q2b", "VFC bad credit rephrase", financeGeneral, ["Can I get finance with bad credit?"], [/\b(?:yes|can apply|can still apply|you can)\b/i], [REFUSAL, PROMISE], null],
  ["Q2c", "VFC CCJ", financeGeneral, ["I've got a CCJ, can I still apply?"], [/\b(?:yes|can apply|can still apply|you can)\b/i], [REFUSAL, PROMISE], null],
  ["Q3", "VFC find a van", financeGeneral, ["Can you help me find a van?"], [/\?/, /\b(?:use|using|size|need|budget|work|carry|job)\b/i], [REFUSAL], null],
  ["Q3b", "VFC find a Transit", financeGeneral, ["Can you help me find a Transit?"], [/\?/], [REFUSAL], null],
  ["Q3c", "VFC find a van follow-up", financeGeneral, ["Can you help me find a van?", "It's for building work, I can afford about £400 a month"], [/\S/], [REFUSAL, /£(?!400\b)\d/], null],
  ["Q4", "VFC key specs", financeVan, ["What are this van's key specs?"], [/38,500/, /diesel/i, /manual/i], [REFUSAL], null],
  ["Q4b", "VFC mileage", financeVan, ["What's the mileage on this van?"], [/38,500/], [REFUSAL], null],
  ["Q4c", "VFC car specs", financeCar, ["Is this car automatic?"], [/automatic/i], [REFUSAL], null],
  ["Q4d", "VFC reserved van", financeReserved, ["Can I apply for this van?"], [/reserved/i], [PROMISE], "browse_stock"],
  ["R1", "R2B area", r2bGeneral, ["Is Rent2Buy available in my area?"], [/100/, /Southampton|postcode|town|location/i], [/\blenders?\b|\bAPR\b/i], null],
  ["R1b", "R2B postcode", r2bGeneral, ["Do you cover Bournemouth?"], [/\S/], [/\blenders?\b|\bAPR\b/i], null],
  ["R2", "R2B upfront+monthly", r2bVehicle, ["What's due upfront and per month?"], [/£2,190/, /£525/, /calculator/i], [REFUSAL], "apply"],
  ["R2b", "R2B monthly rephrase", r2bVehicle, ["How much is this one a month?"], [/£525/], [REFUSAL], "apply"],
  ["R2c", "R2B unverifiable quote", { ...r2bVehicle, page: { ...r2bVehicle.page, selected_quote_token: "v1.bm90LWEtcmVhbC10b2tlbg.bm90LWEtc2lnbmF0dXJl" } }, ["How much per month?"], [/couldn.t verify|re-check/i], [/£\s?6\d\d\b/], null],
  ["R3", "R2B self-employed", r2bGeneral, ["Can I apply if I'm self-employed?"], [/\b(?:yes|can apply|you can)\b/i], [REFUSAL, PROMISE, /\blenders?\b|\bAPR\b|credit approval/i], null],
  ["R3b", "R2B self-employed rephrase", r2bGeneral, ["I'm self-employed. Will Rent2Buy consider me?"], [/\b(?:yes|can apply|you can|will consider|considered)\b/i], [REFUSAL, PROMISE], null],
];

let cookie = "";
async function authorise() {
  if (!SHARE) return;
  const response = await fetch(SHARE, { redirect: "manual" });
  const set = response.headers.getSetCookie?.() || [response.headers.get("set-cookie")].filter(Boolean);
  cookie = set.map((value) => value.split(";")[0]).join("; ");
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let last = 0;
async function call(origin, body) {
  const wait = last + PACE_MS - Date.now();
  if (wait > 0) await sleep(wait);
  last = Date.now();
  const started = performance.now();
  const response = await fetch(`${BASE}/api/ai-assistant-customer`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  const json = await response.json().catch(() => ({}));
  return { ms: Math.round(performance.now() - started), status: response.status, json };
}

await authorise();
const results = [];
for (const engine of ENGINES) {
  for (const [id, group, context, messages, required, forbidden, action] of CASES) {
    const visitor = `askme-test-golden-${engine}`;
    const start = await call(context.origin, { action: "start", page_context: context.page, analytics_visitor_id: visitor, askme_engine: engine });
    let reply = null;
    for (const message of messages) {
      reply = await call(context.origin, { action: "message", conversation_id: start.json.conversation_id, page_context: context.page, message, analytics_visitor_id: visitor, askme_engine: engine });
    }
    const text = reply?.json?.reply || "";
    const failures = [];
    if (reply?.status !== 200) failures.push(`http_${reply?.status}`);
    for (const pattern of required) if (!pattern.test(text)) failures.push(`missing ${pattern}`);
    for (const pattern of forbidden) if (pattern.test(text)) failures.push(`forbidden ${pattern}`);
    const actions = reply?.json?.actions || [];
    if (action && actions[0]?.type !== action) failures.push(`action expected ${action}, got ${actions[0]?.type || "none"}`);
    results.push({ engine, id, group, pass: failures.length === 0, failures, start_ms: start.ms, message_ms: reply?.ms, diagnostics: reply?.json?.diagnostics || null, reply: text, actions });
    console.log(JSON.stringify(results.at(-1)));
  }
}

const pct = (values, p) => { const sorted = values.filter(Number.isFinite).sort((a, b) => a - b); return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : null; };
const summary = {};
for (const engine of ENGINES) {
  const rows = results.filter((row) => row.engine === engine);
  const times = rows.map((row) => row.message_ms);
  const modelRows = rows.filter((row) => row.diagnostics?.path === "model" || row.diagnostics?.path === "model_rejected");
  summary[engine] = {
    passed: rows.filter((row) => row.pass).length,
    total: rows.length,
    message_ms_p50: pct(times, 50),
    message_ms_p95: pct(times, 95),
    start_ms_p50: pct(rows.map((row) => row.start_ms), 50),
    tokens_in_avg: modelRows.length ? Math.round(modelRows.reduce((sum, row) => sum + (row.diagnostics?.tokens?.input || 0), 0) / modelRows.length) : null,
    tokens_out_avg: modelRows.length ? Math.round(modelRows.reduce((sum, row) => sum + (row.diagnostics?.tokens?.output || 0), 0) / modelRows.length) : null,
  };
}
console.log("SUMMARY " + JSON.stringify(summary));
