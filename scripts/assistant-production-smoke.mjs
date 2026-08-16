import assert from "node:assert/strict";

const baseUrl = String(process.env.ASSISTANT_SMOKE_BASE_URL || "https://marketing-crm-github-work.vercel.app").replace(/\/$/, "");
const endpoint = `${baseUrl}/api/ai-assistant-sitewide`;
const timeoutMs = Math.max(3000, Number(process.env.ASSISTANT_SMOKE_TIMEOUT_MS) || 15000);

const VFC_ORIGIN = "https://www.vanfinancecompany.co.uk";
const VFC_HOME = "https://www.vanfinancecompany.co.uk/";
const R2B_ORIGIN = "https://www.rent2buyvans.co.uk";
const R2B_HOME = "https://www.rent2buyvans.co.uk/";
const CALCULATED_DISTANCE = /approximately\s+\d+(?:\.\d+)?\s+miles?\s+in\s+a\s+straight\s+line\s+from\s+SO40\s+2NN/i;

function safeReply(payload) {
  return String(payload?.reply || "").replace(/\s+/g, " ").trim();
}

function rejectGenericFailure(label, reply) {
  assert.doesNotMatch(reply, /not quite sure what you mean|could you explain that another way|don.?t have enough verified|temporarily unavailable/i, `${label}: generic failure reply: ${reply}`);
}

async function post(origin, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Origin": origin,
        "User-Agent": "VFC-Production-Smoke-Test/1.0",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    assert.equal(response.status, 200, `HTTP ${response.status}: ${JSON.stringify(payload)}`);
    assert.ok(payload?.conversation_id, `Missing conversation_id: ${JSON.stringify(payload)}`);
    assert.ok(safeReply(payload), `Missing reply: ${JSON.stringify(payload)}`);
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function start(origin, pageUrl) {
  return post(origin, { action: "start", page_url: pageUrl });
}

async function message(origin, pageUrl, conversationId, text, productChoice) {
  return post(origin, {
    action: "message",
    page_url: pageUrl,
    conversation_id: conversationId,
    message: text,
    ...(productChoice ? { product_choice: productChoice } : {}),
  });
}

function report(label, payload) {
  const reply = safeReply(payload);
  console.log(`✓ ${label}: ${reply.slice(0, 500)}`);
  return reply;
}

async function financeSmoke() {
  const started = await start(VFC_ORIGIN, VFC_HOME);
  const conversationId = started.conversation_id;
  assert.match(report("VFC homepage start", started), /finance|rent2buy/i);

  const selected = await message(VFC_ORIGIN, VFC_HOME, conversationId, "finance", "finance");
  assert.match(report("Finance selection", selected), /finance/i);

  const vat = await message(VFC_ORIGIN, VFC_HOME, conversationId, "Is VAT included?");
  const vatReply = report("Finance VAT", vat);
  rejectGenericFailure("Finance VAT", vatReply);
  assert.match(vatReply, /vat/i);

  const delivery = await message(VFC_ORIGIN, VFC_HOME, conversationId, "Do you offer delivery?");
  const deliveryReply = report("Finance delivery", delivery);
  rejectGenericFailure("Finance delivery", deliveryReply);
  assert.match(deliveryReply, /deliver|delivery/i);

  const apply = await message(VFC_ORIGIN, VFC_HOME, conversationId, "How do I apply?");
  const applyReply = report("Finance application", apply);
  rejectGenericFailure("Finance application", applyReply);
  assert.match(applyReply, /apply|application/i);

  const inspection = await message(VFC_ORIGIN, VFC_HOME, conversationId, "Are your vans inspected before delivery?");
  const inspectionReply = report("VFC 101-point inspection", inspection);
  rejectGenericFailure("VFC 101-point inspection", inspectionReply);
  assert.match(inspectionReply, /101[- ]?point/i);
  assert.match(inspectionReply, /driver|second|walk[- ]?around/i);

  const wetBelt = await message(VFC_ORIGIN, VFC_HOME, conversationId, "On a Ford Transit Custom, when would you normally not replace the wet belt?");
  const wetBeltReply = report("VFC Ford wet-belt exception", wetBelt);
  rejectGenericFailure("VFC Ford wet-belt exception", wetBeltReply);
  assert.match(wetBeltReply, /wet belt/i);
  assert.match(wetBeltReply, /1,?000\s*miles/i);
  assert.match(wetBeltReply, /6\s*months/i);

  const warranty = await message(VFC_ORIGIN, VFC_HOME, conversationId, "What warranty do I get, and do I have to bring the van back to you if it needs a repair?");
  const warrantyReply = report("VFC in-house warranty", warranty);
  rejectGenericFailure("VFC in-house warranty", warrantyReply);
  assert.match(warrantyReply, /3\s*months/i);
  assert.match(warrantyReply, /3,?000\s*miles/i);
  assert.match(warrantyReply, /local garage|garage local/i);

  const afterSales = await message(VFC_ORIGIN, VFC_HOME, conversationId, "What should I do if there is a problem with my van after delivery?");
  const afterSalesReply = report("VFC after-sales", afterSales);
  rejectGenericFailure("VFC after-sales", afterSalesReply);
  assert.match(afterSalesReply, /after[- ]?sales|contact us|email|whatsapp/i);
  assert.match(afterSalesReply, /photo|video|local garage|garage local/i);

  const reservation = await message(VFC_ORIGIN, VFC_HOME, conversationId, "How much do I pay to reserve a van, and when is the rest of my deposit due?");
  const reservationReply = report("VFC reservation deposit", reservation);
  rejectGenericFailure("VFC reservation deposit", reservationReply);
  assert.match(reservationReply, /£?100/);
  assert.match(reservationReply, /day before delivery/i);

  const turnaround = await message(VFC_ORIGIN, VFC_HOME, conversationId, "How long does remote van delivery usually take?");
  const turnaroundReply = report("VFC remote delivery timeframe", turnaround);
  rejectGenericFailure("VFC remote delivery timeframe", turnaroundReply);
  assert.match(turnaroundReply, /7\s*(?:–|-|to)\s*10\s*working days/i);
  assert.match(turnaroundReply, /typical|usually|subject|not guaranteed/i);

  const cancellation = await message(VFC_ORIGIN, VFC_HOME, conversationId, "If I cancel my finance agreement within 14 days, does that automatically cancel the vehicle sale too?");
  const cancellationReply = report("VFC cancellation-rights separation", cancellation);
  rejectGenericFailure("VFC cancellation-rights separation", cancellationReply);
  assert.match(cancellationReply, /separate|does not automatically|doesn't automatically|not automatically/i);
  assert.match(cancellationReply, /finance|credit/i);
  assert.match(cancellationReply, /vehicle|sale/i);
}

async function rent2BuySmoke() {
  const started = await start(R2B_ORIGIN, R2B_HOME);
  const conversationId = started.conversation_id;
  assert.match(report("Rent2Buy standalone start", started), /rent2buy/i);

  const eligibility = await message(R2B_ORIGIN, R2B_HOME, conversationId, "Can I get a van?");
  const eligibilityReply = report("Rent2Buy eligibility", eligibility);
  rejectGenericFailure("Rent2Buy eligibility", eligibilityReply);
  assert.match(eligibilityReply, /no credit check|affordab/i);

  const compactPostcode = await message(R2B_ORIGIN, R2B_HOME, conversationId, "BH23-1QH");
  const postcodeReply = report("Rent2Buy tolerant postcode", compactPostcode);
  rejectGenericFailure("Rent2Buy tolerant postcode", postcodeReply);
  assert.match(postcodeReply, CALCULATED_DISTANCE);
  assert.match(postcodeReply, /within our normal 100-mile Rent2Buy area/i);

  const outside = await message(R2B_ORIGIN, R2B_HOME, conversationId, "M1 1AE");
  const outsideReply = report("Rent2Buy outside postcode", outside);
  rejectGenericFailure("Rent2Buy outside postcode", outsideReply);
  assert.match(outsideReply, CALCULATED_DISTANCE);
  assert.match(outsideReply, /outside our normal 100-mile Rent2Buy area/i);

  const town = await message(R2B_ORIGIN, R2B_HOME, conversationId, "Bournemouth");
  const townReply = report("Rent2Buy standalone town", town);
  rejectGenericFailure("Rent2Buy standalone town", townReply);
  assert.match(townReply, CALCULATED_DISTANCE);
  assert.match(townReply, /indicative town\/city result/i);
  assert.match(townReply, /full home postcode/i);

  const invalidPostcode = await message(R2B_ORIGIN, R2B_HOME, conversationId, "BH23 1Q");
  const invalidReply = report("Rent2Buy invalid postcode correction", invalidPostcode);
  rejectGenericFailure("Rent2Buy invalid postcode correction", invalidReply);
  assert.match(invalidReply, /looks like a postcode/i);
  assert.match(invalidReply, /can.?t verify/i);
  assert.match(invalidReply, /full home postcode/i);

  const delivery = await message(R2B_ORIGIN, R2B_HOME, conversationId, "Do you deliver?");
  const deliveryReply = report("Rent2Buy collection", delivery);
  rejectGenericFailure("Rent2Buy collection", deliveryReply);
  assert.match(deliveryReply, /collect|southampton/i);
}

console.log(`Running production assistant smoke test against ${endpoint}`);
await financeSmoke();
await rent2BuySmoke();
console.log("✓ Production assistant smoke test passed");
