import { useEffect, useMemo, useState } from "react";
import {
  AI_CONTENT_CHANNELS,
  AI_REVIEW_CATEGORY_KEYS,
  calculateArticleSeoIntelligence,
  calculateBusinessBrainCompleteness,
  recommendInternalLinks,
} from "../lib/aiMarketingPlatform.js";
import {
  analyseBusinessWebsite,
  applyBusinessWebsiteImport,
  generateContentAsset,
  loadAiMarketingPlatform,
  reviewContentAsset,
  saveContentAsset,
} from "../services/aiMarketingPlatform.js";
import {
  clearMarketingAccessKey,
  getStoredMarketingAccessKey,
  isMarketingAccessDenied,
  saveMarketingAccessKey,
  validateMarketingAccessKey,
} from "../services/marketingAccess.js";

const WEBSITE_LABELS = {
  company: "Company",
  products: "Products",
  faqs: "FAQs",
  services: "Services",
  tone: "Tone",
  vocabulary: "Vocabulary",
  personas: "Personas",
  ctas: "CTAs",
};

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("en-GB");
}

function statusTone(status) {
  return status === "approved" ? "green" : status === "draft" ? "amber" : "default";
}

function Score({ value }) {
  const tone = value >= 80 ? "green" : value >= 60 ? "amber" : "default";
  return <span className={`status-pill stat-card--${tone}`}>{value}/100</span>;
}

function AccessGate({ checking, error, onUnlock }) {
  const [key, setKey] = useState("");
  return (
    <section className="panel knowledge-access-panel">
      <div className="eyebrow">Protected Marketing Tool</div>
      <h3>{checking ? "Checking saved access..." : "Unlock Content Factory"}</h3>
      <p>Uses the same Marketing CRM access key as Knowledge Hub and Campaign Engine.</p>
      {!checking ? (
        <form
          className="field-grid"
          onSubmit={(event) => {
            event.preventDefault();
            onUnlock(key, () => setKey(""));
          }}
        >
          <label className="field" style={{ gridColumn: "1 / -1" }}>
            <span className="field__label">Marketing access key</span>
            <input className="field__input" type="password" value={key} onChange={(event) => setKey(event.target.value)} />
          </label>
          <button className="button button--primary" type="submit">Unlock</button>
        </form>
      ) : null}
      {error ? <div className="notice notice--error">{error}</div> : null}
    </section>
  );
}

function BusinessBrainScore({ sections, settings }) {
  const completeness = calculateBusinessBrainCompleteness(sections, settings);
  return (
    <section className="panel">
      <div className="panel__header">
        <div>
          <div className="eyebrow">Shared AI Foundation</div>
          <h3>Business Brain completeness</h3>
          <p>Completed guidance gives every AI module more confirmed context and fewer uncertainty warnings.</p>
        </div>
        <div className="knowledge-quality-score is-mixed">
          <strong>{completeness.overall}</strong><span>/ 100</span>
        </div>
      </div>
      <div className="knowledge-review-categories">
        {completeness.sections.map((section) => (
          <div key={section.key}>
            <span><strong>{section.title}</strong><b>{section.score}%</b></span>
            <div className="knowledge-review-meter"><i style={{ width: `${section.score}%` }} /></div>
          </div>
        ))}
      </div>
    </section>
  );
}

function WebsiteImporter({ imports, busy, onAnalyse, onApply }) {
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [selections, setSelections] = useState({});
  const pending = imports.find((item) => item.status === "review");

  useEffect(() => {
    if (!pending) return;
    const available = Object.entries(pending.extracted_sections || {})
      .filter(([, values]) => Array.isArray(values) && values.length)
      .map(([key]) => key);
    setSelections((current) => ({ ...current, [pending.id]: current[pending.id] || available }));
  }, [pending?.id]);

  const selected = pending ? selections[pending.id] || [] : [];
  return (
    <section className="panel">
      <div className="panel__header">
        <div>
          <div className="eyebrow">Business Brain</div>
          <h3>Import Website</h3>
          <p>AI extracts reviewable knowledge. Nothing is merged until you select sections and save.</p>
        </div>
      </div>
      <div className="field-grid">
        <label className="field" style={{ gridColumn: "1 / -1" }}>
          <span className="field__label">Public HTTPS website URL</span>
          <input className="field__input" type="url" value={websiteUrl} onChange={(event) => setWebsiteUrl(event.target.value)} placeholder="https://www.example.co.uk" />
        </label>
      </div>
      <div className="card-actions">
        <button className="button button--primary" type="button" disabled={busy || !websiteUrl} onClick={() => onAnalyse(websiteUrl, () => setWebsiteUrl(""))}>
          {busy ? "Analysing..." : "Analyse Website"}
        </button>
      </div>
      {pending ? (
        <div className="panel panel--nested" style={{ boxShadow: "none", marginTop: 18 }}>
          <div className="panel__header">
            <div><h3>Review extraction</h3><p>{pending.website_url} · analysed {formatDate(pending.created_at)}</p></div>
            <span className="status-pill stat-card--amber">Review required</span>
          </div>
          <div className="knowledge-business-grid">
            {Object.entries(WEBSITE_LABELS).map(([key, label]) => {
              const values = pending.extracted_sections?.[key] || [];
              if (!values.length) return null;
              return (
                <label className="panel panel--nested" style={{ boxShadow: "none" }} key={key}>
                  <span className="knowledge-select-row">
                    <input
                      type="checkbox"
                      checked={selected.includes(key)}
                      onChange={() =>
                        setSelections((current) => ({
                          ...current,
                          [pending.id]: selected.includes(key)
                            ? selected.filter((item) => item !== key)
                            : [...selected, key],
                        }))
                      }
                    />
                    <strong>{label}</strong>
                  </span>
                  <ul>{values.map((value, index) => <li key={`${key}-${index}`}>{value}</li>)}</ul>
                </label>
              );
            })}
          </div>
          <div className="notice">
            Saving appends reviewed items as structured entries. Existing Business Brain content is never overwritten.
          </div>
          <div className="card-actions">
            <button className="button button--primary" type="button" disabled={busy || !selected.length} onClick={() => onApply(pending.id, selected)}>
              Save Selected to Business Brain
            </button>
          </div>
        </div>
      ) : (
        <div className="notice" style={{ marginTop: 16 }}>No website extraction is waiting for review.</div>
      )}
    </section>
  );
}

function SeoDashboard({ articles }) {
  const intelligence = useMemo(
    () => articles.map((article) => ({ article, score: calculateArticleSeoIntelligence(article, articles) })),
    [articles]
  );
  return (
    <section className="panel">
      <div className="panel__header">
        <div>
          <div className="eyebrow">Suggestions Only</div>
          <h3>SEO Intelligence dashboard</h3>
          <p>Transparent checks identify review work without editing any article.</p>
        </div>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="knowledge-table">
          <thead><tr><th>Article</th><th>Overall</th><th>SEO</th><th>Readability</th><th>Business relevance</th><th>CTA</th><th>Internal links</th><th>Flags</th></tr></thead>
          <tbody>
            {intelligence.map(({ article, score }) => (
              <tr key={article.id}>
                <td><strong>{article.title}</strong><small>{article.status}</small></td>
                <td><Score value={score.overall_score} /></td>
                <td>{score.seo_score}</td>
                <td>{score.readability}</td>
                <td>{score.business_relevance}</td>
                <td>{score.cta_quality}</td>
                <td>{score.internal_linking}</td>
                <td>
                  {[
                    score.flags.missing_headings && "Missing headings",
                    score.flags.missing_faq && "Missing FAQ",
                    score.flags.duplicate_title && "Duplicate title",
                    score.flags.thin_content && "Thin content",
                  ].filter(Boolean).join(" · ") || "No structural flags"}
                </td>
              </tr>
            ))}
            {!intelligence.length ? <tr><td colSpan="8">No current Knowledge Articles.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function InternalLinkSuggestions({ article, articles }) {
  const suggestions = article ? recommendInternalLinks(article, articles) : [];
  return (
    <section className="panel panel--nested" style={{ boxShadow: "none" }}>
      <div className="panel__header">
        <div><h3>Internal linking recommendations</h3><p>Related destinations for editorial review. No links are inserted automatically.</p></div>
      </div>
      <div className="knowledge-list">
        {suggestions.map((suggestion) => (
          <div className="knowledge-list__item" key={suggestion.article_id}>
            <span><strong>{suggestion.title}</strong><small>{suggestion.type}</small></span>
            <span>Suggestion</span>
          </div>
        ))}
        {!suggestions.length ? <div className="notice">No approved related articles are available yet.</div> : null}
      </div>
    </section>
  );
}

function AssetEditor({ asset, review, articles, busy, onChange, onSave, onRegenerate, onReview, onClose }) {
  const [preview, setPreview] = useState(false);
  const article = articles.find((item) => item.id === asset.source_article_id);
  return (
    <div className="panel">
      <div className="panel__header">
        <div>
          <div className="eyebrow">{AI_CONTENT_CHANNELS.find((item) => item.key === asset.channel)?.label} · Manual approval</div>
          <h3>{asset.title}</h3>
          <p>{article?.title || "Approved Knowledge Article"} · {asset.status}</p>
        </div>
        <button className="button button--ghost" type="button" onClick={onClose}>Close Editor</button>
      </div>
      {preview ? (
        <article className="knowledge-preview">
          <h2>{asset.title}</h2>
          {asset.preview_text ? <p><em>{asset.preview_text}</em></p> : null}
          <div style={{ whiteSpace: "pre-wrap" }}>{asset.body}</div>
          {asset.cta ? <p><strong>{asset.cta}</strong></p> : null}
        </article>
      ) : (
        <div className="field-grid">
          <label className="field" style={{ gridColumn: "1 / -1" }}><span className="field__label">Title</span><input className="field__input" value={asset.title} disabled={asset.status !== "draft"} onChange={(event) => onChange("title", event.target.value)} /></label>
          <label className="field" style={{ gridColumn: "1 / -1" }}><span className="field__label">Preview text</span><input className="field__input" value={asset.preview_text || ""} disabled={asset.status !== "draft"} onChange={(event) => onChange("preview_text", event.target.value)} /></label>
          <label className="field" style={{ gridColumn: "1 / -1" }}><span className="field__label">Draft asset</span><textarea className="field__input" rows="16" value={asset.body} disabled={asset.status !== "draft"} onChange={(event) => onChange("body", event.target.value)} /></label>
          <label className="field" style={{ gridColumn: "1 / -1" }}><span className="field__label">CTA</span><input className="field__input" value={asset.cta || ""} disabled={asset.status !== "draft"} onChange={(event) => onChange("cta", event.target.value)} /></label>
        </div>
      )}
      <div className="card-actions">
        <button className="button button--ghost" type="button" onClick={() => setPreview((value) => !value)}>{preview ? "Edit" : "Preview"}</button>
        {asset.status === "draft" ? <>
          <button className="button button--primary" type="button" disabled={busy} onClick={() => onSave("draft")}>Save Draft</button>
          <button className="button button--ghost" type="button" disabled={busy} onClick={onRegenerate}>Regenerate</button>
          <button className="button button--ghost" type="button" disabled={busy} onClick={onReview}>Run AI Review</button>
          <button className="button button--primary" type="button" disabled={busy} onClick={() => onSave("approved")}>Approve</button>
          <button className="button button--ghost" type="button" disabled={busy} onClick={() => onSave("archived")}>Archive</button>
        </> : null}
        {asset.status === "approved" ? <button className="button button--ghost" type="button" disabled={busy} onClick={() => onSave("archived")}>Archive</button> : null}
      </div>
      <div className="notice">Drafts are never published, posted, emailed or sent. Approval records an internal manual decision only.</div>
      {review ? (
        <section className="panel panel--nested" style={{ boxShadow: "none", marginTop: 18 }}>
          <div className="panel__header"><div><h3>AI Review Engine</h3><p>{review.summary}</p></div><Score value={review.overall_score} /></div>
          <div className="knowledge-review-categories">
            {AI_REVIEW_CATEGORY_KEYS.map((key) => (
              <div key={key}><span><strong>{key.replaceAll("_", " ")}</strong><b>{review.category_scores?.[key]?.score || 0}/100</b></span><div className="knowledge-review-meter"><i style={{ width: `${review.category_scores?.[key]?.score || 0}%` }} /></div><p>{review.category_scores?.[key]?.reason}</p></div>
            ))}
          </div>
          {review.recommendations?.length ? <div><h4>Recommendations</h4><ul>{review.recommendations.map((item, index) => <li key={index}>{item}</li>)}</ul></div> : null}
          {review.warnings?.length ? <div><h4>Warnings</h4><ul>{review.warnings.map((item, index) => <li key={index}><strong>{item.severity}</strong> · {item.message}</li>)}</ul></div> : null}
        </section>
      ) : <div className="notice" style={{ marginTop: 16 }}>Run AI Review on the current draft before approval.</div>}
      <InternalLinkSuggestions article={article} articles={articles} />
    </div>
  );
}

export default function ContentFactoryPage() {
  const [accessStatus, setAccessStatus] = useState(() => getStoredMarketingAccessKey() ? "checking" : "locked");
  const [articles, setArticles] = useState([]);
  const [assets, setAssets] = useState([]);
  const [sections, setSections] = useState([]);
  const [settings, setSettings] = useState({});
  const [imports, setImports] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [selectedArticleId, setSelectedArticleId] = useState("");
  const [channels, setChannels] = useState(["email"]);
  const [activeAsset, setActiveAsset] = useState(null);
  const [tab, setTab] = useState("factory");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function loadData() {
    setBusy(true);
    setError("");
    try {
      const result = await loadAiMarketingPlatform();
      setArticles(result.articles || []);
      setAssets(result.assets || []);
      setSections(result.business_sections || []);
      setSettings(result.settings || {});
      setImports(result.website_imports || []);
      setReviews(result.reviews || []);
      setSelectedArticleId((current) => current || result.articles?.find((article) => article.status === "approved")?.id || "");
      setAccessStatus("unlocked");
    } catch (loadError) {
      if (isMarketingAccessDenied(loadError)) setAccessStatus("locked");
      setError(loadError.message || "Content Factory could not load.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    let active = true;
    async function validate() {
      if (!getStoredMarketingAccessKey()) return setAccessStatus("locked");
      try {
        await validateMarketingAccessKey(getStoredMarketingAccessKey());
        if (active) await loadData();
      } catch (accessError) {
        clearMarketingAccessKey();
        if (active) {
          setAccessStatus("locked");
          setError(accessError.message || "Saved access could not be validated.");
        }
      }
    }
    validate();
    return () => { active = false; };
  }, []);

  async function unlock(key, clear) {
    setBusy(true);
    setError("");
    try {
      await validateMarketingAccessKey(key);
      saveMarketingAccessKey(key);
      clear();
      await loadData();
    } catch (accessError) {
      setError(accessError.message || "Access key not recognised.");
    } finally {
      setBusy(false);
    }
  }

  async function generateSelected() {
    if (!selectedArticleId || !channels.length) return;
    setBusy(true);
    setError("");
    setMessage("");
    const failures = [];
    let generated = 0;
    for (const channel of channels) {
      try {
        const result = await generateContentAsset(selectedArticleId, channel);
        setAssets((current) => [result.asset, ...current]);
        generated += 1;
      } catch (generationError) {
        failures.push(`${AI_CONTENT_CHANNELS.find((item) => item.key === channel)?.label}: ${generationError.message}`);
      }
    }
    setBusy(false);
    setMessage(`${generated} separate draft asset${generated === 1 ? "" : "s"} generated.`);
    if (failures.length) setError(failures.join(" · "));
  }

  function updateActiveAsset(field, value) {
    setActiveAsset((current) => ({ ...current, [field]: value }));
  }

  async function saveActiveAsset(status) {
    setBusy(true);
    setError("");
    try {
      const result = await saveContentAsset(activeAsset, status);
      setActiveAsset(result.asset);
      setAssets((current) => current.map((asset) => asset.id === result.asset.id ? result.asset : asset));
      setMessage(status === "approved" ? "Asset approved for internal use." : status === "archived" ? "Asset archived." : "Draft saved.");
    } catch (saveError) {
      setError(saveError.message || "Content asset could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function regenerateActiveAsset() {
    setBusy(true);
    setError("");
    try {
      const result = await generateContentAsset(activeAsset.source_article_id, activeAsset.channel, activeAsset.id);
      setActiveAsset(result.asset);
      setAssets((current) => current.map((asset) => asset.id === result.asset.id ? result.asset : asset));
      setMessage("Asset regenerated as a draft.");
    } catch (regenerationError) {
      setError(regenerationError.message || "Asset could not be regenerated.");
    } finally {
      setBusy(false);
    }
  }

  async function reviewActiveAsset() {
    setBusy(true);
    setError("");
    try {
      const result = await reviewContentAsset(activeAsset.id);
      setReviews((current) => [result.review, ...current]);
      setMessage(`AI Review saved: ${result.review.overall_score}/100. No content was changed.`);
    } catch (reviewError) {
      setError(reviewError.message || "Asset could not be reviewed.");
    } finally {
      setBusy(false);
    }
  }

  async function analyseWebsite(url, clear) {
    setBusy(true);
    setError("");
    try {
      const result = await analyseBusinessWebsite(url);
      setImports((current) => [result.website_import, ...current]);
      clear();
      setMessage("Website intelligence extracted. Review every section before saving.");
    } catch (analysisError) {
      setError(analysisError.message || "Website could not be analysed.");
    } finally {
      setBusy(false);
    }
  }

  async function applyImport(importId, selected) {
    if (!window.confirm("Append the selected reviewed items to Business Brain? Existing information will be preserved.")) return;
    setBusy(true);
    setError("");
    try {
      const result = await applyBusinessWebsiteImport(importId, selected);
      setImports((current) => current.map((item) => item.id === result.website_import.id ? result.website_import : item));
      await loadData();
      setMessage("Reviewed website knowledge appended to Business Brain.");
    } catch (applyError) {
      setError(applyError.message || "Website knowledge could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  if (accessStatus !== "unlocked") {
    return <AccessGate checking={accessStatus === "checking"} error={error} onUnlock={unlock} />;
  }

  const approvedArticles = articles.filter((article) => article.status === "approved");
  const selectedArticle = articles.find((article) => article.id === selectedArticleId);
  const latestReview = activeAsset
    ? reviews.find((review) => review.target_type === "content_asset" && review.target_id === activeAsset.id)
    : null;

  return (
    <div className="page-stack knowledge-hub">
      <section className="hero-panel">
        <div className="panel__header">
          <div>
            <div className="eyebrow">Marketing CRM Phase 4</div>
            <h2>AI Content Factory</h2>
            <p>Turn approved Knowledge Articles into channel-specific drafts using the shared Business Brain. Nothing publishes or sends automatically.</p>
          </div>
          <button className="button button--ghost" type="button" onClick={() => { clearMarketingAccessKey(); setAccessStatus("locked"); }}>Lock</button>
        </div>
      </section>
      <div className="knowledge-tabs">
        {[["factory", "Content Factory"], ["seo", "SEO Intelligence"], ["brain", "Business Brain & Website"]].map(([key, label]) => (
          <button className={tab === key ? "button button--primary" : "button button--ghost"} type="button" key={key} onClick={() => { setTab(key); setActiveAsset(null); }}>{label}</button>
        ))}
      </div>
      {error ? <div className="notice notice--error">{error}</div> : null}
      {message ? <div className="notice knowledge-notice-success">{message}</div> : null}

      {tab === "factory" && activeAsset ? (
        <AssetEditor
          asset={activeAsset}
          review={latestReview}
          articles={articles}
          busy={busy}
          onChange={updateActiveAsset}
          onSave={saveActiveAsset}
          onRegenerate={regenerateActiveAsset}
          onReview={reviewActiveAsset}
          onClose={() => setActiveAsset(null)}
        />
      ) : null}

      {tab === "factory" && !activeAsset ? (
        <>
          <section className="panel">
            <div className="panel__header">
              <div><h3>Generate draft assets</h3><p>Each selected channel is generated and stored separately.</p></div>
              <span className="status-pill stat-card--amber">Draft only</span>
            </div>
            <label className="field">
              <span className="field__label">Approved Knowledge Article</span>
              <select className="field__input" value={selectedArticleId} onChange={(event) => setSelectedArticleId(event.target.value)}>
                <option value="">Select an approved article</option>
                {approvedArticles.map((article) => <option key={article.id} value={article.id}>{article.title}</option>)}
              </select>
            </label>
            <div className="knowledge-category-picker">
              {AI_CONTENT_CHANNELS.map((channel) => (
                <label key={channel.key}>
                  <input type="checkbox" checked={channels.includes(channel.key)} onChange={() => setChannels((current) => current.includes(channel.key) ? current.filter((item) => item !== channel.key) : [...current, channel.key])} />
                  {channel.label}
                </label>
              ))}
            </div>
            <div className="card-actions">
              <button className="button button--primary" type="button" disabled={busy || !selectedArticle || !channels.length} onClick={generateSelected}>{busy ? "Generating separate drafts..." : "Generate Draft Assets"}</button>
            </div>
            <div className="notice">Uses Business Brain, Brand Voice, Business Vocabulary, Preferred CTAs, Compliance and the channel specialist. Everything remains a draft.</div>
          </section>
          <section className="panel">
            <div className="panel__header"><div><h3>Draft asset library</h3><p>Edit, preview, regenerate, review, approve or archive each asset separately.</p></div></div>
            <div style={{ overflowX: "auto" }}>
              <table className="knowledge-table">
                <thead><tr><th>Asset</th><th>Channel</th><th>Source</th><th>Status</th><th>Updated</th><th>Action</th></tr></thead>
                <tbody>
                  {assets.map((asset) => (
                    <tr key={asset.id}>
                      <td><strong>{asset.title}</strong></td>
                      <td>{AI_CONTENT_CHANNELS.find((item) => item.key === asset.channel)?.label || asset.channel}</td>
                      <td>{articles.find((article) => article.id === asset.source_article_id)?.title || "Knowledge Article"}</td>
                      <td><span className={`status-pill stat-card--${statusTone(asset.status)}`}>{asset.status}</span></td>
                      <td>{formatDate(asset.updated_at)}</td>
                      <td><button className="button button--ghost" type="button" onClick={() => setActiveAsset({ ...asset })}>{asset.status === "archived" ? "Preview" : "Edit"}</button></td>
                    </tr>
                  ))}
                  {!assets.length ? <tr><td colSpan="6">No channel assets have been generated.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}

      {tab === "seo" ? <SeoDashboard articles={articles} /> : null}
      {tab === "brain" ? <>
        <BusinessBrainScore sections={sections} settings={settings} />
        <WebsiteImporter imports={imports} busy={busy} onAnalyse={analyseWebsite} onApply={applyImport} />
      </> : null}
    </div>
  );
}
