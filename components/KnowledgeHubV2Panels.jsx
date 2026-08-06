import { KNOWLEDGE_CATEGORIES } from "../lib/knowledgeHub.js";
import { buildTopicPlannerSections } from "../lib/aiMarketingPlatform.js";

function HubField({ label, children, wide = false }) {
  return (
    <label className="field" style={wide ? { gridColumn: "1 / -1" } : undefined}>
      <span className="field__label">{label}</span>
      {children}
    </label>
  );
}

export function PriorityStars({ value = 3, onChange, readOnly = false }) {
  return (
    <span className="knowledge-priority" aria-label={`Priority ${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          className={star <= Number(value) ? "is-active" : ""}
          disabled={readOnly}
          aria-label={`Set priority ${star}`}
          onClick={() => onChange?.(star)}
        >
          ★
        </button>
      ))}
    </span>
  );
}

export function TopicPlannerIntelligence({ topics, articles, freshnessDays }) {
  const sections = buildTopicPlannerSections({ topics, articles, freshnessDays });
  const definitions = [
    ["high_priority", "High Priority"],
    ["seasonal", "Seasonal"],
    ["missing_coverage", "Missing Coverage"],
    ["refresh_needed", "Refresh Needed"],
    ["recently_published", "Recently Published"],
    ["duplicate_risks", "Duplicate Risks"],
    ["opportunities", "Opportunities"],
  ];
  return (
    <section className="panel panel--nested" style={{ boxShadow: "none", marginBottom: 18 }}>
      <div className="panel__header">
        <div>
          <div className="eyebrow">Content Planner</div>
          <h3>Planning sections</h3>
          <p>Prioritised editorial views. “Recently Published” reflects manual article approval; this platform does not publish.</p>
        </div>
      </div>
      <div className="knowledge-breakdown-grid">
        {definitions.map(([key, label]) => (
          <div key={key}>
            <strong>{label}</strong>
            <span>{sections[key].length} item{sections[key].length === 1 ? "" : "s"}</span>
            {sections[key].slice(0, 3).map((item) => <small key={item.id}>{item.title}</small>)}
          </div>
        ))}
      </div>
    </section>
  );
}

export function ContentIntelligenceDashboard({ analytics, onOpenArticle, onNavigate }) {
  if (!analytics) return null;
  return (
    <>
      <section className="stats-grid knowledge-stats-grid">
        {[
          ["Quality pass rate", `${analytics.quality.pass_rate}%`],
          ["Needs attention", analytics.quality.needing_attention.length],
          ["Stale approved", analytics.freshness.stale_articles.length],
          [
            "Possible duplicates",
            analytics.duplicates.topics.length + analytics.duplicates.articles.length,
          ],
        ].map(([label, value]) => (
          <div className="stat-card" key={label}>
            <div className="stat-card__label">{label}</div>
            <div className="stat-card__value">{value}</div>
          </div>
        ))}
      </section>

      <section className="knowledge-intelligence-grid">
        <div className="panel">
          <div className="panel__header">
            <div>
              <h3>Quality attention</h3>
              <p>Articles with at least one transparent checklist warning.</p>
            </div>
          </div>
          <div className="knowledge-list">
            {analytics.quality.needing_attention.slice(0, 8).map((article) => (
              <button
                type="button"
                className="knowledge-list__item"
                key={article.id}
                onClick={() => onOpenArticle(article)}
              >
                <span>
                  <strong>{article.title}</strong>
                  <small>{article.category || "Uncategorised"}</small>
                </span>
                <span>Review</span>
              </button>
            ))}
            {!analytics.quality.needing_attention.length ? (
              <div className="notice">No current articles need quality attention.</div>
            ) : null}
          </div>
        </div>

        <div className="panel">
          <div className="panel__header">
            <div>
              <h3>Article mix</h3>
              <p>Stored article totals by workflow status, category and specialist template.</p>
            </div>
          </div>
          <div className="knowledge-breakdown-grid">
            {[
              ["Status", analytics.by_status],
              ["Category", analytics.by_category],
              ["Template", analytics.by_template],
            ].map(([label, counts]) => (
              <div key={label}>
                <strong>{label}</strong>
                {Object.entries(counts).map(([name, count]) => (
                  <span key={name}>{name}: {count}</span>
                ))}
                {!Object.keys(counts).length ? <span>No articles</span> : null}
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel__header">
            <div>
              <h3>Freshness</h3>
              <p>
                Approved articles not updated within {analytics.freshness.threshold_days} days.
              </p>
            </div>
          </div>
          <div className="knowledge-list">
            {analytics.freshness.stale_articles.slice(0, 8).map((article) => (
              <button
                type="button"
                className="knowledge-list__item"
                key={article.id}
                onClick={() => onOpenArticle(article)}
              >
                <span>
                  <strong>{article.title}</strong>
                  <small>{new Date(article.updated_at || article.created_at).toLocaleDateString("en-GB")}</small>
                </span>
                <span>Refresh</span>
              </button>
            ))}
            {!analytics.freshness.stale_articles.length ? (
              <div className="notice">No approved articles are currently stale.</div>
            ) : null}
          </div>
        </div>

        <div className="panel">
          <div className="panel__header">
            <div>
              <h3>Duplicate review</h3>
              <p>Exact and probable overlaps. These are warnings, not automatic deletions.</p>
            </div>
          </div>
          <div className="knowledge-compact-list">
            {analytics.duplicates.topics.slice(0, 5).map((match) => (
              <div key={`${match.topic.id}-${match.other.id}`}>
                <strong>{match.topic.title}</strong>
                <span>↔ {match.other.title}</span>
                <small>{match.exact ? "Exact topic title" : `${Math.round(match.overlap * 100)}% word overlap`}</small>
              </div>
            ))}
            {analytics.duplicates.articles.slice(0, 5).map((match) => (
              <div key={`${match.article.id}-${match.other.id}`}>
                <strong>{match.article.title}</strong>
                <span>↔ {match.other.title}</span>
                <small>{match.exact ? "Exact article title" : `${Math.round(match.overlap * 100)}% content overlap`}</small>
              </div>
            ))}
            {!analytics.duplicates.topics.length && !analytics.duplicates.articles.length ? (
              <div className="notice">No probable duplicates found.</div>
            ) : null}
          </div>
        </div>

        <div className="panel">
          <div className="panel__header">
            <div>
              <h3>Missing coverage</h3>
              <p>Categories with no active topic or no approved article.</p>
            </div>
          </div>
          <div className="knowledge-coverage-grid">
            {analytics.coverage.map((item) => (
              <div className={item.missing ? "is-missing" : "is-covered"} key={item.category}>
                <strong>{item.category}</strong>
                <span>{item.topics} topics · {item.approved_articles} approved</span>
              </div>
            ))}
          </div>
          <div className="card-actions">
            <button className="button button--ghost" type="button" onClick={() => onNavigate("finder")}>
              Find missing topics
            </button>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel__header">
          <div>
            <h3>Topic Planner progress</h3>
            <p>High-priority topics without an active article are the clearest next actions.</p>
          </div>
          <button className="button button--ghost" type="button" onClick={() => onNavigate("topics")}>
            Open Topic Planner
          </button>
        </div>
        <div className="knowledge-planner-summary">
          <span><strong>{analytics.planner.high_priority_open.length}</strong> high-priority open</span>
          <span><strong>{analytics.planner.ready}</strong> ready</span>
          <span><strong>{analytics.planner.generated}</strong> generated</span>
        </div>
      </section>
    </>
  );
}

export function TopicFinderPanel({
  categories,
  setCategories,
  quantity,
  setQuantity,
  brief,
  setBrief,
  ideas,
  selectedIndexes,
  toggleSelected,
  updateIdea,
  onFind,
  onSave,
  busy,
  duplicateCount,
}) {
  return (
    <section className="page-stack">
      <div className="panel knowledge-form-panel">
        <div className="panel__header">
          <div>
            <h3>AI Topic Finder</h3>
            <p>Generate distinct ideas for review. Suggestions are never saved automatically.</p>
          </div>
        </div>
        <div className="field-grid">
          <HubField label="Number of ideas">
            <input
              className="field__input"
              type="number"
              min="1"
              max="100"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
            />
          </HubField>
          <HubField label="Additional brief" wide>
            <textarea
              className="field__input"
              rows={4}
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
              placeholder="For example: focus on questions from self-employed builders."
            />
          </HubField>
        </div>
        <div className="knowledge-category-picker">
          {KNOWLEDGE_CATEGORIES.map((category) => (
            <label key={category}>
              <input
                type="checkbox"
                checked={categories.includes(category)}
                onChange={() =>
                  setCategories(
                    categories.includes(category)
                      ? categories.filter((item) => item !== category)
                      : [...categories, category]
                  )
                }
              />
              {category}
            </label>
          ))}
        </div>
        <div className="card-actions">
          <button
            className="button button--primary"
            type="button"
            disabled={busy || !categories.length}
            onClick={onFind}
          >
            {busy ? "Finding topics..." : Number(quantity) === 100 ? "Find 100 New Topics" : "Find Topic Ideas"}
          </button>
          {Number(quantity) !== 100 ? (
            <button
              className="button button--ghost"
              type="button"
              disabled={busy || !categories.length}
              onClick={() => {
                setQuantity(100);
                onFind(100);
              }}
            >
              Find 100 New Topics
            </button>
          ) : null}
        </div>
      </div>

      {ideas.length ? (
        <div className="panel">
          <div className="panel__header">
            <div>
              <h3>Review suggestions</h3>
              <p>
                Edit and select ideas before saving.
                {duplicateCount ? ` ${duplicateCount} probable duplicate(s) were removed.` : ""}
              </p>
            </div>
            <button
              className="button button--primary"
              type="button"
              disabled={busy || !selectedIndexes.length}
              onClick={onSave}
            >
              Save Selected Ideas
            </button>
          </div>
          <div className="page-stack">
            {[...new Set(ideas.map((idea) => idea.category))].map((category) => (
              <section key={category}>
                <h4>{category}</h4>
                <div className="knowledge-finder-grid">
                {ideas.map((idea, index) => ({ idea, index }))
                  .filter((item) => item.idea.category === category)
                  .map(({ idea, index }) => (
                  <div className="knowledge-finder-card" key={`${idea.title}-${index}`}>
                <label className="knowledge-select-row">
                  <input
                    type="checkbox"
                    checked={selectedIndexes.includes(index)}
                    onChange={() => toggleSelected(index)}
                  />
                  Include this idea
                </label>
                <HubField label="Title">
                  <input
                    className="field__input"
                    value={idea.title}
                    onChange={(event) => updateIdea(index, "title", event.target.value)}
                  />
                </HubField>
                <div className="field-grid">
                  <HubField label="Category">
                    <select
                      className="field__input"
                      value={idea.category}
                      onChange={(event) => updateIdea(index, "category", event.target.value)}
                    >
                      {KNOWLEDGE_CATEGORIES.map((category) => (
                        <option key={category}>{category}</option>
                      ))}
                    </select>
                  </HubField>
                  <HubField label="Priority">
                    <PriorityStars
                      value={idea.priority}
                      onChange={(value) => updateIdea(index, "priority", value)}
                    />
                  </HubField>
                </div>
                <div className="field-grid">
                  <HubField label="Estimated value">
                    <PriorityStars
                      value={idea.estimated_value || 3}
                      onChange={(value) => updateIdea(index, "estimated_value", value)}
                    />
                  </HubField>
                  <HubField label="Difficulty">
                    <PriorityStars
                      value={idea.difficulty || 3}
                      onChange={(value) => updateIdea(index, "difficulty", value)}
                    />
                  </HubField>
                  <HubField label="Target persona">
                    <input className="field__input" value={idea.target_persona || ""} onChange={(event) => updateIdea(index, "target_persona", event.target.value)} />
                  </HubField>
                  <HubField label="Seasonal">
                    <label className="toggle-row"><input type="checkbox" checked={Boolean(idea.seasonal)} onChange={(event) => updateIdea(index, "seasonal", event.target.checked)} />Seasonal topic</label>
                  </HubField>
                </div>
                <HubField label="Primary keyword">
                  <input
                    className="field__input"
                    value={idea.primary_keyword}
                    onChange={(event) => updateIdea(index, "primary_keyword", event.target.value)}
                  />
                </HubField>
                <HubField label="Customer intent">
                  <textarea
                    className="field__input"
                    rows={3}
                    value={idea.intent}
                    onChange={(event) => updateIdea(index, "intent", event.target.value)}
                  />
                </HubField>
                <small>{idea.rationale}</small>
                  </div>
                ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function BatchGenerationPanel({
  topics,
  generation,
  setGeneration,
  templates,
  progress,
  busy,
  onRun,
}) {
  return (
    <section className="panel knowledge-form-panel">
      <div className="panel__header">
        <div>
          <h3>Batch Article Generation</h3>
          <p>
            Generate selected topics sequentially. Every success is saved as a draft and individual
            failures do not roll back completed drafts.
          </p>
        </div>
      </div>
      <div className="notice">{topics.length} selected topic(s). Maximum 10 per batch.</div>
      <div className="field-grid">
        <HubField label="Specialist template">
          <select
            className="field__input"
            value={generation.templateKey}
            onChange={(event) => setGeneration({ ...generation, templateKey: event.target.value })}
          >
            {templates.map((template) => (
              <option value={template.key} key={template.key}>{template.name}</option>
            ))}
          </select>
        </HubField>
        <HubField label="Approximate words">
          <input
            className="field__input"
            type="number"
            min="300"
            max="4000"
            value={generation.approximateLength}
            onChange={(event) =>
              setGeneration({ ...generation, approximateLength: event.target.value })
            }
          />
        </HubField>
        <HubField label="Target audience">
          <input
            className="field__input"
            value={generation.targetAudience}
            onChange={(event) =>
              setGeneration({ ...generation, targetAudience: event.target.value })
            }
          />
        </HubField>
        <HubField label="Tone">
          <input
            className="field__input"
            value={generation.tone}
            onChange={(event) => setGeneration({ ...generation, tone: event.target.value })}
          />
        </HubField>
        <HubField label="Additional instructions" wide>
          <textarea
            className="field__input"
            rows={4}
            value={generation.instructions}
            onChange={(event) =>
              setGeneration({ ...generation, instructions: event.target.value })
            }
          />
        </HubField>
      </div>
      <div className="knowledge-batch-progress">
        {topics.map((topic) => {
          const item = progress.find((entry) => entry.topic_id === topic.id);
          return (
            <div key={topic.id} className={item?.status ? `is-${item.status}` : ""}>
              <strong>{topic.title}</strong>
              <span>{item?.message || "Waiting"}</span>
            </div>
          );
        })}
      </div>
      <div className="card-actions">
        <button
          className="button button--primary"
          type="button"
          disabled={busy || !topics.length}
          onClick={onRun}
        >
          {busy ? "Generating drafts..." : "Generate Draft Batch"}
        </button>
      </div>
    </section>
  );
}

export function BusinessSettingsPanel({
  settings,
  setSettings,
  templates,
  updateTemplate,
  onSaveSettings,
  onSaveTemplate,
  busy,
}) {
  return (
    <section className="page-stack">
      <div className="panel knowledge-form-panel">
        <div className="panel__header">
          <div>
            <h3>Business Settings</h3>
            <p>Confirmed context used by Topic Finder and specialist article generation.</p>
          </div>
        </div>
        <div className="field-grid">
          <HubField label="Business name">
            <input className="field__input" value={settings.business_name || ""} onChange={(event) => setSettings({ ...settings, business_name: event.target.value })} />
          </HubField>
          <HubField label="Website URL">
            <input className="field__input" value={settings.website_url || ""} onChange={(event) => setSettings({ ...settings, website_url: event.target.value })} />
          </HubField>
          <HubField label="Default tone">
            <input className="field__input" value={settings.default_tone || ""} onChange={(event) => setSettings({ ...settings, default_tone: event.target.value })} />
          </HubField>
          <HubField label="Default audience">
            <input className="field__input" value={settings.default_audience || ""} onChange={(event) => setSettings({ ...settings, default_audience: event.target.value })} />
          </HubField>
          <HubField label="Business description" wide>
            <textarea className="field__input" rows={4} value={settings.business_description || ""} onChange={(event) => setSettings({ ...settings, business_description: event.target.value })} />
          </HubField>
          <HubField label="Products and services" wide>
            <textarea className="field__input" rows={5} value={settings.products_services || ""} onChange={(event) => setSettings({ ...settings, products_services: event.target.value })} />
          </HubField>
          <HubField label="Confirmed factual guidance" wide>
            <textarea className="field__input" rows={7} value={settings.factual_guidance || ""} onChange={(event) => setSettings({ ...settings, factual_guidance: event.target.value })} />
          </HubField>
          <HubField label="Claims and statements to avoid" wide>
            <textarea className="field__input" rows={5} value={settings.prohibited_claims || ""} onChange={(event) => setSettings({ ...settings, prohibited_claims: event.target.value })} />
          </HubField>
          <HubField label="Target audiences (one per line)">
            <textarea className="field__input" rows={5} value={(settings.target_audiences || []).join("\n")} onChange={(event) => setSettings({ ...settings, target_audiences: event.target.value.split("\n").map((item) => item.trim()).filter(Boolean) })} />
          </HubField>
          <HubField label="Content goals (one per line)">
            <textarea className="field__input" rows={5} value={(settings.content_goals || []).join("\n")} onChange={(event) => setSettings({ ...settings, content_goals: event.target.value.split("\n").map((item) => item.trim()).filter(Boolean) })} />
          </HubField>
          <HubField label="Freshness threshold (days)">
            <input className="field__input" type="number" min="30" max="730" value={settings.freshness_days || 180} onChange={(event) => setSettings({ ...settings, freshness_days: event.target.value })} />
          </HubField>
          <HubField label="Finance covered nations (one per line)">
            <textarea className="field__input" rows={4} value={(settings.finance_covered_nations || []).join("\n")} onChange={(event) => setSettings({ ...settings, finance_covered_nations: event.target.value.split("\n").map((item) => item.trim()).filter(Boolean) })} />
          </HubField>
          <HubField label="Rent2Buy base postcode">
            <input className="field__input" value={settings.rent2buy_base_postcode || ""} onChange={(event) => setSettings({ ...settings, rent2buy_base_postcode: event.target.value.toUpperCase() })} />
          </HubField>
          <HubField label="Rent2Buy maximum radius (miles)">
            <input className="field__input" type="number" min="1" max="500" step="1" value={settings.rent2buy_max_radius_miles ?? 100} onChange={(event) => setSettings({ ...settings, rent2buy_max_radius_miles: event.target.value })} />
          </HubField>
          <HubField label="Coverage borderline tolerance (miles)">
            <input className="field__input" type="number" min="0" max="100" step="1" value={settings.coverage_borderline_tolerance_miles ?? 10} onChange={(event) => setSettings({ ...settings, coverage_borderline_tolerance_miles: event.target.value })} />
          </HubField>
          <HubField label="Coverage distance method">
            <select className="field__input" value={settings.coverage_distance_method || "straight_line"} onChange={(event) => setSettings({ ...settings, coverage_distance_method: event.target.value })}>
              <option value="straight_line">Straight-line (Haversine)</option>
            </select>
          </HubField>
          <HubField label="Default CTA" wide>
            <textarea className="field__input" rows={4} value={settings.default_cta || ""} onChange={(event) => setSettings({ ...settings, default_cta: event.target.value })} />
          </HubField>
        </div>
        <div className="card-actions">
          <button className="button button--primary" disabled={busy} onClick={onSaveSettings}>
            {busy ? "Saving..." : "Save Business Settings"}
          </button>
        </div>
      </div>

      <div className="panel">
        <div className="panel__header">
          <div>
            <h3>Specialist AI Prompt Templates</h3>
            <p>Editable server-stored instructions. V1 templates remain available.</p>
          </div>
        </div>
        <div className="knowledge-template-grid">
          {templates.map((template, index) => (
            <div className="knowledge-template-card" key={template.key}>
              <HubField label="Template name">
                <input className="field__input" value={template.name} onChange={(event) => updateTemplate(index, "name", event.target.value)} />
              </HubField>
              <HubField label="Description">
                <textarea className="field__input" rows={3} value={template.description || ""} onChange={(event) => updateTemplate(index, "description", event.target.value)} />
              </HubField>
              <HubField label="Specialist prompt">
                <textarea className="field__input knowledge-template-prompt" value={template.prompt || ""} onChange={(event) => updateTemplate(index, "prompt", event.target.value)} />
              </HubField>
              <div className="field-grid">
                <HubField label="Default tone">
                  <input className="field__input" value={template.default_tone || ""} onChange={(event) => updateTemplate(index, "default_tone", event.target.value)} />
                </HubField>
                <HubField label="Default audience">
                  <input className="field__input" value={template.default_audience || ""} onChange={(event) => updateTemplate(index, "default_audience", event.target.value)} />
                </HubField>
              </div>
              <div className="card-actions">
                <button className="button button--ghost" type="button" disabled={busy} onClick={() => onSaveTemplate(template)}>
                  Save {template.name}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
