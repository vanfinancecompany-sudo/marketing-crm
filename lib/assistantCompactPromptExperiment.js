// Preview-only experiment: keep stable compliance/product context and every retrieved
// Business Brain section. The original sealed product boundary and cited sources stay intact.
const REQUIRED_SECTION_KEYS = new Set([
  "products", "compliance", "company_profile", "sales_knowledge",
  "brand_voice", "writing_rules", "preferred_ctas",
]);

export function compactLiveAssistantSections(sections = [], sources = []) {
  const sourceSections = new Set(
    (Array.isArray(sources) ? sources : [])
      .filter((source) => ["business_brain", "business_faq"].includes(source?.type))
      .flatMap((source) => [source.section_key, source.source_id])
      .filter(Boolean)
      .map(String),
  );
  return (Array.isArray(sections) ? sections : []).filter(
    (section) => REQUIRED_SECTION_KEYS.has(String(section?.section_key || "")) ||
      sourceSections.has(String(section?.section_key || "")) ||
      sourceSections.has(String(section?.id || "")),
  );
}
