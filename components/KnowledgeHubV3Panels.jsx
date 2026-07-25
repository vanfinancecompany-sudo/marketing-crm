import {
  BUSINESS_KNOWLEDGE_SECTION_DEFINITIONS,
} from "../lib/businessIntelligence.js";

function KnowledgeField({ label, children, wide = false }) {
  return (
    <label className="field" style={wide ? { gridColumn: "1 / -1" } : undefined}>
      <span className="field__label">{label}</span>
      {children}
    </label>
  );
}

function entriesToText(entries = []) {
  return entries
    .map((entry) =>
      entry.label ? `${entry.label} | ${entry.value || ""}` : entry.value || ""
    )
    .join("\n");
}

function textToEntries(value) {
  return String(value || "")
    .split("\n")
    .map((line) => {
      const separator = line.indexOf("|");
      if (separator < 0) return { label: "", value: line.trim() };
      return {
        label: line.slice(0, separator).trim(),
        value: line.slice(separator + 1).trim(),
      };
    })
    .filter((entry) => entry.label || entry.value);
}

export function BusinessKnowledgeCentre({
  sections,
  updateSection,
  onSave,
  busy,
}) {
  return (
    <section className="page-stack">
      <div className="panel">
        <div className="panel__header">
          <div>
            <div className="eyebrow">Reusable AI Foundation</div>
            <h3>Business Knowledge Centre</h3>
            <p>
              Confirmed business facts and rules used by article generation, Topic Finder,
              AI Reviewer and future AI modules.
            </p>
          </div>
        </div>
        <div className="notice">
          Save only confirmed information. Blank sections make the AI mark uncertainty for human
          review instead of guessing.
        </div>
      </div>

      <div className="knowledge-business-grid">
        {sections.map((section, index) => {
          const definition = BUSINESS_KNOWLEDGE_SECTION_DEFINITIONS.find(
            (item) => item.key === section.section_key
          );
          return (
            <article className="panel knowledge-business-section" key={section.section_key}>
              <div className="panel__header">
                <div>
                  <h3>{section.title}</h3>
                  <p>{section.description}</p>
                </div>
                <label className="knowledge-active-toggle">
                  <input
                    type="checkbox"
                    checked={section.active !== false}
                    onChange={(event) => updateSection(index, "active", event.target.checked)}
                  />
                  Use in AI
                </label>
              </div>
              <KnowledgeField label="Confirmed guidance" wide>
                <textarea
                  className="field__input knowledge-business-content"
                  rows={7}
                  value={section.content || ""}
                  onChange={(event) => updateSection(index, "content", event.target.value)}
                  placeholder={`Add confirmed ${section.title.toLowerCase()} guidance...`}
                />
              </KnowledgeField>
              <KnowledgeField
                label={`${definition?.entryLabel || "Structured entry"} — one per line, separate label and value with |`}
                wide
              >
                <textarea
                  className="field__input"
                  rows={5}
                  value={entriesToText(section.entries)}
                  onChange={(event) =>
                    updateSection(index, "entries", textToEntries(event.target.value))
                  }
                  placeholder={`Example: ${definition?.entryLabel || "Label | Approved value"}`}
                />
              </KnowledgeField>
              <div className="card-actions">
                <button
                  className="button button--primary"
                  type="button"
                  disabled={busy}
                  onClick={() => onSave(section)}
                >
                  Save {section.title}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function PromptBuilderNotice({ sections = [], specialist }) {
  const activeCount = sections.filter(
    (section) =>
      section.active !== false &&
      (String(section.content || "").trim() || section.entries?.length)
  ).length;
  return (
    <div className="notice knowledge-prompt-builder-notice">
      <strong>Prompt Builder ready.</strong>{" "}
      Generation will assemble {activeCount} completed Business Knowledge section
      {activeCount === 1 ? "" : "s"}, global safeguards and the{" "}
      <strong>{specialist?.name || "selected specialist"}</strong> prompt. Generated content
      remains a draft.
    </div>
  );
}

const REVIEW_CATEGORY_LABELS = {
  brand_consistency: "Brand consistency",
  readability: "Readability",
  seo: "SEO",
  cta_quality: "CTA quality",
  compliance: "Compliance",
};

export function ArticleQualityScore({
  review,
  onReview,
  busy,
  canReview,
  blockedReason,
}) {
  return (
    <section className="panel knowledge-ai-review">
      <div className="panel__header">
        <div>
          <div className="eyebrow">Advisory Only</div>
          <h3>AI Reviewer</h3>
          <p>
            Scores the saved draft against Business Intelligence. It cannot edit, approve or
            change article status.
          </p>
        </div>
        <button
          className="button button--ghost"
          type="button"
          disabled={busy || !canReview}
          onClick={onReview}
        >
          {busy ? "Reviewing..." : review ? "Run New Review" : "Run AI Review"}
        </button>
      </div>
      {!canReview && blockedReason ? <div className="notice">{blockedReason}</div> : null}
      {review ? (
        <>
          <div className="knowledge-review-summary">
            <div
              className={`knowledge-quality-score ${
                review.overall_score >= 80
                  ? "is-strong"
                  : review.overall_score >= 60
                    ? "is-mixed"
                    : "is-weak"
              }`}
            >
              <strong>{review.overall_score}</strong>
              <span>/ 100</span>
            </div>
            <div>
              <h4>Article Quality Score</h4>
              <p>{review.summary}</p>
              <small>
                Reviewed {new Date(review.created_at).toLocaleString("en-GB")}
                {review.model ? ` · ${review.model}` : ""}
              </small>
            </div>
          </div>

          <div className="knowledge-review-categories">
            {Object.entries(REVIEW_CATEGORY_LABELS).map(([key, label]) => {
              const category = review.category_scores?.[key];
              return (
                <div key={key}>
                  <span>
                    <strong>{label}</strong>
                    <b>{category?.score ?? 0}/100</b>
                  </span>
                  <div className="knowledge-review-meter">
                    <i style={{ width: `${category?.score ?? 0}%` }} />
                  </div>
                  <p>{category?.reason || "No reviewer explanation supplied."}</p>
                  {category?.findings?.length ? (
                    <ul>
                      {category.findings.map((finding, index) => (
                        <li key={`${key}-${index}`}>{finding}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              );
            })}
          </div>

          {review.issues?.length ? (
            <div className="knowledge-review-findings">
              <h4>Issues to review</h4>
              {review.issues.map((issue, index) => (
                <div key={`${issue.category}-${index}`} className={`is-${issue.severity}`}>
                  <span>{issue.severity}</span>
                  <strong>{REVIEW_CATEGORY_LABELS[issue.category] || issue.category}</strong>
                  <p>{issue.description}</p>
                  {issue.evidence ? <small>Evidence: {issue.evidence}</small> : null}
                </div>
              ))}
            </div>
          ) : null}

          {review.recommendations?.length ? (
            <div className="knowledge-review-recommendations">
              <h4>Reviewer recommendations</h4>
              <ul>
                {review.recommendations.map((recommendation, index) => (
                  <li key={index}>{recommendation}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : (
        <div className="notice">
          No AI review has been saved for this draft. The existing transparent checklist still
          applies independently.
        </div>
      )}
    </section>
  );
}
