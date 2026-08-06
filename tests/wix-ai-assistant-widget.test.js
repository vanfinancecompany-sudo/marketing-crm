import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  FINANCE_APPLICATION_URL,
  RENT2BUY_APPLICATION_URL,
  createWidgetReadyHandshake,
  createWidgetState,
  endpointPageContext,
  escapeHtml,
  normaliseWidgetPageContext,
  reduceWidgetState,
  safeAssistantResponse,
  safeWidgetCta,
  widgetRequest,
} from "../public/wix-ai-assistant/widget-core.mjs";

const financeVehicle = {
  pageType: "finance_vehicle",
  productContext: "finance",
  vehicle: { registration: "AB12 CDE", stockId: "stock-1", title: "Transit Custom", applicationMode: "page_form", formAnchor: "#finance-application" },
};

test("widget opens and closes without discarding conversation state", () => {
  const initial = { ...createWidgetState(), conversationId: "conversation-1", messages: [{ role: "assistant", content: "Hello" }] };
  const opened = reduceWidgetState(initial, { type: "open" });
  const closed = reduceWidgetState(opened, { type: "close" });
  assert.equal(opened.open, true);
  assert.equal(closed.open, false);
  assert.equal(closed.conversationId, "conversation-1");
  assert.equal(closed.messages.length, 1);
});

test("session start request contains the immutable Wix page context", () => {
  const request = widgetRequest({ action: "start", pageContext: financeVehicle });
  assert.equal(request.action, "start");
  assert.equal(request.pageContext.pageType, "finance_vehicle");
  assert.equal(request.pageContext.productContext, "finance");
  assert.equal(request.conversationId, null);
});

test("sending a message continues only the returned anonymous session", () => {
  const request = widgetRequest({ action: "message", message: "Can I apply?", conversationId: "conversation-1", pageContext: financeVehicle });
  assert.equal(request.action, "message");
  assert.equal(request.message, "Can I apply?");
  assert.equal(request.conversationId, "conversation-1");
  assert.equal(JSON.stringify(request).includes("AI_ASSISTANT_SESSION_SECRET"), false);
});

test("restart clears visible conversation state before requesting a new session", () => {
  const current = { ...createWidgetState(), open: true, initialised: true, pageContext: financeVehicle, conversationId: "old", messages: [{ role: "customer", content: "Hello" }] };
  const restarted = reduceWidgetState(current, { type: "restart" });
  const request = widgetRequest({ action: "restart", conversationId: current.conversationId, pageContext: financeVehicle });
  assert.equal(restarted.open, true);
  assert.equal(restarted.conversationId, null);
  assert.deepEqual(restarted.messages, []);
  assert.equal(request.action, "restart");
});

test("initialisation is idempotent when Wix replies to repeated readiness messages", () => {
  const initial = createWidgetState();
  const first = reduceWidgetState(initial, { type: "initialise", pageContext: financeVehicle, conversationId: "conversation-1" });
  const duplicate = reduceWidgetState(first, { type: "initialise", pageContext: financeVehicle, conversationId: "different-conversation" });
  assert.equal(duplicate, first);
  assert.equal(duplicate.conversationId, "conversation-1");
});

test("delayed Wix parent registration still receives widget readiness and initialises once", () => {
  let retry = null;
  let cancelled = 0;
  let parentAdapter = null;
  let widgetState = createWidgetState();
  let initialisations = 0;
  const messages = [];
  const handshake = createWidgetReadyHandshake({
    announce(message) { parentAdapter?.(message); },
    schedule(callback) { retry = callback; return 1; },
    cancel() { cancelled += 1; },
  });

  handshake.start();
  assert.equal(messages.length, 0, "the first readiness message may precede Wix page-code registration");
  parentAdapter = (message) => {
    messages.push(message);
    const nextState = reduceWidgetState(widgetState, { type: "initialise", pageContext: financeVehicle, conversationId: "conversation-1" });
    if (nextState !== widgetState) initialisations += 1;
    widgetState = nextState;
    handshake.acknowledge();
  };
  retry();
  retry();

  assert.deepEqual(messages, [{ channel: "vfc-ai-assistant-widget-v1", type: "widget_ready" }]);
  assert.equal(widgetState.initialised, true);
  assert.equal(initialisations, 1);
  assert.equal(handshake.acknowledged, true);
  assert.equal(cancelled, 1);
});

test("already-registered Wix parent initialises on the first readiness message without scheduling retries", () => {
  let scheduled = 0;
  let handshake;
  handshake = createWidgetReadyHandshake({
    announce() { handshake.acknowledge(); },
    schedule() { scheduled += 1; return 1; },
  });
  handshake.start();
  assert.equal(handshake.acknowledged, true);
  assert.equal(scheduled, 0);
});

test("loading and retry state retain one safe retry request", () => {
  const request = widgetRequest({ action: "message", message: "What documents do I need?", conversationId: "conversation-1", pageContext: financeVehicle });
  const loading = reduceWidgetState({ ...createWidgetState(), pageContext: financeVehicle }, { type: "request", request, customerMessage: request.message });
  const failed = reduceWidgetState(loading, { type: "error" });
  assert.equal(loading.loading, true);
  assert.equal(loading.messages.length, 1);
  assert.equal(failed.loading, false);
  assert.deepEqual(failed.retryRequest, request);
});

test("Finance vehicle CTA can only scroll to the configured current-page form", () => {
  const cta = safeWidgetCta({ label: "Apply for this van", action: "open_current_page_finance_application", behavior: "same_page", url: null }, financeVehicle);
  assert.deepEqual(cta, { type: "scroll_to_form", target: "#finance-application", label: "Apply for this van" });
  assert.equal(safeWidgetCta({ label: "Start", action: "navigate", behavior: "same_window", url: FINANCE_APPLICATION_URL }, financeVehicle), null);
});

test("general Finance CTA uses the approved same-window URL only", () => {
  const context = { pageType: "finance_general", productContext: "finance", vehicle: { applicationMode: "generic" } };
  assert.deepEqual(safeWidgetCta({ label: "Start Finance Application", action: "navigate", behavior: "same_window", url: FINANCE_APPLICATION_URL }, context), {
    type: "navigate_same_window", url: FINANCE_APPLICATION_URL, label: "Start Finance Application",
  });
  assert.equal(safeWidgetCta({ label: "Unsafe", action: "navigate", behavior: "same_window", url: "https://evil.example/apply" }, context), null);
});

test("general Rent2Buy CTA uses the approved same-window URL only", () => {
  const context = { pageType: "rent2buy_general", productContext: "rent2buy", vehicle: { applicationMode: "generic" } };
  assert.deepEqual(safeWidgetCta({ label: "Start Rent2Buy Application", action: "navigate", behavior: "same_window", url: RENT2BUY_APPLICATION_URL }, context), {
    type: "navigate_same_window", url: RENT2BUY_APPLICATION_URL, label: "Start Rent2Buy Application",
  });
  assert.equal(safeWidgetCta({ label: "Wrong", action: "navigate", behavior: "same_window", url: FINANCE_APPLICATION_URL }, context), null);
});

test("homepage exposes product choice and preserves the chosen product in subsequent requests", () => {
  const homepage = { pageType: "homepage", productContext: null, vehicle: { applicationMode: "generic" } };
  const initialised = reduceWidgetState(createWidgetState(), { type: "initialise", pageContext: homepage, conversationId: null });
  const choice = widgetRequest({ action: "message", message: "Rent2Buy", productChoice: "rent2buy", conversationId: "conversation-1", pageContext: { ...homepage, productContext: "rent2buy" } });
  assert.equal(initialised.status, "needs_product");
  assert.equal(choice.productChoice, "rent2buy");
  assert.equal(choice.pageContext.productContext, "rent2buy");
});

test("page context cannot be guessed, switched or leak client-only application controls to the API", () => {
  assert.throws(() => normaliseWidgetPageContext({}), /pageType/);
  assert.throws(() => normaliseWidgetPageContext({ pageType: "finance_general", productContext: "rent2buy" }), /cannot be changed/);
  const endpoint = endpointPageContext(financeVehicle);
  assert.deepEqual(endpoint, { pageType: "finance_vehicle", vehicle: { registration: "AB12 CDE", vehicle_id: "stock-1", title: "Transit Custom" } });
  assert.equal("formAnchor" in endpoint.vehicle, false);
  assert.equal("applicationMode" in endpoint.vehicle, false);
});

test("assistant response strips unknown fields and rejects arbitrary CTA actions", () => {
  const safe = safeAssistantResponse({
    reply: "Hello", conversation_id: "conversation-1", status: "ready",
    cta: { label: "Click", action: "run_javascript", behavior: "same_window", url: "javascript:alert(1)" },
    prompts: "hidden", diagnostics: { confidence: 99 }, sources: ["secret"],
  }, financeVehicle);
  assert.deepEqual(Object.keys(safe).sort(), ["conversation_id", "cta", "reply", "status"]);
  assert.equal(safe.cta, null);
  assert.equal(JSON.stringify(safe).includes("hidden"), false);
});

test("customer and assistant HTML is escaped before rendering", () => {
  assert.equal(escapeHtml('<img src=x onerror="alert(1)">'), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  assert.equal(escapeHtml("Tom & Co's"), "Tom &amp; Co&#39;s");
});

test("entry point includes responsive mobile layout, accessible controls and keyboard send", async () => {
  const [widget, embed] = await Promise.all([
    readFile(new URL("../public/wix-ai-assistant/widget.mjs", import.meta.url), "utf8"),
    readFile(new URL("../public/wix-ai-assistant/embed.html", import.meta.url), "utf8"),
  ]);
  assert.match(widget, /@media \(max-width:520px\)/);
  assert.match(widget, /aria-label="Open Van Finance assistant"/);
  assert.match(widget, /role="dialog"/);
  assert.match(widget, /event\.key === "Enter" && !event\.shiftKey/);
  assert.match(widget, /Assistant is typing/);
  assert.match(widget, /Please do not send bank details, passwords or card information/);
  assert.match(embed, /window\.parent\.postMessage/);
  assert.match(embed, /await import\("\.\/widget\.mjs"\)/);
  assert.ok(embed.indexOf("addEventListener(\"vfc-ai-request\"") < embed.indexOf("await import(\"./widget.mjs\")"));
  assert.match(embed, /handshake\.acknowledge\(\)/);
});

test("hosted embed route has a Wix-only frame policy without weakening other CRM routes", async () => {
  const configuration = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  const embedPolicy = configuration.headers?.find((entry) => entry.source === "/wix-ai-assistant/embed.html");
  assert.ok(embedPolicy, "the hosted widget must have an explicit route-scoped frame policy");

  const configuredHeaders = new Map(embedPolicy.headers.map((header) => [header.key.toLowerCase(), header.value]));
  assert.equal(configuredHeaders.has("x-frame-options"), false, "X-Frame-Options must not conflict with the multi-origin CSP policy");
  assert.equal(
    configuredHeaders.get("content-security-policy"),
    "frame-ancestors 'self' https://vanfinancecompany.co.uk https://www.vanfinancecompany.co.uk https://editor.wix.com https://manage.wix.com https://www.wix.com https://*.wixsite.com",
  );
  assert.equal(configuredHeaders.get("content-security-policy").includes("frame-ancestors *"), false);
  assert.equal(configuration.headers.length, 1, "the framing exception must not apply to other CRM routes");
});

test("Wix adapter calls only the public endpoint, stores only conversation IDs and validates CTA actions twice", async () => {
  const [adapter, configurations] = await Promise.all([
    readFile(new URL("../wix/aiAssistantPageAdapter.js", import.meta.url), "utf8"),
    readFile(new URL("../wix/aiAssistantConfigurations.js", import.meta.url), "utf8"),
  ]);
  assert.match(configurations, /\/api\/ai-assistant-customer/);
  assert.match(adapter, /local\.setItem\(storageKey, safe\.conversation_id\)/);
  assert.match(adapter, /open_current_page_finance_application/);
  assert.match(adapter, /\[FINANCE_APPLICATION_URL, RENT2BUY_APPLICATION_URL\]\.includes/);
  assert.doesNotMatch(adapter, /AI_ASSISTANT_SESSION_SECRET|OPENAI_API_KEY|Business Brain|diagnostics|sources/);
});
