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
const SUITE = process.env.ASKME_SUITE || "all"; // golden | knowledge | all | review | conversation
const CASE_IDS = (process.env.ASKME_CASES || "").split(",").filter(Boolean);
if (!BASE) { console.error("Set ASKME_BASE_URL"); process.exit(2); }

const VFC = "https://www.vanfinancecompany.co.uk";
const R2B = "https://www.rent2buyvans.co.uk";
const REFUSAL = /can.t confirm|cannot confirm|not enough verified|don.t have enough|won.t guess|unable to confirm|check (?:that|the) vehicle.s pricing/i;
const GEARBOX_COVER = /(?:generally |typically |normally |usually )?(?:covers? (?:the |major components including )?(?:gearbox|transmission)|(?:gearbox|transmission)(?: is| are)? (?:generally |typically |normally |usually )?(?:covered|included))|(?:gearbox|transmission).{0,30}(?:part of|comes under) (?:the )?(?:warranty|cover)/i;
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
  ["Q3c", "VFC find a van follow-up", financeGeneral, ["Can you help me find a van?", "It's for building work, I can afford about £400 a month"], [/\S/], [REFUSAL, /leave that one for the team/i, /£(?!400\b)\d/], null],
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

// Knowledge set: detailed questions that need the Knowledge Hub / Business Brain.
// [.., required, forbidden, action, minPassages] — minPassages applies to the lean engine only.
const KNOWLEDGE_CASES = [
  ["K1", "warranty coverage", financeVan, ["Does the warranty cover the gearbox and engine?"], [/warrant/i], [PROMISE], null, 1],
  ["K2", "warranty exclusions", financeGeneral, ["What isn't covered by the warranty?"], [/warrant/i], [PROMISE], null, 1],
  ["K3", "insurance", financeGeneral, ["Do I need to have insurance in place before I collect the van?"], [/insur/i], [PROMISE], null, 1],
  ["K4", "finance documents", financeGeneral, ["What documents do I need to apply for finance?"], [/\b(?:licen[cs]e|bank|address|ID|statement|document)/i], [PROMISE, /rent\s?2\s?buy/i], null, 1],
  ["K5", "R2B documents", r2bGeneral, ["What documents do I need for Rent2Buy?"], [/\b(?:licen[cs]e|bank|address|ID|statement|document)/i], [PROMISE, /\blenders?\b|\bAPR\b/i], null, 1],
  ["K6", "new business", financeGeneral, ["I've only been trading for three months, can I still get finance?"], [/\S/], [PROMISE], null, 0],
  ["K7", "VAT explained", financeVan, ["Can you explain how the VAT works on this van?"], [/VAT/], [PROMISE], null, 0],
  ["K8", "deposit explained", financeGeneral, ["How does the deposit work, and is it refundable?"], [/deposit/i], [PROMISE], null, 1],
  ["K9", "R2B agreement + early end", r2bGeneral, ["What happens if I want to end the Rent2Buy agreement early?"], [/\S/], [PROMISE, /\blenders?\b|\bAPR\b/i], null, 1],
  ["K10", "delivery", financeGeneral, ["Can you deliver the van to me and how long does it take?"], [/deliver/i], [PROMISE], null, 1],
  ["K11", "collection", r2bGeneral, ["Can I collect the van myself?"], [/collect/i], [PROMISE], null, 0],
  ["K12", "multi-part", financeGeneral, ["What documents do I need, and do I need insurance before delivery?"], [/insur/i, /\b(?:licen[cs]e|bank|address|ID|statement|document)/i], [PROMISE], null, 2],
  ["K13", "follow-up turn", financeGeneral, ["Do your vans come with a warranty?", "Does that include the gearbox?"], [GEARBOX_COVER], [PROMISE], null, 1],
  ["K14", "multi-turn context", financeVan, ["How much is this one a month?", "What would I need to bring to apply?"], [/\b(?:licen[cs]e|bank|address|ID|statement|document)/i], [PROMISE], null, 1],
  ["K15", "not in knowledge", financeGeneral, ["Do you sell boats or jet skis?"], [/\S/], [PROMISE, /£\d/], null, 0],
  ["K16", "not in knowledge 2", r2bGeneral, ["Can I pay the monthly rental in Bitcoin?"], [/\b(?:team|confirm|check|don.t|not)\b/i], [PROMISE], null, 0],
];

// Multi-turn customer journeys: same session, added requirements and corrections.
// Run with ASKME_SUITE=conversation and ASKME_ENGINES=lean.
const CONVERSATION_CASES = [
  ["C1", "VFC natural van-finding", financeGeneral, [
    "Can you help me find a van for plumbing work?",
    "It must be automatic.",
    "I can spend around £400 a month.",
    "I'll need to carry ladders and tools as well.",
    "Okay, what should I do next?"
  ], [/van|vehicle|stock|browse|ladder|carry|load|size|use|work/i], [REFUSAL, PROMISE], null, 0],
  ["C2", "VFC corrects gearbox requirement", financeGeneral, [
    "I'm looking for a manual Transit for furniture deliveries.",
    "Actually, I've changed my mind. It must be automatic.",
    "My business has only been trading for a few months.",
    "Can I still apply?",
    "What gearbox did I say I needed?"
  ], [/automatic/i], [/you (?:said|wanted|need) manual/i, PROMISE], null, 0],
  ["C3", "Rent2Buy topics across five turns", r2bGeneral, [
    "I'm self-employed and thinking about Rent2Buy.",
    "What documents would you need from me?",
    "Would there be a credit check?",
    "What if I wanted to finish the agreement early?",
    "And do I need insurance before collection?"
  ], [/insur/i], [PROMISE, /\blenders?\b|\bAPR\b/i], null, 1],
  ["C4", "Rent2Buy reservation payment versus rental", r2bVehicle, [
    "How much is this one per month?",
    "What is the £200 vehicle reservation payment?",
    "Is that separate from the initial rental?"
  ], [/separate|different|not (?:the )?same|in addition/i, /reservation|holding deposit|£200/i], [PROMISE, /£525.*£2,190|£2,190.*£525/], null, 0],
];

// Extra natural phrasing and release-gate scenarios. Run separately from the 36 cases.
const REVIEW_CASES = [
  ["I1", "warranty reference on a vehicle page", financeVan, ["Do your vans come with a warranty?", "Does that include the gearbox?"], [GEARBOX_COVER], [PROMISE, /manual gearbox/i], null, 1],
  ["I2", "plain-English proof and insurance", financeGeneral, ["What ID, address or income proof do I need, and do I need insurance before delivery?"], [/identity|\bID\b|licen[cs]e/i, /address/i, /insurance/i], [PROMISE, /rent\s?2\s?buy/i], null, 2],
  ["I3", "Rent2Buy application route", r2bGeneral, ["I'm ready to start the actual Rent2Buy application. Where do I go?"], [/apply|application/i], [PROMISE, /\blenders?\b|\bAPR\b/i], "apply"],
  ["I4", "Rent2Buy geographic wording", r2bGeneral, ["I live quite a way from Southampton. How far away can applicants live?"], [/100/, /driving miles/i], [PROMISE, /lenders?|APR/i], null, 0],
  ["I5", "Rent2Buy paperwork and ownership separated", r2bGeneral, ["Do you need proof of my address or bank statements before I can be accepted?"], [/address/i, /bank statement/i], [PROMISE, /\blenders?\b|\bAPR\b/i], null, 1],
  ["I6", "unknown pricing policy fallback", financeGeneral, ["Can I pay the finance deposit with Bitcoin or gold bullion?"], [/team|confirm|check|don.t know|not confirmed/i], [PROMISE, /accept (?:Bitcoin|gold bullion)/i], null, 0],
  ["I7", "Rent2Buy guarantor policy", r2bGeneral, ["Could somebody else guarantee the Rent2Buy payments for me? Can I use a guarantor?"], [/guarantor/i, /not|cannot|can.t|don.t/i], [PROMISE, /\blenders?\b|\bAPR\b/i], null, 0],
  ["I8", "warranty reference on general page", financeGeneral, ["Do your vans come with a warranty?", "Does that include the gearbox?"], [GEARBOX_COVER], [PROMISE], null, 1],
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
  const cases = SUITE === "conversation" ? CONVERSATION_CASES : SUITE === "review" ? REVIEW_CASES : [...(SUITE === "knowledge" ? [] : CASES), ...(SUITE === "golden" ? [] : KNOWLEDGE_CASES)];
  for (const [id, group, context, messages, required, forbidden, action, minPassages = 0] of cases.filter(([id]) => !CASE_IDS.length || CASE_IDS.includes(id))) {
    const visitor = `askme-test-golden-${engine}`;
    const start = await call(context.origin, { action: "start", page_context: context.page, analytics_visitor_id: visitor, askme_engine: engine });
    const turns = [];
    for (const message of start.json.conversation_id ? messages : []) {
      turns.push(await call(context.origin, { action: "message", conversation_id: start.json.conversation_id, page_context: context.page, message, analytics_visitor_id: visitor, askme_engine: engine }));
    }
    const reply = turns.at(-1);
    const text = reply?.json?.reply || "";
    const failures = [];
    if (start.status !== 200 || !start.json.conversation_id) failures.push("start http_" + start.status);
    if (turns.slice(0, -1).some((turn) => turn.status !== 200)) failures.push("earlier turn failed");
    if (reply?.status !== 200) failures.push(`http_${reply?.status}`);
    for (const pattern of required) if (!pattern.test(text)) failures.push(`missing ${pattern}`);
    for (const pattern of forbidden) if (pattern.test(text)) failures.push(`forbidden ${pattern}`);
    const actions = reply?.json?.actions || [];
    if (action && actions[0]?.type !== action) failures.push(`action expected ${action}, got ${actions[0]?.type || "none"}`);
    const passages = reply?.json?.diagnostics?.retrieval?.passages || [];
    if (engine === "lean" && passages.length < minPassages) failures.push(`expected >= ${minPassages} passages, got ${passages.length}`);
    results.push({ engine, id, group, pass: failures.length === 0, failures, start_ms: start.ms, message_ms: reply?.ms, path: reply?.json?.diagnostics?.path || null, retrieval_ms: reply?.json?.diagnostics?.timings_ms?.retrieval_ms ?? null, knowledge_cache_hit: reply?.json?.diagnostics?.retrieval?.cache_hit ?? null, model: reply?.json?.diagnostics?.model ?? null, turns: turns.map((turn) => ({ status: turn.status, ms: turn.ms, model: turn.json.diagnostics?.model, cache_hit: turn.json.diagnostics?.retrieval?.cache_hit, retrieval_ms: turn.json.diagnostics?.timings_ms?.retrieval_ms })), passages: passages.map((item) => `${item.title} — ${item.heading} (${item.score})`), tokens: reply?.json?.diagnostics?.tokens || null, reply: text, actions });
    console.log(JSON.stringify(results.at(-1)));
  }
}

const pct = (values, p) => { const sorted = values.filter(Number.isFinite).sort((a, b) => a - b); return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : null; };
const summary = {};
for (const engine of ENGINES) {
  const rows = results.filter((row) => row.engine === engine);
  const times = rows.map((row) => row.message_ms);
  const modelRows = rows.filter((row) => /^model/.test(row.path || ""));
  const byPath = {};
  for (const row of rows) (byPath[row.path || "n/a"] ||= []).push(row.message_ms);
  summary[engine] = {
    passed: rows.filter((row) => row.pass).length,
    total: rows.length,
    message_ms_p50: pct(times, 50),
    message_ms_p95: pct(times, 95),
    start_ms_p50: pct(rows.map((row) => row.start_ms), 50),
    tokens_in_avg: modelRows.length ? Math.round(modelRows.reduce((sum, row) => sum + (row.tokens?.input || 0), 0) / modelRows.length) : null,
    tokens_out_avg: modelRows.length ? Math.round(modelRows.reduce((sum, row) => sum + (row.tokens?.output || 0), 0) / modelRows.length) : null,
    retrieval_ms_p95: pct(rows.map((row) => row.retrieval_ms), 95),
    by_path: Object.fromEntries(Object.entries(byPath).map(([path, values]) => [path, { n: values.length, p50: pct(values, 50), p95: pct(values, 95) }])),
    failed: rows.filter((row) => !row.pass).map((row) => row.id),
  };
}
console.log("SUMMARY " + JSON.stringify(summary));
