// Calls the same public Ask Me endpoints the websites use, so Marketplace replies
// come from the deployed engine, model configuration and approved knowledge.
// One website conversation is kept per Facebook thread, which gives Ask Me its
// own conversation memory in addition to the history the adapter passes.
import { randomUUID } from "node:crypto";

export const ASKME_SITES = {
  finance: { url: "https://www.vanfinancecompany.co.uk/api/jasmine", page_type: "finance_general" },
  rent2buy: { url: "https://www.rent2buyvans.co.uk/api/jasmine", page_type: "rent2buy_general" },
};

async function post(site, payload, fetchImpl) {
  const response = await fetchImpl(site.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, page_context: { page_type: site.page_type } }),
    signal: AbortSignal.timeout(45_000),
    redirect: "error",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("Ask Me returned HTTP " + response.status);
  return body;
}

// thread.conversation is persisted by the caller in the ledger.
export function liveResponder(thread, { fetchImpl = fetch } = {}) {
  return async (request) => {
    const site = ASKME_SITES[request.product];
    if (!site) throw new Error("No Ask Me site for product");
    if (!thread.conversation || thread.conversation.product !== request.product) {
      const visitor = "marketplace-assistant-" + thread.id + "-" + randomUUID().slice(0, 8);
      const started = await post(site, { action: "start", analytics_visitor_id: visitor }, fetchImpl);
      if (!started.conversation_id || started.status !== "ready") throw new Error("Ask Me did not start a conversation");
      thread.conversation = { id: started.conversation_id, visitor, product: request.product };
    }
    return post(site, {
      action: "message",
      conversation_id: thread.conversation.id,
      analytics_visitor_id: thread.conversation.visitor,
      message: request.message,
    }, fetchImpl);
  };
}
