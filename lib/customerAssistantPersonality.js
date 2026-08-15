const clean = (value, limit = 5000) => String(value ?? "").trim().slice(0, limit);

const SENSITIVE_CONTEXT = /\b(?:declined|decline|ccj|poor credit|bad credit|credit problem|debt|arrears?|missed payment|financial difficult|struggl|can(?:not|'t) afford|complaint|refund|legal|court|fraud|scam|bereav|accident|angry|upset|vulnerab|hardship)\b/i;
const PRICE_CONTEXT = /\b(?:expensive|price|cost|costing|monthly|per month|how much|payment|payments)\b/i;
const VAN_CHOICE_CONTEXT = /\b(?:what van|which van|what size|which size|not sure (?:what|which).{0,20}van|need a van but|van size)\b/i;

function teamVoice(reply) {
  let value = clean(reply);
  if (!value) return value;

  const replacements = [
    [/\bVan Finance Company offers\b/gi, "we offer"],
    [/\bVan Finance Company provides\b/gi, "we provide"],
    [/\bVan Finance Company can\b/gi, "we can"],
    [/\bVan Finance Company will\b/gi, "we will"],
    [/\bVan Finance Company has\b/gi, "we have"],
    [/\bVan Finance Company uses\b/gi, "we use"],
    [/\bRent2Buy Vans offers\b/gi, "we offer"],
    [/\bRent2Buy Vans provides\b/gi, "we provide"],
    [/\bRent2Buy Vans can\b/gi, "we can"],
    [/\bRent2Buy Vans will\b/gi, "we will"],
    [/\bRent2Buy Vans has\b/gi, "we have"],
    [/\bRent2Buy Vans uses\b/gi, "we use"],
    [/\ba member of the team\b/gi, "one of our team"],
    [/\bthe team can confirm\b/gi, "our team can confirm"],
    [/\bthe team to confirm\b/gi, "our team to confirm"],
    [/\bI can help with\b/g, "We can help with"],
    [/\bI can help you\b/g, "We can help you"],
    [/\bPlease check the vehicle listing on the website\b/gi, "Please check the vehicle listing here on our website"],
  ];

  for (const [pattern, replacement] of replacements) value = value.replace(pattern, replacement);
  return value;
}

function stableIndex(value, length) {
  let hash = 0;
  for (const character of clean(value, 1000)) hash = ((hash * 31) + character.charCodeAt(0)) >>> 0;
  return length ? hash % length : 0;
}

function humourLine({ message = "", reply = "" } = {}) {
  const question = clean(message, 3000);
  const answer = clean(reply, 5000);
  if (!question || !answer || SENSITIVE_CONTEXT.test(`${question} ${answer}`)) return "";

  if (PRICE_CONTEXT.test(question) && /(?:£|monthly|per month|payment)/i.test(answer)) {
    const candidates = [
      "I won’t pretend the monthly figure is pocket change. The useful question is whether the van and the numbers earn their keep.",
      "It’s not exactly loose-change territory. What matters is whether the van and the monthly figure make sense for the job.",
      "The calculator is unlikely to send us a thank-you card. The important bit is whether the van and the numbers work for you.",
    ];
    return candidates[stableIndex(question, candidates.length)];
  }

  if (VAN_CHOICE_CONTEXT.test(question)) {
    const candidates = [
      "Van sizes can turn into alphabet soup surprisingly quickly, so we’ll keep it simple.",
      "There are enough van sizes and wheelbases to make a filing cabinet nervous, so we’ll narrow it down properly.",
      "Choosing a van can become a small geography lesson in wheelbases, so we’ll keep it practical.",
    ];
    return candidates[stableIndex(question, candidates.length)];
  }

  return "";
}

function insertHumour(reply, humour) {
  if (!humour || clean(reply).includes(humour)) return clean(reply);
  const value = clean(reply);
  const questionIndex = value.lastIndexOf("?");
  if (questionIndex === value.length - 1) {
    const sentenceStart = Math.max(value.lastIndexOf(". ", questionIndex - 1), value.lastIndexOf("! ", questionIndex - 1), value.lastIndexOf("? ", questionIndex - 1));
    if (sentenceStart >= 0) return `${value.slice(0, sentenceStart + 1)} ${humour} ${value.slice(sentenceStart + 2)}`.replace(/\s+/g, " ").trim();
  }
  return `${value} ${humour}`.trim();
}

export function applyCustomerAssistantPersonality(reply, { message = "", status = "ready" } = {}) {
  const original = clean(reply);
  if (!original) return original;
  if (!["ready", "needs_product"].includes(clean(status, 40))) return original;

  const voiced = teamVoice(original);
  const humour = humourLine({ message, reply: voiced });
  return insertHumour(voiced, humour);
}

export function personaliseCustomerPayload(payload, context = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || typeof payload.reply !== "string") return payload;
  return {
    ...payload,
    reply: applyCustomerAssistantPersonality(payload.reply, {
      message: context.message,
      status: payload.status,
    }),
  };
}
