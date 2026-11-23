import { randomUUID } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";
import { draftMarketplaceReply } from "./assistant.mjs";

const SITES = {
  finance: { url: "https://www.vanfinancecompany.co.uk/api/jasmine", page_type: "finance_general" },
  rent2buy: { url: "https://www.rent2buyvans.co.uk/api/jasmine", page_type: "rent2buy_general" },
};

const CASES = {
  rent2buy: [
    ["reservation", "What is the Rent2Buy vehicle reservation payment?"],
    ["initial rental follow-up", "Is that separate from the initial rental?"],
    ["mileage", "How does the mileage allowance work, and what happens if I go over it?"],
    ["mileage follow-up", "Can I choose a higher allowance in the calculator?"],
    ["eligibility", "Can I apply if I'm self-employed?"],
    ["eligibility follow-up", "What proof would I typically need if that's how I earn my income?"],
    ["early return", "Can I return the van before the agreement ends?"],
    ["early return follow-up", "Would the initial rental be refundable if I did that?"],
  ],
  finance: [
    ["finance eligibility", "Can I apply for van finance if I'm self-employed?"],
    ["finance documents", "What documents would I typically need?"],
  ],
};

let nextRequestAt = 0;
const runId = randomUUID();

async function post(site, payload) {
  await wait(Math.max(0, nextRequestAt - performance.now()));
  const started = performance.now();
  nextRequestAt = started + 4_300;
  const response = await fetch(site.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, page_context: { page_type: site.page_type } }),
    signal: AbortSignal.timeout(45_000),
    redirect: "error",
  });
  const body = await response.json();
  const requestMs = performance.now() - started;
  if (!response.ok) throw new Error(`Website returned HTTP ${response.status} (${body.status || "unknown"})`);
  return { body, requestMs: Math.round(requestMs) };
}

async function openSession(site, variant) {
  const visitor = "askme-test-marketplace-bench-" + runId.slice(0, 8) + "-" + variant + "-" + randomUUID();
  const { body, requestMs } = await post(site, { action: "start", analytics_visitor_id: visitor });
  if (!body.conversation_id || body.status !== "ready") throw new Error("Website did not create a product-specific QA session");
  console.log(JSON.stringify({ event: "start", variant, page: site.page_type, requestMs }));
  return { visitor, id: body.conversation_id };
}

function send(site, session, message) {
  return post(site, {
    action: "message",
    conversation_id: session.id,
    analytics_visitor_id: session.visitor,
    message,
  });
}

async function adapterTurn(product, session, message, history) {
  let requestMs = null;
  let response = null;
  let adapterMs = null;
  const draft = await draftMarketplaceReply({ product, message, history }, {
    respond: async (request) => {
      if (request.product !== product || request.channel !== "marketplace") throw new Error("Adapter changed product or channel");
      const result = await send(SITES[request.product], session, request.message);
      requestMs = result.requestMs;
      response = result.body;
      return response;
    },
    onAdapterTime: (ms) => { adapterMs = Number(ms.toFixed(3)); },
  });
  return { requestMs, adapterMs, draft, response };
}

function publicAnswer(result) {
  return { status: result?.status || null, reply: result?.reply || null, actions: result?.actions?.map((action) => action.type) || [] };
}

async function main() {
  // A production website benchmark creates labelled synthetic sessions.
  // The existing production website endpoint records its ordinary telemetry.
  console.log(JSON.stringify({ event: "benchmark", runId }));
  for (const [product, questions] of Object.entries(CASES)) {
    const site = SITES[product];
    let website = await openSession(site, "website");
    let marketplace = await openSession(site, "adapter");
    const history = [];
    for (const [index, [topic, message]] of questions.entries()) {
      let baseline, adapted;
      // Alternate order to avoid always warming one path for the other.
      if (index % 2 === 0) {
        baseline = await send(site, website, message);
        adapted = await adapterTurn(product, marketplace, message, history);
      } else {
        adapted = await adapterTurn(product, marketplace, message, history);
        baseline = await send(site, website, message);
      }
      if (adapted.draft.text) history.push({ role: "user", content: message }, { role: "assistant", content: adapted.draft.text });
      console.log(JSON.stringify({
        event: "pair", product, topic,
        websiteMs: baseline.requestMs, adapterRequestMs: adapted.requestMs, adapterMs: adapted.adapterMs,
        website: publicAnswer(baseline.body), engineForAdapter: publicAnswer(adapted.response),
        handoff: adapted.draft.reason || null,
      }));
      if (adapted.draft.reason && index < questions.length - 1) {
        website = await openSession(site, "website");
        marketplace = await openSession(site, "adapter");
        history.length = 0;
      }
    }

    if (product === "rent2buy") {
      for (const [topic, message] of [
        ["cross-product", "Can a lender finance this and what APR does it charge?"],
        ["human requested", "I want to speak to a person about my application."],
        ["unverified stock request", "Can you confirm a 7 am tomorrow delivery slot and promise this vehicle is available?"],
      ]) {
        const adapted = await adapterTurn(product, marketplace, message, history);
        console.log(JSON.stringify({
          event: "safety", product, topic, adapterRequestMs: adapted.requestMs, adapterMs: adapted.adapterMs,
          engineForAdapter: publicAnswer(adapted.response), handoff: adapted.draft.reason || null,
        }));
      }
    }
  }
}

if (!process.argv.includes("--live-website")) {
  console.error("Pass --live-website to run labelled synthetic requests through the public website paths.");
  process.exitCode = 2;
} else {
  await main().catch((error) => {
    console.error("Benchmark stopped: " + error.message);
    process.exitCode = 1;
  });
}
