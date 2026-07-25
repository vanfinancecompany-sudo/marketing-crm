export const BUSINESS_KNOWLEDGE_SECTION_DEFINITIONS = [
  {
    key: "company_profile",
    title: "Company Profile",
    description: "Who the business is, where it operates and the facts that define it.",
    entryLabel: "Profile fact",
  },
  {
    key: "products",
    title: "Products",
    description: "Products, services, schemes and confirmed customer propositions.",
    entryLabel: "Product",
  },
  {
    key: "brand_voice",
    title: "Brand Voice",
    description: "How the business should sound and how customers should feel.",
    entryLabel: "Voice rule",
  },
  {
    key: "writing_rules",
    title: "Writing Rules",
    description: "Formatting, clarity, terminology and content rules for every AI module.",
    entryLabel: "Writing rule",
  },
  {
    key: "compliance",
    title: "Compliance",
    description: "Confirmed guidance, prohibited claims and facts that require review.",
    entryLabel: "Compliance rule",
  },
  {
    key: "faqs",
    title: "FAQs",
    description: "Approved customer questions and answers that AI may rely on.",
    entryLabel: "Question | Approved answer",
  },
  {
    key: "customer_personas",
    title: "Customer Personas",
    description: "Named audiences, their needs and the language that suits them.",
    entryLabel: "Persona | Needs and context",
  },
  {
    key: "sales_knowledge",
    title: "Sales Knowledge",
    description: "Useful objections, qualifying information and practical next steps.",
    entryLabel: "Sales topic | Approved guidance",
  },
  {
    key: "business_vocabulary",
    title: "Business Vocabulary",
    description: "Preferred business terms and the meanings AI must apply consistently.",
    entryLabel: "Term | Meaning or preferred usage",
  },
  {
    key: "preferred_ctas",
    title: "Preferred CTAs",
    description: "Approved calls to action for different customer intents.",
    entryLabel: "CTA purpose | Approved wording",
  },
];

export const BUSINESS_KNOWLEDGE_SECTION_KEYS =
  BUSINESS_KNOWLEDGE_SECTION_DEFINITIONS.map((section) => section.key);

function cleanValue(value) {
  return String(value || "").trim();
}

function cleanEntries(entries) {
  if (!Array.isArray(entries)) return [];
  return entries
    .map((entry) => ({
      label: cleanValue(entry?.label),
      value: cleanValue(entry?.value),
    }))
    .filter((entry) => entry.label || entry.value);
}

function legacySectionContent(key, settings = {}) {
  switch (key) {
    case "company_profile":
      return [
        settings.business_name,
        settings.website_url,
        settings.business_description,
      ].filter(Boolean).join("\n");
    case "products":
      return cleanValue(settings.products_services);
    case "brand_voice":
      return cleanValue(settings.default_tone);
    case "compliance":
      return [settings.factual_guidance, settings.prohibited_claims].filter(Boolean).join("\n");
    case "customer_personas":
      return (settings.target_audiences || []).join("\n");
    case "preferred_ctas":
      return cleanValue(settings.default_cta);
    default:
      return "";
  }
}

export function normalizeBusinessKnowledgeSections(sections = [], settings = {}) {
  const byKey = new Map(
    sections
      .filter((section) => BUSINESS_KNOWLEDGE_SECTION_KEYS.includes(section?.section_key))
      .map((section) => [section.section_key, section])
  );

  return BUSINESS_KNOWLEDGE_SECTION_DEFINITIONS.map((definition, index) => {
    const hasPersistedSection = byKey.has(definition.key);
    const section = byKey.get(definition.key) || {};
    return {
      id: section.id || null,
      section_key: definition.key,
      title: cleanValue(section.title) || definition.title,
      description: cleanValue(section.description) || definition.description,
      content: hasPersistedSection
        ? cleanValue(section.content)
        : legacySectionContent(definition.key, settings),
      entries: cleanEntries(section.entries),
      sort_order: Number.isFinite(Number(section.sort_order))
        ? Number(section.sort_order)
        : index + 1,
      active: section.active !== false,
      entryLabel: definition.entryLabel,
    };
  });
}

export function businessKnowledgeContext(sections = [], settings = {}) {
  const normalized = normalizeBusinessKnowledgeSections(sections, settings)
    .filter((section) => section.active)
    .filter((section) => section.content || section.entries.length);

  return normalized.map((section) => {
    const entries = section.entries
      .map((entry) => `- ${entry.label}${entry.label && entry.value ? ": " : ""}${entry.value}`)
      .join("\n");
    return `## ${section.title}
${section.content || "No general guidance supplied."}${entries ? `\n${entries}` : ""}`;
  }).join("\n\n");
}

export function buildAiPlatformPrompt({
  sections = [],
  settings = {},
  specialist = {},
  topic = {},
  generation = {},
  task = "article_generation",
  module = "knowledge_hub",
  requestedTask = "",
  sourceContent = "",
} = {}) {
  const normalized = normalizeBusinessKnowledgeSections(sections, settings);
  const activeSections = normalized.filter(
    (section) => section.active && (section.content || section.entries.length)
  );
  const context = businessKnowledgeContext(activeSections, settings);
  const specialistPrompt = cleanValue(specialist.prompt);
  const targetAudience =
    cleanValue(generation.targetAudience) ||
    cleanValue(settings.default_audience) ||
    cleanValue(specialist.default_audience);
  const tone =
    cleanValue(generation.tone) ||
    cleanValue(settings.default_tone) ||
    cleanValue(specialist.default_tone);

  const taskInstructions = {
    article_generation: "Create a new knowledge article draft.",
    article_review: "Review the supplied article without rewriting it.",
    topic_finder: "Create distinct topic ideas for editorial review.",
    content_asset_generation: "Create one channel-specific draft asset from the approved source article.",
    content_review: "Review the supplied content without rewriting or approving it.",
    website_intelligence: "Extract reviewable business knowledge from the supplied website text.",
  };

  const prompt = `# Requested task
Module: ${cleanValue(module)}
Task: ${cleanValue(requestedTask) || taskInstructions[task] || cleanValue(task)}

# Selected specialist
${specialistPrompt || "No additional specialist instructions supplied."}

# Business Intelligence
${context || "No structured business knowledge has been supplied. Do not invent business-specific facts."}

# Requested content
Topic: ${cleanValue(topic.title)}
Category: ${cleanValue(topic.category)}
Primary keyword: ${cleanValue(topic.primary_keyword)}
Secondary keywords: ${(topic.secondary_keywords || []).join(", ")}
Customer intent: ${cleanValue(topic.intent)}
Topic notes: ${cleanValue(topic.notes)}
Target audience: ${targetAudience}
Tone: ${tone}
Approximate length: ${Number(generation.approximateLength || 1000)} words
Additional instructions: ${cleanValue(generation.instructions) || "None"}

# Source material
${cleanValue(sourceContent) || "No additional source material supplied."}

# Global safeguards
Use Business Intelligence as the source of truth for company-specific facts, terminology, style,
compliance and calls to action. If required information is absent or conflicts, mark it for human
review instead of guessing. Never invent rates, approval outcomes, vehicle availability, prices,
legal claims or company policy. Avoid keyword stuffing, doorway-page variants, repeated paragraphs
and generic filler.`;

  return {
    prompt,
    metadata: {
      prompt_version: "ai_platform_v1",
      section_keys: activeSections.map((section) => section.section_key),
      specialist_key: cleanValue(specialist.key),
      task,
      module: cleanValue(module),
    },
  };
}

export function buildBusinessIntelligencePrompt(options = {}) {
  const assembled = buildAiPlatformPrompt(options);
  return {
    ...assembled,
    metadata: {
      ...assembled.metadata,
      prompt_version: "business_intelligence_v1",
    },
  };
}

const ARTICLE_REVIEW_CATEGORY_KEYS = [
  "brand_consistency",
  "vocabulary",
  "readability",
  "seo",
  "cta_quality",
  "compliance",
  "repetition",
  "generic_wording",
  "hallucination_risk",
];

export function normalizeKnowledgeArticleReviewScale(review = {}) {
  const categoryField = review.category_scores ? "category_scores" : "categories";
  const sourceCategories = review[categoryField] || {};
  const suppliedScores = ARTICLE_REVIEW_CATEGORY_KEYS
    .filter((key) => sourceCategories[key])
    .map((key) => Number(sourceCategories[key].score))
    .filter(Number.isFinite);
  const usesTenPointCategoryScale =
    suppliedScores.length >= 5 &&
    suppliedScores.every((score) => score >= 0 && score <= 10);
  const categories = Object.fromEntries(
    Object.entries(sourceCategories).map(([key, category]) => {
      const score = Number(category?.score);
      return [
        key,
        {
          ...category,
          score: Number.isFinite(score)
            ? Math.round(score * (usesTenPointCategoryScale ? 10 : 1))
            : category?.score,
        },
      ];
    })
  );
  const overallScore = Number(review.overall_score);
  const usesTenPointOverallScale =
    usesTenPointCategoryScale &&
    Number.isFinite(overallScore) &&
    overallScore >= 0 &&
    overallScore <= 10;
  return {
    ...review,
    overall_score: Number.isFinite(overallScore)
      ? Math.round(overallScore * (usesTenPointOverallScale ? 10 : 1))
      : review.overall_score,
    [categoryField]: categories,
  };
}

export function parseKnowledgeArticleReviewResponse(value) {
  let parsed = value?.review ?? value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
    } catch {
      throw new Error("The AI returned invalid review JSON. The article was not changed.");
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("The AI response was not a structured article review.");
  }

  const legacyRequired = ["brand_consistency", "readability", "seo", "cta_quality", "compliance"];
  if (!legacyRequired.every((key) => parsed.categories?.[key])) {
    throw new Error("The AI review is missing one or more quality categories.");
  }

  const categories = Object.fromEntries(
    ARTICLE_REVIEW_CATEGORY_KEYS.map((key) => {
      const category = parsed.categories[key] || {
        score: 0,
        reason: "Not assessed by this legacy review snapshot.",
        findings: [],
      };
      const score = Number(category.score);
      if (!Number.isFinite(score) || score < 0 || score > 100) {
        throw new Error(`The AI review returned an invalid ${key} score.`);
      }
      return [
        key,
        {
          score: Math.round(score),
          reason: cleanValue(category.reason),
          findings: Array.isArray(category.findings)
            ? category.findings.map(cleanValue).filter(Boolean)
            : [],
        },
      ];
    })
  );
  const overallScore = Number(parsed.overall_score);
  if (!Number.isFinite(overallScore) || overallScore < 0 || overallScore > 100) {
    throw new Error("The AI review returned an invalid overall score.");
  }

  return normalizeKnowledgeArticleReviewScale({
    overall_score: Math.round(overallScore),
    summary: cleanValue(parsed.summary),
    categories,
    strengths: Array.isArray(parsed.strengths)
      ? parsed.strengths.map(cleanValue).filter(Boolean)
      : [],
    issues: Array.isArray(parsed.issues)
      ? parsed.issues
          .map((issue) => ({
            category: cleanValue(issue?.category),
            severity: ["low", "medium", "high"].includes(issue?.severity)
              ? issue.severity
              : "medium",
            description: cleanValue(issue?.description),
            evidence: cleanValue(issue?.evidence),
          }))
          .filter((issue) => issue.description)
      : [],
    recommendations: Array.isArray(parsed.recommendations)
      ? parsed.recommendations.map(cleanValue).filter(Boolean)
      : [],
  });
}
