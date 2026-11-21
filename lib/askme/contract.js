// Channel-independent Ask Me contract.
//
// Every channel (VFC website, Rent2Buy website, and later WhatsApp or others)
// converts its own message format into an AskMeRequest, calls the central engine
// in the Marketing CRM, then renders the AskMeResponse in its own way. Business
// knowledge, vehicle data, eligibility policy and answer generation live only in
// the engine. Channel adapters own transport, authentication and rendering.
//
// AskMeRequest {
//   channel:   "website_vfc" | "website_rent2buy" | "whatsapp" | string
//   product:   "finance" | "rent2buy"            (locked; never mixed)
//   message:   string                            (already redacted of sensitive data)
//   history:   [{ role: "user"|"assistant", content }]  (bounded, oldest first)
//   facts:     { ...remembered structured facts } (optional)
//   context: {
//     page_type:      string | null             (website only; null for messaging channels)
//     vehicle:        normalised vehicle | {}   (server-verified; see publicAssistantFoundation)
//     selected_quote: { status: "none"|"verified"|"unverified", ... } (lib/askme/selectedQuote.js)
//   }
//   capabilities: { links: boolean, buttons: boolean }  (what the channel can render)
// }
//
// AskMeResponse {
//   reply:   string                 (plain text, channel-neutral; no HTML or markdown)
//   actions: [{ type: "apply"|"browse_stock"|"contact", label, url }]
//   status:  "ready" | "unavailable"
//   diagnostics: { engine, model, timings_ms, tokens, checks }   (never shown to customers)
// }

const clean = (value, limit = 5000) => String(value ?? "").trim().slice(0, limit);

export const ASKME_PRODUCTS = Object.freeze(["finance", "rent2buy"]);
export const ASKME_ACTION_TYPES = Object.freeze(["apply", "browse_stock", "contact"]);

export function buildAskMeRequest({ channel, product, message, history = [], facts = {}, context = {}, capabilities = {} } = {}) {
  if (!ASKME_PRODUCTS.includes(product)) throw new Error("Ask Me requests need a locked product: finance or rent2buy.");
  const text = clean(message, 3000);
  if (!text) throw new Error("Ask Me requests need a customer message.");
  return {
    channel: clean(channel, 40) || "unknown",
    product,
    message: text,
    history: (Array.isArray(history) ? history : [])
      .map((item) => ({ role: item?.role === "assistant" ? "assistant" : "user", content: clean(item?.content, 2000) }))
      .filter((item) => item.content)
      .slice(-12),
    facts: facts && typeof facts === "object" && !Array.isArray(facts) ? facts : {},
    context: {
      page_type: clean(context.page_type, 40) || null,
      vehicle: context.vehicle && typeof context.vehicle === "object" ? context.vehicle : {},
      selected_quote: context.selected_quote && typeof context.selected_quote === "object" ? context.selected_quote : { status: "none" },
      quote_token: clean(context.quote_token, 4096) || null,
    },
    capabilities: { links: capabilities.links !== false, buttons: capabilities.buttons !== false },
  };
}

// Only relative site paths or https URLs survive; anything else is dropped.
export function safeActionUrl(value) {
  const url = clean(value, 1000);
  if (!url) return null;
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  try { return new URL(url).protocol === "https:" ? url : null; } catch { return null; }
}

export function sanitiseActions(actions = []) {
  return (Array.isArray(actions) ? actions : [])
    .filter((action) => ASKME_ACTION_TYPES.includes(action?.type))
    .map((action) => ({ type: action.type, label: clean(action.label, 60), url: safeActionUrl(action.url) }))
    .filter((action) => action.label && action.url)
    .slice(0, 2);
}
