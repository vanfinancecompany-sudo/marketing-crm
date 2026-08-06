const clean = (value, limit = 5000) => String(value || "").trim().slice(0, limit);

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function buildCanonicalConversationInput({ session, message, requestId, history }) {
  const productContext = clean(session?.product_lock, 20).toLowerCase();
  if (!["finance", "rent2buy"].includes(productContext)) {
    throw new Error("A canonical product context is required before running the customer conversation.");
  }

  return {
    request_id: clean(requestId, 100),
    session_id: clean(session?.id, 100),
    message: clean(message, 3000),
    product_context: productContext,
    messages: Array.isArray(history) ? history : [],
    remembered_facts: {
      ...object(session?.remembered_facts),
      product_context: productContext,
    },
    journey_state: object(session?.journey_state),
  };
}

export function canonicalSessionState({ session, result, productLock }) {
  const productContext = clean(productLock || session?.product_lock, 20).toLowerCase();
  const resultFacts = object(result?.remembered_facts);
  const previousFacts = object(session?.remembered_facts);
  const rememberedFacts = {
    ...(Object.keys(resultFacts).length ? resultFacts : previousFacts),
    product_context: productContext,
  };

  return {
    product_lock: productContext,
    remembered_facts: rememberedFacts,
    journey_state: object(result),
    application_readiness: clean(result?.application_readiness, 100) || "Exploring",
    budget: clean(rememberedFacts.budget_monthly_gbp ?? rememberedFacts.budget, 100) || null,
    employment: clean(rememberedFacts.employment_status, 100) || null,
    last_competence_result_id: clean(result?.id, 100) || null,
  };
}
