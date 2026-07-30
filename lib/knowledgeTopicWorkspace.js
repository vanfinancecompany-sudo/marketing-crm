const clean = (value) => String(value || "").trim();

export function normalizeTopicText(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function topicIntentText(topic = {}) {
  return clean(topic.canonical_intent || topic.intent || topic.customer_question || topic.title);
}

function tokens(value) {
  return new Set(normalizeTopicText(value).split(" ").filter((token) => token.length > 2));
}

export function topicSimilarity(left, right) {
  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  if (!leftTokens.size || !rightTokens.size) return 0;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return intersection / Math.max(leftTokens.size, rightTokens.size);
}

export function duplicateTopicRisk(candidate = {}, existing = {}) {
  const titleA = normalizeTopicText(candidate.title);
  const titleB = normalizeTopicText(existing.title);
  const intentA = normalizeTopicText(topicIntentText(candidate));
  const intentB = normalizeTopicText(topicIntentText(existing));
  if (titleA && titleA === titleB) return { risk: "duplicate", reason: "normalised_title" };
  if (intentA && intentA === intentB) return { risk: "duplicate", reason: "normalised_intent" };
  const titleScore = topicSimilarity(titleA, titleB);
  const intentScore = topicSimilarity(intentA, intentB);
  if (Math.max(titleScore, intentScore) >= 0.8) {
    return { risk: "likely_duplicate", reason: intentScore >= titleScore ? "similar_intent" : "similar_title", score: Math.max(titleScore, intentScore) };
  }
  return { risk: "clear", reason: "distinct", score: Math.max(titleScore, intentScore) };
}

export function findTopicDuplicateGroups(topics = []) {
  const groups = [];
  const used = new Set();
  for (let index = 0; index < topics.length; index += 1) {
    if (used.has(topics[index].id)) continue;
    const group = [topics[index]];
    for (let other = index + 1; other < topics.length; other += 1) {
      const risk = duplicateTopicRisk(topics[index], topics[other]);
      if (risk.risk !== "clear") {
        group.push({ ...topics[other], duplicate_reason: risk.reason, duplicate_score: risk.score || 1 });
        used.add(topics[other].id);
      }
    }
    if (group.length > 1) groups.push(group);
  }
  return groups;
}

export function topicMatchesFilters(topic, filters = {}) {
  const search = normalizeTopicText(filters.search);
  const searchable = normalizeTopicText([topic.title, topic.primary_keyword, topicIntentText(topic)].join(" "));
  return (!search || searchable.includes(search)) &&
    (!filters.category || filters.category === "all" || topic.category === filters.category) &&
    (!filters.status || filters.status === "all" || topic.status === filters.status) &&
    (!filters.priority || filters.priority === "all" || Number(topic.priority) === Number(filters.priority));
}
