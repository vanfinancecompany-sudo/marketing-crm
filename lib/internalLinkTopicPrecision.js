const GENERIC = new Set([
  "about", "after", "again", "an", "and", "another", "article", "before", "business", "businesses",
  "buy", "buyer", "buyers", "buying", "can", "company", "complete", "consider", "considering", "first",
  "finance", "financial", "for", "from", "guide", "guides", "how", "information", "into", "more", "most",
  "should", "the", "their", "this", "time", "tips", "top", "uk", "used", "van", "vans", "vehicle", "vehicles",
  "what", "when", "where", "which", "while", "with", "work", "would", "you", "your"
]);

function clean(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function stem(word) {
  const value = clean(word);
  if (value.length > 5 && value.endsWith("ies")) return `${value.slice(0, -3)}y`;
  if (value.length > 4 && value.endsWith("s") && !value.endsWith("ss")) return value.slice(0, -1);
  return value;
}

function tokens(value) {
  return new Set(
    clean(value)
      .split(/\s+/)
      .map(stem)
      .filter((word) => word.length > 2 && !GENERIC.has(word))
  );
}

function headings(markdown) {
  return String(markdown || "")
    .split("\n")
    .filter((line) => /^#{1,3}\s+/.test(line))
    .map((line) => line.replace(/^#{1,6}\s+/, ""))
    .join(" ");
}

export function precisionKnowledgeTopicMatch(source = {}, topic = {}, destination = {}) {
  const sourceTitle = tokens([source.title, source.seo_title, source.slug, topic.title, topic.primary_keyword].join(" "));
  const sourceHigh = tokens([source.title, source.seo_title, source.slug, topic.title, topic.primary_keyword, headings(source.content_markdown)].join(" "));
  const destinationTitle = tokens([destination.title, destination.seo_title, destination.slug].join(" "));
  if (!destinationTitle.size) return false;
  if ([...destinationTitle].some((word) => sourceTitle.has(word))) return true;
  return [...destinationTitle].filter((word) => sourceHigh.has(word)).length >= 2;
}
