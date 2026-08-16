const clean = (value) => String(value || "").trim();

function sealedBusinessKnowledgeContext(sections = []) {
  return (Array.isArray(sections) ? sections : [])
    .filter((section) => section?.active !== false)
    .filter((section) => clean(section?.content) || (Array.isArray(section?.entries) && section.entries.length))
    .map((section) => {
      const entries = (Array.isArray(section.entries) ? section.entries : [])
        .map((entry) => `- ${clean(entry?.label)}${clean(entry?.label) && clean(entry?.value) ? ": " : ""}${clean(entry?.value)}`)
        .filter((value) => value !== "- ")
        .join("\n");
      return `## ${clean(section.title) || clean(section.section_key) || "Business Knowledge"}\n${clean(section.content) || "No general guidance supplied."}${entries ? `\n${entries}` : ""}`;
    })
    .join("\n\n");
}

// The normal AI-platform prompt intentionally normalises Business Knowledge and injects the VFC
// primary-source bank. That is correct for authoring tools, but not after the public assistant has
// already built a sealed product brain. Re-normalising here would silently put Finance evidence back
// into the Rent2Buy prompt. This builder serialises only the already-approved, already-bounded input.
export function buildSealedAssistantPlatformPrompt({ sections = [] } = {}) {
  const context = sealedBusinessKnowledgeContext(sections);
  return {
    prompt: `# Requested task\nModule: ai_assistant_competence_test\nTask: Answer one customer question using only the retrieved evidence.\n\n# Selected specialist\nNo additional specialist instructions supplied.\n\n# Business Intelligence\n${context || "No structured business knowledge has been supplied. Do not invent business-specific facts."}\n\n# Global safeguards\nUse only the supplied sealed Business Intelligence and retrieved evidence as the source of truth for company-specific facts, terminology, compliance and calls to action. If required information is absent or conflicts, mark it as unknown instead of guessing. Never invent rates, approval outcomes, vehicle availability, prices, legal claims or company policy.`,
    metadata: {
      prompt_version: "sealed_assistant_product_brain_v1",
      section_keys: (Array.isArray(sections) ? sections : []).filter((section) => section?.active !== false).map((section) => section.section_key).filter(Boolean),
    },
  };
}
