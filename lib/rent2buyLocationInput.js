const clean = (value, limit = 500) => String(value || "").trim().slice(0, limit);

const UK_POSTCODE_COMPACT = /^(GIR0AA|(?:[A-PR-UWYZ][0-9][0-9A-HJKPSTUW]?|[A-PR-UWYZ][A-HK-Y][0-9][0-9ABEHMNPRV-Y]?)[0-9][ABD-HJLNP-UW-Z]{2})$/i;
const POSTCODE_LABEL = /\bpostcode\b/i;
const LOCATION_PROMPT = /\b(?:full home postcode|home postcode|postcode|town|city|where (?:are )?you based|where do you live|where you live|roughly where|cover (?:my|your) area|within \d{2,3} miles|\d{2,3} miles of)\b/i;
const BLOCKED_PLACE_TOKENS = new Set([
  "i", "im", "i'm", "me", "my", "you", "your", "we", "our", "can", "could", "would", "should", "do", "does", "did",
  "is", "are", "am", "was", "were", "have", "has", "had", "want", "need", "get", "got", "help", "tell", "show", "explain",
  "apply", "application", "qualify", "eligible", "accepted", "finance", "finace", "rent2buy", "rent", "buy", "van", "vehicle", "delivery", "deliver",
  "collection", "collect", "postcode", "price", "cost", "month", "monthly", "vat", "insurance", "credit", "deposit", "document", "documents",
  "automatic", "manual", "mileage", "engine", "colour", "color", "yes", "no", "please", "thanks", "thank", "hello", "hi", "bye", "call",
  "what", "why", "how", "when", "where", "who", "which", "looking", "look", "just", "maybe", "sure", "okay", "ok",
  "morning", "anyone", "there", "nice", "self", "emp", "employed", "employment", "trader", "ltd", "limited", "company", "business",
  "transit", "sprinter", "crafter", "tipper", "electric", "medium", "small", "large", "availability", "available",
  "quickly", "urgent", "urgently", "asap", "proceed", "ahead", "start", "ready", "returning", "customer", "same", "team", "human", "speak",
  "quote", "paperwork", "upfront", "refused", "declined", "cancel", "worth", "today", "tomorrow", "next", "week", "weeks", "year", "years",
  "this", "that", "it", "them", "they", "not", "dont", "stopped", "stuck", "finished", "submitted", "complete", "started",
]);

function compactPostcode(value) {
  return clean(value, 40).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function normaliseUkPostcode(value) {
  const compact = compactPostcode(value);
  if (!UK_POSTCODE_COMPACT.test(compact)) return null;
  return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
}

function postcodeLike(value) {
  const compact = compactPostcode(value);
  if (compact.length < 4 || compact.length > 8) return false;
  if (!/^[A-Z]{1,2}/.test(compact)) return false;
  if (!/[0-9]/.test(compact) || !/[A-Z]/.test(compact.slice(2))) return false;
  return /^[A-Z0-9]+$/.test(compact);
}

export function extractTolerantPostcode(question) {
  const text = clean(question, 300).toUpperCase();
  if (!text) return null;

  const labelled = text.match(/\bPOSTCODE\b\s*(?:IS|:|-)?\s*([A-Z0-9][A-Z0-9\s-]{2,12})/i)?.[1];
  const whole = text.length <= 20 ? text : "";
  const candidates = [labelled, whole].filter(Boolean);

  for (const candidate of candidates) {
    const normalised = normaliseUkPostcode(candidate);
    if (normalised) return { query: normalised, type: "full_postcode", input_kind: "normalised_postcode" };
  }

  const embedded = text.match(/\b([A-Z]{1,2}[0-9][A-Z0-9]?[\s-]*[0-9][A-Z]{2})\b/i)?.[1];
  if (embedded) {
    const normalised = normaliseUkPostcode(embedded);
    if (normalised) return { query: normalised, type: "full_postcode", input_kind: "normalised_postcode" };
  }

  const attempt = labelled || whole;
  if ((POSTCODE_LABEL.test(text) || text.length <= 20) && attempt && postcodeLike(attempt)) {
    return { query: clean(attempt, 40).toUpperCase(), type: "postcode_attempt", input_kind: "invalid_postcode" };
  }

  return null;
}

export function extractSafeStandalonePlace(question) {
  const text = clean(question, 120).replace(/[.,;:!]+$/g, "").trim();
  if (!text || text.includes("?") || /\d/.test(text)) return null;
  const parts = text.split(/\s+/).filter(Boolean);
  if (!parts.length || parts.length > 4) return null;
  if (!parts.every((part) => /^[A-Za-z][A-Za-z'’-]*$/.test(part))) return null;
  const words = parts.map((part) => part.toLowerCase().replace(/[’']/g, ""));
  if (words.some((word) => BLOCKED_PLACE_TOKENS.has(word))) return null;
  return { query: text, type: "town_or_city", input_kind: "standalone_place" };
}

export function detectRent2BuyLocationInput(question, previousAssistant = "") {
  const postcode = extractTolerantPostcode(question);
  if (postcode) return postcode;

  const place = extractSafeStandalonePlace(question);
  if (!place) return null;

  return {
    ...place,
    inferred_from: LOCATION_PROMPT.test(clean(previousAssistant, 2000))
      ? "assistant_location_prompt"
      : "standalone_place_candidate",
  };
}
