const FAQ_WRAPPER_KEYS = ["faq_json", "faqs", "items", "questions", "entries", "data"];

function parseFaqValue(value) {
  if (value == null || value === "") return [];
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return [];
  try {
    return JSON.parse(trimmed);
  } catch {
    return [];
  }
}

function unwrapFaqCollection(value) {
  const parsed = parseFaqValue(value);
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== "object") return [];
  for (const key of FAQ_WRAPPER_KEYS) {
    if (Object.hasOwn(parsed, key)) return unwrapFaqCollection(parsed[key]);
  }
  if (
    Object.hasOwn(parsed, "question") ||
    Object.hasOwn(parsed, "answer") ||
    Object.hasOwn(parsed, "question_text") ||
    Object.hasOwn(parsed, "answer_text")
  ) return [parsed];
  return [];
}

export function normalizeFaqText(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function faqField(item, keys) {
  if (!item || typeof item !== "object") return "";
  for (const key of keys) if (item[key] != null) return item[key];
  return "";
}

export function normalizeFaqCollection(value) {
  return unwrapFaqCollection(value)
    .map((item) => ({
      question: normalizeFaqText(faqField(item, ["question", "question_text", "title", "q"])),
      answer: normalizeFaqText(faqField(item, ["answer", "answer_text", "content", "body", "a"])),
    }))
    .filter((item) => item.question || item.answer);
}

function faqError(type, index, proposed, saved, proposedCount, savedCount) {
  const proposedFaq = proposed || { question: "", answer: "" };
  const savedFaq = saved || { question: "", answer: "" };
  const humanIndex = index + 1;
  return {
    field: `faq_json — FAQ ${humanIndex} ${type}; proposal count ${proposedCount}, saved count ${savedCount}; proposed Q: “${proposedFaq.question}”; proposed A: “${proposedFaq.answer}”; saved Q: “${savedFaq.question}”; saved A: “${savedFaq.answer}”`,
    exact_field: "faq_json",
    mismatch_type: type,
    proposal_faq_count: proposedCount,
    saved_faq_count: savedCount,
    mismatched_faq_index: index,
    proposed_question: proposedFaq.question,
    proposed_answer: proposedFaq.answer,
    saved_question: savedFaq.question,
    saved_answer: savedFaq.answer,
  };
}

export function compareFaqCollections(proposedValue, savedValue) {
  const proposed = normalizeFaqCollection(proposedValue);
  const saved = normalizeFaqCollection(savedValue);
  const max = Math.max(proposed.length, saved.length);

  for (let index = 0; index < max; index += 1) {
    const proposedFaq = proposed[index] || null;
    const savedFaq = saved[index] || null;
    if (!proposedFaq) return { equal: false, error: faqError("unexpected_saved_faq", index, null, savedFaq, proposed.length, saved.length) };
    if (!savedFaq) return { equal: false, error: faqError("missing_saved_faq", index, proposedFaq, null, proposed.length, saved.length) };
    if (proposedFaq.question !== savedFaq.question) return { equal: false, error: faqError("question_changed", index, proposedFaq, savedFaq, proposed.length, saved.length) };
    if (proposedFaq.answer !== savedFaq.answer) return { equal: false, error: faqError("answer_changed", index, proposedFaq, savedFaq, proposed.length, saved.length) };
  }

  return { equal: true, proposed, saved, error: null };
}
