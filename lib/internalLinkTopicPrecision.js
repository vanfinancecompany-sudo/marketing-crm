const GENERIC = new Set(["van", "vans", "vehicle", "vehicles", "finance", "financial", "buy", "buying", "buyer", "buyers", "used", "uk", "guide", "guides", "business", "company", "what", "when", "which", "with", "your", "you", "from", "for", "the", "a", "an"]);

function clean(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function tokens(value) {
  return new Set(clean(value).split(/\s+/).filter((word) => word.length > 2 && !GENERIC.has(word)));
}

function headings(markdown) {
  return String(markdown || "").split("\n").filter((line) => /^#{1,3}\s+/.test(line)).map((line) => line.replace(/^#{1,6}\s+/, "")).join(" ");
}

export function precisionKnowledgeTopicMatch(source = {}, topic = {}, destination = {}) {
  const sourceTitle = tokens([source.title, source.seo_title, source.slug, topic.title, topic.primary_keyword].join(" "));
  const sourceHigh = tokens([source.title, source.seo_title, source.slug, topic.title, topic.primary_keyword, headings(source.content_markdown)].join(" "));
  const destinationTitle = tokens([destination.title, destination.seo_title, destination.slug].join(" "));
  if (!destinationTitle.size) return false;
  if ([...destinationTitle].some((word) => sourceTitle.has(word))) return true;
  return [...destinationTitle].filter((word) => sourceHigh.has(word)).length >= 2;
}
