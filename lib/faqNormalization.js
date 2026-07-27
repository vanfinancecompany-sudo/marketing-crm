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
  ) {
    return [parsed];
  }
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
  for (const key of keys) {
    if (item[key] != null) return item[key];
  }
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

export function compareFaqCollections(proposedValue, savedValue) {
  const proposed = normalizeFaqCollection(proposedValue);
  const saved = normalizeFaqCollection(savedValue);
  const max = Math.max(proposed.length, saved.length);

  for (let index = 0; index < max; index += 1) {
    const proposedFaq = proposed[index] || null;
    const savedFaq = saved[index] || null;
    if (!proposedFaq) {
      return {
        equal: false,
        error: {
          field: "faq_json",
          mismatch_type: "unexpected_saved_faq",
          proposal_faq_count: proposed.length,
          saved_faq_count: saved.length,
          mismatched_faq_index: index,
          proposed_question: "",
          proposed_answer: "",
          saved_question: savedFaq?.question || "",
          saved_answer: savedFaq?.answer || "",
        },
      };
    }
    if (!savedFaq) {
      return {
        equal: false,
        error: {
          field: "faq_json",
          mismatch_type: "missing_saved_faq",
          proposal_faq_count: proposed.length,
          saved_faq_count: saved.length,
          mismatched_faq_index: index,
          proposed_question: proposedFaq.question,
          proposed_answer: proposedFaq.answer,
          saved_question: "",
          saved_answer: "",
        },
      };
    }
    if (proposedFaq.question !== savedFaq.question) {
      return {
        equal: false,
        error: {
          field: "faq_json",
          mismatch_type: "question_changed",
          proposal_faq_count: proposed.length,
          saved_faq_count: saved.length,
          mismatched_faq_index: index,
          proposed_question: proposedFaq.question,
          proposed_answer: proposedFaq.answer,
          saved_question: savedFaq.question,
          saved_answer: savedFaq.answer,
        },
      };
    }
    if (proposedFaq.answer !== savedFaq.answer) {
      return {
        equal: false,
        error: {
          field: "faq_json",
          mismatch_type: "answer_changed",
          proposal_faq_count: proposed.length,
          saved_faq_count: saved.length,
          mismatched_faq_index: index,
          proposed_question: proposedFaq.question,
          proposed_answer: proposedFaq.answer,
          saved_question: savedFaq.question,
          saved_answer: savedFaq.answer,
        },
      };
    }
  }

  return { equal: true, proposed, saved, error: null };
}
