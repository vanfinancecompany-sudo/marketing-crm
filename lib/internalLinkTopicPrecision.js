const GENERIC = new Set(["about", "after", "again", "another", "article", "before", "business", "businesses", "buy", "buying", "buyer", "buyers", "can", "company", "complete", "consider", "considering", "first", "finance", "financial", "for", "from", "guide", "guides", "how", "information", "into", "more", "most", "should", "the", "their", "this", "time", "tips", "top", "uk", "used", "van", "vans", "vehicle", "vehicles", "what", "when", "where", "which", "while", "with", "work", "would", "you", "your"]);

const EDITORIAL_TOPIC_FAMILIES = [
  ["purchase-source", /\b(?:dealer|private seller|purchase source|another dealer)\b/],
  ["remote-buying", /\b(?:remote|unseen|without seeing|buying unseen|delivery|deliver|reservation|reserve|inspection|inspect|condition check)\w*\b/],
  ["payload-capacity", /\b(?:payload|load space|gross vehicle weight|gvw|carrying capacity|body type|body style|vehicle type|van type|small van|medium van|large van|lwb|long wheelbase|luton|tipper|dropside|drop side|crew van|pickup)\w*\b/],
  ["fuel-operation", /\b(?:diesel|electric|ev|charging|charger|range|fuel choice|fuel type|running cost|operating cost)\w*\b/],
  ["vehicle-condition", /\b(?:mileage|vehicle age|van age|condition|history|service history|service record)\w*\b/],
  ["vehicle-size-type", /\b(?:size|body style|body type|vehicle type|van type|small van|medium van|large van|lwb|long wheelbase|luton|tipper|dropside|drop side|crew van|pickup)\w*\b/],
  ["warranty-preparation", /\b(?:warranty|preparation|prepared|mot|inspection|inspect|condition check)\w*\b/],
  ["finance-application", /\b(?:finance application|apply|application|approval|lender|interest rate|apr|finance product|finance agreement)\w*\b/],
  ["credit-profile", /\b(?:credit|default|iva|bankruptcy|bankrupt|debt management plan|dmp|credit history|credit file)\w*\b/],
  ["self-employed-income", /\b(?:self employed|self-employed|cis|subcontractor|income|accounts|trading history|limited company|newly formed)\w*\b/],
  ["rent2buy", /\b(?:rent2buy|rent 2 buy|rent to buy|rental to ownership)\b/],
];

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
  return new Set(clean(value).split(/\s+/).map(stem).filter((word) => word.length > 2 && !GENERIC.has(word)));
}

function headings(markdown) {
  return String(markdown || "").split("\n").filter((line) => /^#{1,3}\s+/.test(line)).map((line) => line.replace(/^#{1,6}\s+/, "")).join(" ");
}

function editorialFamilies(value) {
  const text = clean(value);
  return new Set(EDITORIAL_TOPIC_FAMILIES.filter(([, pattern]) => pattern.test(text)).map(([family]) => family));
}

export function precisionKnowledgeTopicMatch(source = {}, topic = {}, destination = {}) {
  const sourceEditorial = [source.title, source.seo_title, source.slug, topic.title, topic.primary_keyword].join(" ");
  const destinationEditorial = [destination.title, destination.seo_title, destination.slug].join(" ");
  const sourceFamilies = editorialFamilies(sourceEditorial);
  const destinationFamilies = editorialFamilies(destinationEditorial);
  if (sourceFamilies.size || destinationFamilies.size) {
    return [...sourceFamilies].some((family) => destinationFamilies.has(family));
  }

  const sourceTitle = tokens([source.title, source.seo_title, source.slug, topic.title, topic.primary_keyword].join(" "));
  const sourceHigh = tokens([source.title, source.seo_title, source.slug, topic.title, topic.primary_keyword, headings(source.content_markdown)].join(" "));
  const destinationTitle = tokens([destination.title, destination.seo_title, destination.slug].join(" "));
  if (!destinationTitle.size) return false;
  if ([...destinationTitle].some((word) => sourceTitle.has(word))) return true;
  return [...destinationTitle].filter((word) => sourceHigh.has(word)).length >= 2;
}
